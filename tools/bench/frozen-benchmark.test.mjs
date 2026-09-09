import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { compileCapsule, countTokens, renderContext, sha256, TOKENIZER, TOKEN_PROFILES } from './context-capsule.mjs';
import { loadFrozenBenchmark, runFrozenBenchmark, validateGold, validateManifest, scoreSelection } from './frozen-benchmark.mjs';
import { selectFragments } from './lexical-baseline.mjs';

async function fixture() {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/histos-contract-'));
  const content = 'alpha relevant\nneutral\nmore neutral\nlast line\n';
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
  const source = { path: 'a.txt', repository: 'https://github.com/example/public', commit: 'a'.repeat(40), source_path: 'a.txt', git_blob: blob, sha256: sha256(content), bytes: Buffer.byteLength(content), line_count: 5, source_url: `https://github.com/example/public/blob/${'a'.repeat(40)}/a.txt` };
  const manifest = { schema: 'histos.source-manifest/v1', corpus_id: 'unit-test-only', status: 'DRAFT_AWAITING_INDEPENDENT_FREEZE', provenance: { visibility: 'public', method: 'test fixture', license: 'test fixture', source_authority: 'test fixture' }, sources: [source] };
  const gold = { schema: 'histos.benchmark-suite/v1', suite_id: manifest.corpus_id, gold_status: 'DRAFT_AWAITING_INDEPENDENT_FREEZE', manifest: 'manifest.json', profiles: TOKEN_PROFILES, tokenizer: TOKENIZER, annotation_method: 'synthetic unit test only, never production freeze evidence', cases: [{ id: 'test-case', split: 'held_out', query: 'alpha', corpus: ['a.txt'], required_evidence_groups: [{ id: 'test-group', rationale: 'test', ranges: [{ path: 'a.txt', start_line: 1, end_line: 1 }] }] }] };
  const manifestBytes = JSON.stringify(manifest);
  const goldBytes = JSON.stringify(gold);
  const freeze = { schema: 'histos.gold-freeze/v1', status: 'FROZEN', reviewer: 'SYNTHETIC_TEST_ONLY', manifest_sha256: sha256(manifestBytes), gold_sha256: sha256(goldBytes), reviewed_cases: ['test-case'], method: 'unit test, no production authority' };
  await writeFile(path.join(root, source.path), content);
  await writeFile(path.join(root, 'manifest.json'), manifestBytes);
  await writeFile(path.join(root, 'gold.json'), goldBytes);
  await writeFile(path.join(root, 'freeze.json'), JSON.stringify(freeze));
  return { root, manifest, gold, freeze, content, goldPath: path.join(root, 'gold.json'), freezePath: path.join(root, 'freeze.json') };
}

test('tokenizer matches known cl100k vectors and treats special-looking source as text', () => {
  assert.equal(countTokens('hello world'), 2);
  assert.equal(countTokens('お誕生日おめでとう'), 9);
  assert.ok(countTokens('<|endoftext|>') > 1);
  assert.deepEqual(TOKEN_PROFILES.map((profile) => profile.max_tokens), [2000, 4000, 8000]);
});

test('entire rendered text including headers fits each token budget, with oversized candidates omitted', () => {
  const source_sha256 = 'a'.repeat(64);
  const candidates = Array.from({ length: 70 }, (_, index) => ({ path: 'source.mjs', source_sha256, start_line: index + 1, end_line: index + 1, text: `alpha ${'お誕生日 '.repeat(25)}${index}` }));
  for (const { max_tokens } of TOKEN_PROFILES) {
    const capsule = compileCapsule({ goal: 'alpha', corpus_id: 'test', snapshot_digest: source_sha256, sources: [], candidates, max_tokens });
    assert.ok(capsule.budget.rendered_tokens <= max_tokens);
    assert.equal(capsule.budget.rendered_tokens, countTokens(capsule.rendered_context));
    assert.equal(capsule.rendered_context, renderContext(capsule));
    assert.equal(capsule.budget.rendered_bytes, Buffer.byteLength(capsule.rendered_context));
    assert.ok(capsule.selection_receipt.omitted.length > 0);
    assert.notEqual(capsule.budget.rendered_tokens, capsule.budget.rendered_bytes);
  }
  assert.throws(() => compileCapsule({ goal: 'alpha', corpus_id: 'test', snapshot_digest: source_sha256, sources: [], candidates: [], max_tokens: 1 }), /BUDGET_BELOW_REQUIRED_PREAMBLE/);
});

test('freeze is required, covers every case, and binds exact gold and manifest bytes', async () => {
  const fixtureData = await fixture();
  const { goldPath, freezePath, freeze } = fixtureData;
  await assert.rejects(loadFrozenBenchmark(goldPath), /INDEPENDENT_FREEZE_REQUIRED/);
  await loadFrozenBenchmark(goldPath, freezePath);
  await writeFile(freezePath, JSON.stringify({ ...freeze, reviewed_cases: [] }));
  await assert.rejects(loadFrozenBenchmark(goldPath, freezePath), /INCOMPLETE_INDEPENDENT_REVIEW/);
  await writeFile(freezePath, JSON.stringify(freeze));
  await writeFile(goldPath, `${await readFile(goldPath, 'utf8')}\n`);
  await assert.rejects(loadFrozenBenchmark(goldPath, freezePath), /FREEZE_DIGEST_MISMATCH/);
});

test('source digest drift fails closed after a valid freeze', async () => {
  const { root, goldPath, freezePath } = await fixture();
  await writeFile(path.join(root, 'a.txt'), 'changed source');
  await assert.rejects(runFrozenBenchmark(goldPath, { freezePath }), /SOURCE_MOVED/);
});

test('strict source and case contracts reject unknown fields, traversals, invalid ranges and byte profiles', async () => {
  const { manifest, gold } = await fixture();
  assert.throws(() => validateManifest({ ...manifest, hidden_authority: true }), /INVALID_CONTRACT_FIELDS/);
  const traversal = structuredClone(manifest); traversal.sources[0].path = '../a.txt';
  assert.throws(() => validateManifest(traversal), /INVALID_RELATIVE_PATH/);
  const invalidRange = structuredClone(gold); invalidRange.cases[0].required_evidence_groups[0].ranges[0].end_line = 99;
  assert.throws(() => validateGold(invalidRange, manifest), /INVALID_GOLD_RANGE/);
  assert.throws(() => validateGold({ ...gold, profiles: [{ id: '2k', max_bytes: 2000 }] }, manifest), /INVALID_TOKEN_CONTRACT/);
});

test('report repeats deterministic source selection and exposes measurement limits without model claims', async () => {
  const { goldPath, freezePath } = await fixture();
  const first = await runFrozenBenchmark(goldPath, { freezePath, profileId: '2k' });
  const second = await runFrozenBenchmark(goldPath, { freezePath, profileId: '2k' });
  const a = first.reports[0].cases[0];
  const b = second.reports[0].cases[0];
  assert.deepEqual(a.capsule, b.capsule);
  assert.equal(a.metrics.required_evidence_group_recall, 1);
  assert.equal(a.metrics.selected_fragment_gold_precision, 1);
  assert.equal(a.metrics.selected_line_gold_precision, 1 / 3);
  assert.equal(a.metrics.whole_file_reads, 1);
  assert.equal(a.metrics.tool_calls, 0);
  assert.equal(a.metrics.search_calls, 1);
  assert.equal(a.metrics.reread_count, 0);
  for (const metric of ['cold_latency', 'warm_latency', 'incremental_update_cost', 'stale_context_harm', 'verified_task_outcome']) assert.equal(a.metrics[metric].status, 'NOT_MEASURED');
  assert.equal(a.metrics.cache_hit_rate.value, null);
  assert.equal(a.whole_file_reference.budget_applied, false);
  assert.ok(Number.isFinite(a.metrics.retrieval_latency_ms));
  await assert.rejects(runFrozenBenchmark(goldPath, { freezePath, profileId: 'invalid' }), /UNKNOWN_PROFILE/);
});

test('fixed lexical candidates and token selection do not receive gold; precision does not overclaim line relevance', () => {
  const source = { path: 'a.txt', sha256: 'a'.repeat(64), lines: ['alpha', 'unrelated', 'unrelated', 'unrelated'] };
  const candidates = selectFragments([source], 'alpha', Number.MAX_SAFE_INTEGER).candidates;
  const capsule = compileCapsule({ goal: 'alpha', corpus_id: 'test', snapshot_digest: source.sha256, sources: [], candidates, max_tokens: 2000 });
  const positive = { required_evidence_groups: [{ ranges: [{ path: 'a.txt', start_line: 1, end_line: 1 }] }] };
  const negative = { required_evidence_groups: [], expect_no_answer: true };
  const unchanged = structuredClone(capsule);
  assert.equal(scoreSelection(capsule.source_fragments, positive).required_evidence_group_recall, 1);
  assert.equal(scoreSelection(capsule.source_fragments, negative).expected_no_answer_pass, false);
  assert.deepEqual(capsule, unchanged);
});

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { countTokens } from '../bench/context-capsule.mjs';
import { installProfile, loadProfile, refreshProfile, startContextService } from './context-service.mjs';
import { requestService } from './service-client.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-service-test-'));
  const sourceRoot = path.join(root, 'source'); await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, 'a.mjs'), 'export function alpha(value) {\n  return value + 1;\n}\n');
  await writeFile(path.join(sourceRoot, 'b.md'), '# Beta\nOther scoped source.\n');
  await writeFile(path.join(sourceRoot, 'private.txt'), 'EXCLUDED_SENTINEL');
  const profileRoot = path.join(root, 'profile');
  const installed = await installProfile({ profileRoot, sourceRoot, scopeId: 'public-fixture', paths: ['a.mjs', 'b.md'] });
  let service = await startContextService({ profileRoot });
  const health = () => requestService({ profileRoot });
  const call = (name, args = {}, client = 'test') => requestService({ profileRoot, operation: 'call', name, arguments: { ...installed.scope, query: 'alpha', ...args }, client });
  return { root, sourceRoot, profileRoot, installed, service, health, call, restart: async () => { await service.close(); service = await startContextService({ profileRoot }); return service; }, close: async () => { await service.close(); await rm(root, { force: true, recursive: true }); } };
}

test('two clients share exact service and public H01 source contracts; restart preserves source identity', async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.call('context_search', {}, 'codex-test'), f.call('context_search', {}, 'opencode-test')]);
    assert.equal(a.service.instance_id, b.service.instance_id);
    assert.equal(a.service.instance_id, f.service.instance_id);
    const hit = a.candidates[0];
    const read = await f.call('context_read', { query: undefined, path: hit.path, start_line: hit.start_line, end_line: hit.end_line });
    assert.equal(read.text, hit.text); assert.equal(read.source_sha256, hit.source_sha256);
    const input = { goal: 'Find alpha behavior', max_tokens: 2000 };
    const capsule = await f.call('context_compile', input);
    assert.equal(capsule.budget.rendered_tokens, countTokens(capsule.rendered_context));
    assert.ok(capsule.budget.rendered_tokens <= 2000);
    assert.equal(capsule.current_truth_refs.length, 2);
    assert.equal(capsule.source_fragments[0].text, read.text);
    const explanation = await f.call('context_explain', input);
    assert.deepEqual(explanation.selection_receipt, capsule.selection_receipt);
    assert.ok(explanation.candidates.some(c => c.selected && c.why_included.length));
    const restarted = await f.restart();
    assert.notEqual(restarted.instance_id, a.service.instance_id);
    assert.deepEqual((await f.health()).scope, f.installed.scope);
    assert.equal((await f.call('context_search')).candidates[0].source_sha256, hit.source_sha256);
    const telemetry = (await readFile(path.join(f.profileRoot, 'telemetry.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(telemetry.some(e => e.client === 'codex-test'));
    assert.ok(telemetry.some(e => e.client === 'opencode-test'));
    assert.ok(telemetry.every(e => !('query' in e) && !('text' in e)));
  } finally { await f.close(); }
});

test('scope, snapshot, arguments and excluded/traversing source fail closed through transport', async () => {
  const f = await fixture();
  try {
    for (const [args, pattern] of [[{ scope_id: 'other' }, /SCOPE_MISMATCH/], [{ snapshot_digest: '0'.repeat(64) }, /SNAPSHOT_MISMATCH/], [{ paths: ['private.txt'] }, /SCOPE_OUT_OF_BOUNDS/], [{ paths: [] }, /INVALID_PATH_SCOPE/], [{ sourceRoot: f.sourceRoot }, /UNKNOWN_ARGUMENT/], [{ max_candidates: 100 }, /INVALID_CANDIDATE_LIMIT/]]) await assert.rejects(f.call('context_search', args), pattern);
    for (const p of ['private.txt', '../source/private.txt', 'C:/private.txt']) await assert.rejects(f.call('context_read', { query: undefined, path: p, start_line: 1, end_line: 1 }), /SOURCE_OUT_OF_SCOPE|INVALID_SCOPE_PATH/);
    assert.equal((await f.call('context_search', { query: 'private.txt secret' })).candidates.length, 0);
    await assert.rejects(f.call('context_compile', { goal: 'alpha', max_tokens: 9000 }), /INVALID_TOKEN_BUDGET/);
    await assert.rejects(f.call('context_compile', { goal: 'alpha', max_tokens: 1 }), /BUDGET_BELOW_REQUIRED_PREAMBLE/);
    await assert.rejects(f.call('context_read', { query: undefined, path: 'a.mjs', start_line: 1, end_line: 501 }), /INVALID_SOURCE_RANGE/);
  } finally { await f.close(); }
});

test('every operation verifies live source including no-match; explicit index refresh invalidates old client snapshots', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.sourceRoot, 'b.md'), '# Beta\nChanged source.\n');
    for (const name of ['context_search', 'context_compile', 'context_explain', 'context_read']) {
      const args = name === 'context_read' ? { query: undefined, path: 'a.mjs', start_line: 1, end_line: 1 } : name === 'context_search' ? { query: 'no-match-unobtanium' } : { query: 'no-match-unobtanium', goal: 'unknown', max_tokens: 2000 };
      await assert.rejects(f.call(name, args), /SOURCE_STALE/);
    }
    await assert.rejects(f.health(), /SOURCE_STALE/);
    const refreshed = await refreshProfile(f.profileRoot);
    assert.equal(refreshed.changes.parsed_files, 1); assert.equal(refreshed.changes.reused_files, 1);
    await assert.rejects(f.call('context_search'), /SNAPSHOT_MISMATCH/);
    const fresh = await f.call('context_search', { ...refreshed.scope });
    assert.equal(fresh.scope.snapshot_digest, refreshed.scope.snapshot_digest);
    const narrowed = await f.call('context_compile', { ...refreshed.scope, paths: ['a.mjs'], goal: 'alpha', max_tokens: 2000 });
    assert.deepEqual(narrowed.current_truth_refs.map(s => s.path), ['a.mjs']);
    const indexPath = path.join(f.profileRoot, 'index/source-index-v1.json');
    const parsed = JSON.parse(await readFile(indexPath)); parsed.sources[0].lines[0] = 'FORGED'; await writeFile(indexPath, JSON.stringify(parsed));
    await assert.rejects(f.call('context_search', { ...refreshed.scope }), /INDEX_CORRUPT/);
  } finally { await f.close(); }
});

test('loopback endpoint rejects unauthenticated, cross-origin and incorrect-instance access; install/daemon cannot overwrite', async () => {
  const f = await fixture();
  try {
    const { config } = await loadProfile(f.profileRoot);
    const headers = { authorization: `Bearer ${config.capability}`, 'x-histos-instance': f.service.instance_id };
    assert.equal((await fetch(`${f.service.url}/health`)).status, 401);
    assert.equal((await fetch(`${f.service.url}/health`, { headers: { ...headers, origin: 'https://attacker.invalid' } })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => { const req = http.get(`${f.service.url}/health`, { headers: { ...headers, host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(`${f.service.url}/health`, { headers: { ...headers, 'x-histos-instance': 'other' } })).status, 409);
    await assert.rejects(installProfile({ profileRoot: f.profileRoot, sourceRoot: f.sourceRoot, scopeId: 'new', paths: ['a.mjs'] }), /EEXIST/);
    await assert.rejects(startContextService({ profileRoot: f.profileRoot }), /EEXIST/);
    assert.equal((await f.health()).instance_id, f.service.instance_id);
    const result = await requestService({ profileRoot: f.profileRoot, operation: 'stop' });
    assert.equal(result.stopped, f.service.instance_id);
  } finally { await f.close(); }
});

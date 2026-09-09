import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { selectFragments } from './lexical-baseline.mjs';
import { compileCapsule, countTokens, renderContext, sha256, TOKENIZER, TOKEN_PROFILES } from './context-capsule.mjs';

const fail = (code) => { throw new Error(code); };
const hashPattern = /^[0-9a-f]{64}$/;
const gitPattern = /^[0-9a-f]{40}$/;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function keys(value, allowed, required = allowed) {
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail('INVALID_CONTRACT_FIELDS');
}
function relative(value) {
  if (!text(value) || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some((part) => ['', '.', '..'].includes(part))) fail('INVALID_RELATIVE_PATH');
  return value;
}
async function inside(root, name) {
  const canonicalRoot = await realpath(root);
  const absolute = await realpath(path.resolve(root, relative(name)));
  const remainder = path.relative(canonicalRoot, absolute);
  if (!remainder || remainder.startsWith(`..${path.sep}`) || remainder === '..' || path.isAbsolute(remainder)) fail('SOURCE_ESCAPED_ROOT');
  return absolute;
}
function uniqueStrings(items) {
  return Array.isArray(items) && items.every(text) && new Set(items).size === items.length;
}

export function validateManifest(manifest) {
  keys(manifest, ['schema', 'corpus_id', 'status', 'provenance', 'sources']);
  if (manifest.schema !== 'histos.source-manifest/v1' || !text(manifest.corpus_id) || !Array.isArray(manifest.sources) || !manifest.sources.length) fail('INVALID_MANIFEST');
  if (!['DRAFT_AWAITING_INDEPENDENT_FREEZE', 'FROZEN'].includes(manifest.status)) fail('INVALID_MANIFEST_STATUS');
  keys(manifest.provenance, ['visibility', 'method', 'license', 'source_authority']);
  if (manifest.provenance.visibility !== 'public' || !Object.values(manifest.provenance).every(text)) fail('INVALID_PUBLIC_PROVENANCE');
  const paths = new Set();
  for (const source of manifest.sources) {
    keys(source, ['path', 'repository', 'commit', 'source_path', 'git_blob', 'sha256', 'bytes', 'line_count', 'source_url']);
    relative(source.path); relative(source.source_path);
    if (paths.has(source.path)) fail('DUPLICATE_SOURCE');
    paths.add(source.path);
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) || !gitPattern.test(source.commit) || !gitPattern.test(source.git_blob) || !hashPattern.test(source.sha256) || !positive(source.bytes) || !positive(source.line_count)) fail('INVALID_SOURCE_IDENTITY');
    if (source.source_url !== `${source.repository}/blob/${source.commit}/${source.source_path}`) fail('INVALID_SOURCE_URL');
  }
  return manifest;
}

export function validateGold(gold, manifest) {
  keys(gold, ['schema', 'suite_id', 'gold_status', 'manifest', 'profiles', 'tokenizer', 'annotation_method', 'cases']);
  if (gold.schema !== 'histos.benchmark-suite/v1' || gold.suite_id !== manifest.corpus_id || !text(gold.annotation_method)) fail('INVALID_GOLD');
  if (!['DRAFT_AWAITING_INDEPENDENT_FREEZE', 'FROZEN'].includes(gold.gold_status)) fail('INVALID_GOLD_STATUS');
  relative(gold.manifest);
  if (!equal(gold.profiles, TOKEN_PROFILES) || !equal(gold.tokenizer, TOKENIZER)) fail('INVALID_TOKEN_CONTRACT');
  if (!Array.isArray(gold.cases) || !gold.cases.length) fail('INVALID_CASES');
  const ids = new Set();
  const sources = new Map(manifest.sources.map((source) => [source.path, source]));
  for (const item of gold.cases) {
    keys(item, ['id', 'split', 'query', 'required_evidence_groups', 'expect_no_answer', 'corpus', 'annotation_note'], ['id', 'split', 'query', 'required_evidence_groups', 'corpus']);
    if (item.annotation_note !== undefined && !text(item.annotation_note)) fail('INVALID_ANNOTATION_NOTE');
    if (!text(item.id) || ids.has(item.id) || !text(item.query) || !['development', 'held_out'].includes(item.split)) fail('INVALID_CASE_ID_OR_SPLIT');
    ids.add(item.id);
    if (!uniqueStrings(item.corpus) || !item.corpus.length || item.corpus.some((name) => !sources.has(name))) fail('INVALID_CASE_CORPUS');
    if (!Array.isArray(item.required_evidence_groups) || (item.expect_no_answer !== undefined && typeof item.expect_no_answer !== 'boolean')) fail('INVALID_GOLD_GROUPS');
    if (item.expect_no_answer === true ? item.required_evidence_groups.length !== 0 : item.required_evidence_groups.length === 0) fail('INVALID_NO_ANSWER_GOLD');
    const groups = new Set();
    for (const group of item.required_evidence_groups) {
      keys(group, ['id', 'rationale', 'ranges']);
      if (!text(group.id) || groups.has(group.id) || !text(group.rationale) || !Array.isArray(group.ranges) || !group.ranges.length) fail('INVALID_GOLD_GROUP');
      groups.add(group.id);
      for (const range of group.ranges) {
        keys(range, ['path', 'start_line', 'end_line']);
        if (!item.corpus.includes(range.path) || !positive(range.start_line) || !positive(range.end_line) || range.start_line > range.end_line || range.end_line > sources.get(range.path).line_count) fail('INVALID_GOLD_RANGE');
      }
    }
  }
  if (!gold.cases.some((item) => item.split === 'held_out')) fail('HELD_OUT_CASE_REQUIRED');
  return gold;
}

async function loadSources(root, manifest) {
  const sources = [];
  for (const source of manifest.sources) {
    const bytes = await readFile(await inside(root, source.path));
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) fail('SOURCE_MOVED');
    const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (gitBlob !== source.git_blob) fail('GIT_BLOB_MISMATCH');
    // Invalid UTF-8 must not silently replace bytes before token accounting.
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const lines = decoded.split(/\r?\n/);
    if (lines.length !== source.line_count) fail('SOURCE_LINES_MOVED');
    sources.push({ ...source, text: decoded, lines });
  }
  return sources;
}

export async function loadFrozenBenchmark(goldPath, freezePath) {
  if (!freezePath) fail('INDEPENDENT_FREEZE_REQUIRED');
  const absoluteGold = path.resolve(goldPath);
  const root = path.dirname(absoluteGold);
  const goldBytes = await readFile(absoluteGold);
  const gold = JSON.parse(goldBytes.toString('utf8'));
  const manifestBytes = await readFile(await inside(root, gold.manifest));
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
  validateGold(gold, manifest);
  const freezeBytes = await readFile(path.resolve(freezePath));
  const freeze = JSON.parse(freezeBytes.toString('utf8'));
  keys(freeze, ['schema', 'status', 'reviewer', 'manifest_sha256', 'gold_sha256', 'reviewed_cases', 'method', 'reviewed_at'], ['schema', 'status', 'reviewer', 'manifest_sha256', 'gold_sha256', 'reviewed_cases', 'method']);
  if (freeze.schema !== 'histos.gold-freeze/v1' || freeze.status !== 'FROZEN' || !text(freeze.reviewer) || !text(freeze.method)) fail('INDEPENDENT_FREEZE_REQUIRED');
  if (freeze.manifest_sha256 !== sha256(manifestBytes) || freeze.gold_sha256 !== sha256(goldBytes)) fail('FREEZE_DIGEST_MISMATCH');
  if (!uniqueStrings(freeze.reviewed_cases) || !equal([...freeze.reviewed_cases].sort(), gold.cases.map((item) => item.id).sort())) fail('INCOMPLETE_INDEPENDENT_REVIEW');
  // Review identity is a signed-off process claim, not a cryptographic proof of identity.
  const sources = await loadSources(root, manifest);
  return { gold, manifest, sources, root, freeze, freeze_sha256: sha256(freezeBytes), snapshot_digest: sha256(manifestBytes) };
}

const overlaps = (fragment, range) => fragment.path === range.path && fragment.start_line <= range.end_line && fragment.end_line >= range.start_line;
const notMeasured = (reason) => ({ status: 'NOT_MEASURED', reason });
export function scoreSelection(fragments, item) {
  const groups = item.required_evidence_groups;
  const hitGroups = groups.filter((group) => group.ranges.some((range) => fragments.some((fragment) => overlaps(fragment, range)))).length;
  const completeGroups = groups.filter((group) => group.ranges.some((range) => {
    for (let line = range.start_line; line <= range.end_line; line++) {
      if (!fragments.some((fragment) => fragment.path === range.path && fragment.start_line <= line && fragment.end_line >= line)) return false;
    }
    return true;
  })).length;
  const goldFragments = fragments.filter((fragment) => groups.some((group) => group.ranges.some((range) => overlaps(fragment, range)))).length;
  let selectedLines = 0;
  let relevantLines = 0;
  for (const fragment of fragments) {
    for (let line = fragment.start_line; line <= fragment.end_line; line++) {
      selectedLines++;
      if (groups.some((group) => group.ranges.some((range) => range.path === fragment.path && line >= range.start_line && line <= range.end_line))) relevantLines++;
    }
  }
  return {
    required_evidence_groups_hit: hitGroups, required_evidence_groups_total: groups.length,
    required_evidence_group_recall: groups.length ? hitGroups / groups.length : null,
    complete_evidence_groups_hit: completeGroups,
    complete_evidence_group_recall: groups.length ? completeGroups / groups.length : null,
    selected_gold_fragments: goldFragments, selected_fragments: fragments.length,
    selected_fragment_gold_precision: fragments.length ? goldFragments / fragments.length : null,
    selected_gold_lines: relevantLines, selected_lines: selectedLines,
    selected_line_gold_precision: selectedLines ? relevantLines / selectedLines : null,
    expected_no_answer_pass: item.expect_no_answer === true ? fragments.length === 0 : null,
  };
}

export async function runFrozenBenchmark(goldPath, { freezePath, profileId = null } = {}) {
  const setupStarted = performance.now();
  const frozen = await loadFrozenBenchmark(goldPath, freezePath);
  const setupMs = performance.now() - setupStarted;
  const { gold, manifest } = frozen;
  const implementation = [];
  for (const relativeFile of ['./frozen-benchmark.mjs', './context-capsule.mjs', './lexical-baseline.mjs', '../../package-lock.json']) {
    const bytes = await readFile(new URL(relativeFile, import.meta.url));
    implementation.push({ path: relativeFile, sha256: sha256(bytes), bytes: bytes.length });
  }
  const profiles = profileId ? gold.profiles.filter((profile) => profile.id === profileId) : gold.profiles;
  if (!profiles.length) fail('UNKNOWN_PROFILE');
  const reports = [];
  for (const profile of profiles) {
    const cases = [];
    for (const item of gold.cases) {
      const started = performance.now();
      // Deliberately re-read and rehash actual source for each request; no hidden cache.
      const corpus = await loadSources(frozen.root, { sources: manifest.sources.filter((source) => item.corpus.includes(source.path)) });
      const selection = selectFragments(corpus, item.query, Number.MAX_SAFE_INTEGER);
      const capsule = compileCapsule({
        goal: item.query, corpus_id: manifest.corpus_id, snapshot_digest: frozen.snapshot_digest,
        sources: manifest.sources.filter((source) => item.corpus.includes(source.path)),
        candidates: selection.candidates, max_tokens: profile.max_tokens,
      });
      const elapsedMs = performance.now() - started;
      const allFragments = corpus.map((source) => ({ path: source.path, source_sha256: source.sha256, start_line: 1, end_line: source.lines.length, text: source.lines.join('\n') }));
      const wholeText = renderContext({ ...capsule, source_fragments: allFragments });
      cases.push({
        case_id: item.id, split: item.split, capsule,
        metrics: {
          ...scoreSelection(capsule.source_fragments, item),
          rendered_tokens: capsule.budget.rendered_tokens, rendered_bytes: capsule.budget.rendered_bytes,
          raw_source_bytes_exposed: capsule.source_fragments.reduce((total, fragment) => total + Buffer.byteLength(fragment.text, 'utf8'), 0),
          raw_source_lines_exposed: capsule.source_fragments.reduce((total, fragment) => total + fragment.end_line - fragment.start_line + 1, 0),
          tool_calls: 0, search_calls: 1, whole_file_reads: corpus.length, reread_count: 0,
          source_bytes_read: corpus.reduce((total, source) => total + source.bytes, 0),
          retrieval_latency_ms: elapsedMs,
          cold_latency: notMeasured('OS page cache was not controlled; retrieval_latency_ms includes fresh application read/hash/search/token compilation'),
          warm_latency: notMeasured('No HISTOS derived cache implemented in this fixed direct-read baseline'),
          cache_hit_rate: { status: 'NOT_APPLICABLE', reason: 'No derived cache', hits: 0, lookups: 0, value: null },
          incremental_update_cost: notMeasured('Incremental index is a later phase'),
          stale_context_harm: notMeasured('Source identity drift fails closed; no stale-context task outcome experiment'),
          verified_task_outcome: notMeasured('No worker/model or patch-generation task executed'),
        },
        whole_file_reference: {
          budget_applied: false, rendered_tokens: countTokens(wholeText), rendered_bytes: Buffer.byteLength(wholeText, 'utf8'),
          raw_source_bytes: corpus.reduce((total, source) => total + source.bytes, 0),
          raw_source_lines: corpus.reduce((total, source) => total + source.lines.length, 0),
          whole_file_reads: corpus.length, search_calls: 0,
          note: 'Counterfactual whole-file exposure from the same loaded source; not a second IO or model experiment',
        },
      });
    }
    reports.push({ profile: profile.id, max_tokens: profile.max_tokens, cases });
  }
  return {
    schema: 'histos.frozen-benchmark-report/v1', suite_id: gold.suite_id,
    implementation,
    freeze: { reviewer: frozen.freeze.reviewer, freeze_sha256: frozen.freeze_sha256, gold_sha256: frozen.freeze.gold_sha256, manifest_sha256: frozen.snapshot_digest },
    tokenizer: TOKENIZER, scoring: 'fixed lexical v0 ranking; whole rendered-context token admission; overlapping group recall and fragment/line precision',
    setup: { validation_latency_ms: setupMs, whole_file_reads: manifest.sources.length, note: 'One preflight read per source, separate from per-request metrics; runtime/module initialization excluded' },
    measurement_scope: 'One direct local retrieval request per case/profile. Tool calls mean external agent tools (zero); search calls mean one corpus lexical scan. Reread is duplicate same-file read within that request, excluding separately reported preflight. Timing is nondeterministic; source, selection and tokens are deterministic.',
    claim_boundary: 'Retrieval-only experimental evidence; no end-to-end model quality or production runtime gain claimed',
    reports,
  };
}

const cli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (cli) {
  const [goldPath, freezePath, profileId, ...extra] = process.argv.slice(2);
  if (!goldPath || !freezePath || extra.length) {
    process.stderr.write('usage: node tools/bench/frozen-benchmark.mjs <gold.json> <freeze.json> [2k|4k|8k]\n');
    process.exitCode = 2;
  } else {
    runFrozenBenchmark(goldPath, { freezePath, profileId }).then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  }
}

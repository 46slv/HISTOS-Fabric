import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { createProviderDescriptor } from './provider-boundary.mjs';

/**
 * Read-only Kura comparison boundary.
 *
 * This module intentionally does not import Kura or write a Kura store.  The
 * adapter reads a reviewed, content-addressed JSON export produced by an
 * already pinned Kura deployment.  This keeps the benchmark runnable on a
 * clean HISTOS host while preserving the important boundary: Kura is an
 * alternate MemoryProvider, not an authority or a direct write path.
 */

export const KURA_READONLY_SCHEMA = 'histos.kura-readonly/v1';
export const KURA_READONLY_STORE_SCHEMA = 'histos.kura-readonly-store/v1';
export const KURA_READONLY_REPORT_SCHEMA = 'histos.kura-readonly-report/v1';
export const KURA_UPSTREAM = Object.freeze({
  repository: 'https://github.com/lna-lab/distill-kura',
  commit: '33aec61dcd28076848bfdfa9dfdf5902300fe109',
  version: 'master@33aec61',
});

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PATH = /^[^\\/][^\\]*$/u;

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function boundedString(value, code, max = 20000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function normalizeId(value, code) {
  if (typeof value !== 'string' || !ID.test(value)) fail(code);
  return value;
}

function normalizeScope(scope, code = 'KURA_SCOPE_REQUIRED') {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail(code);
  const scope_id = normalizeId(scope.scope_id ?? scope.scopeId, code);
  const snapshot_digest = scope.snapshot_digest ?? scope.source_snapshot_sha256 ?? scope.snapshot_sha256;
  if (snapshot_digest !== undefined && !SHA256.test(snapshot_digest)) fail('KURA_SCOPE_SNAPSHOT_INVALID');
  let paths;
  if (scope.paths !== undefined) {
    if (!Array.isArray(scope.paths) || !scope.paths.length) fail('KURA_SCOPE_PATHS_INVALID');
    paths = [...new Set(scope.paths.map(path => {
      if (typeof path !== 'string' || !path.trim() || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('KURA_SCOPE_PATHS_INVALID');
      return path;
    }))].sort();
  }
  return { scope_id, ...(snapshot_digest ? { snapshot_digest } : {}), ...(paths ? { paths } : {}) };
}

function normalizeEvidence(ref, scope) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) fail('KURA_EVIDENCE_REF_INVALID');
  const kind = boundedString(ref.kind ?? 'source', 'KURA_EVIDENCE_KIND_INVALID', 64);
  const path = boundedString(ref.path ?? ref.source_path ?? '', 'KURA_EVIDENCE_PATH_INVALID', 1024);
  if (!PATH.test(path) || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('KURA_EVIDENCE_PATH_INVALID');
  if (scope.paths && !scope.paths.includes(path)) fail('KURA_EVIDENCE_OUT_OF_SCOPE');
  const snapshot_digest = ref.snapshot_digest ?? ref.source_snapshot_sha256 ?? scope.snapshot_digest;
  if (snapshot_digest !== undefined && !SHA256.test(snapshot_digest)) fail('KURA_EVIDENCE_SNAPSHOT_INVALID');
  if (scope.snapshot_digest && snapshot_digest && snapshot_digest !== scope.snapshot_digest) fail('KURA_EVIDENCE_STALE');
  const quote = ref.quote === undefined ? undefined : boundedString(ref.quote, 'KURA_EVIDENCE_QUOTE_INVALID', 1000);
  const line = ref.line === undefined ? undefined : Number(ref.line);
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) fail('KURA_EVIDENCE_LINE_INVALID');
  if (ref.sha256 !== undefined && !SHA256.test(ref.sha256)) fail('KURA_EVIDENCE_DIGEST_INVALID');
  return {
    kind,
    path,
    ...(line !== undefined ? { line } : {}),
    ...(quote !== undefined ? { quote } : {}),
    ...(snapshot_digest ? { snapshot_digest } : {}),
    ...(ref.sha256 !== undefined ? { sha256: boundedString(ref.sha256, 'KURA_EVIDENCE_DIGEST_INVALID', 128) } : {}),
  };
}

function normalizeMemory(record, scope) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('KURA_MEMORY_INVALID');
  const slug = normalizeId(record.slug ?? record.id, 'KURA_MEMORY_ID_INVALID');
  const title = boundedString(record.title ?? slug, 'KURA_MEMORY_TITLE_INVALID', 512);
  const body = boundedString(record.body ?? record.text ?? '', 'KURA_MEMORY_BODY_INVALID', 20000);
  const tags = Array.isArray(record.tags) ? [...new Set(record.tags.map(tag => boundedString(tag, 'KURA_MEMORY_TAG_INVALID', 128)))] : [];
  const evidence = (record.evidence ?? record.evidence_refs ?? record.references ?? []).map(ref => normalizeEvidence(ref, scope));
  if (!evidence.length) fail('KURA_MEMORY_EVIDENCE_REQUIRED');
  const quotes = [...new Set((record.quotes ?? evidence.map(ref => ref.quote).filter(Boolean)).map(quote => boundedString(quote, 'KURA_MEMORY_QUOTE_INVALID', 1000)))];
  const source_snapshot_sha256 = record.source_snapshot_sha256 ?? scope.snapshot_digest;
  if (source_snapshot_sha256 !== undefined && !SHA256.test(source_snapshot_sha256)) fail('KURA_MEMORY_SNAPSHOT_INVALID');
  if (scope.snapshot_digest && source_snapshot_sha256 && source_snapshot_sha256 !== scope.snapshot_digest) fail('KURA_MEMORY_STALE');
  return {
    slug,
    title,
    body,
    tags,
    evidence,
    quotes,
    scope_id: scope.scope_id,
    ...(source_snapshot_sha256 ? { source_snapshot_sha256 } : {}),
    authority: 'none',
    current_truth: false,
  };
}

function normalizeStore(raw, { storeId, scope }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('KURA_STORE_INVALID');
  if (raw.schema !== KURA_READONLY_STORE_SCHEMA) fail('KURA_STORE_SCHEMA_INVALID');
  const actualStore = normalizeId(raw.store_id ?? raw.store, 'KURA_STORE_ID_INVALID');
  if (actualStore !== storeId) fail('KURA_STORE_MISMATCH');
  const actualScope = normalizeScope(raw.scope ?? { scope_id: raw.scope_id, snapshot_digest: raw.snapshot_digest }, 'KURA_STORE_SCOPE_INVALID');
  if (actualScope.scope_id !== scope.scope_id) fail('KURA_SCOPE_MISMATCH');
  if (scope.paths && JSON.stringify(actualScope.paths ?? []) !== JSON.stringify(scope.paths)) fail('KURA_SCOPE_PATHS_MISMATCH');
  const snapshot_digest = raw.snapshot_digest ?? actualScope.snapshot_digest;
  if (!snapshot_digest || !SHA256.test(snapshot_digest)) fail('KURA_STORE_SNAPSHOT_INVALID');
  if (scope.snapshot_digest && scope.snapshot_digest !== snapshot_digest) fail('KURA_SCOPE_SNAPSHOT_MISMATCH');
  const memories = raw.memories;
  if (!Array.isArray(memories) || memories.length > 1000) fail('KURA_STORE_MEMORIES_INVALID');
  const normalizedScope = { ...scope, snapshot_digest };
  const normalized = memories.map(memory => normalizeMemory(memory, normalizedScope));
  const slugs = new Set();
  for (const memory of normalized) {
    if (slugs.has(memory.slug)) fail('KURA_MEMORY_DUPLICATE');
    slugs.add(memory.slug);
  }
  return {
    schema: KURA_READONLY_STORE_SCHEMA,
    store_id: actualStore,
    scope: normalizedScope,
    snapshot_digest,
    revision: boundedString(raw.revision ?? snapshot_digest.slice(0, 12), 'KURA_STORE_REVISION_INVALID', 256),
    memories: normalized,
  };
}

async function readStore(storePath, options) {
  if (typeof storePath !== 'string' || !storePath.trim()) fail('KURA_STORE_PATH_REQUIRED');
  let raw;
  try {
    raw = JSON.parse(await readFile(storePath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`KURA_STORE_READ_FAILED:${error.code ?? error.name ?? 'unknown'}`);
    wrapped.cause = error;
    throw wrapped;
  }
  return normalizeStore(raw, options);
}

function assertScope(inputScope, boundScope) {
  if (inputScope === undefined || inputScope === null) return clone(boundScope);
  const scope = normalizeScope(inputScope);
  if (scope.scope_id !== boundScope.scope_id) fail('KURA_SCOPE_MISMATCH');
  if (boundScope.snapshot_digest && scope.snapshot_digest && scope.snapshot_digest !== boundScope.snapshot_digest) fail('KURA_SCOPE_SNAPSHOT_MISMATCH');
  if (boundScope.paths && scope.paths && scope.paths.some(path => !boundScope.paths.includes(path))) fail('KURA_SCOPE_OUT_OF_BOUNDS');
  return { ...boundScope, ...scope, ...(boundScope.paths ? { paths: boundScope.paths } : {}) };
}

function tokenize(value) {
  return [...new Set(String(value ?? '').toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [])];
}

function scoreMemory(memory, query) {
  const queryTerms = tokenize(query);
  const terms = new Set(tokenize([memory.title, memory.body, ...memory.tags].join(' ')));
  return queryTerms.reduce((score, term) => score + (terms.has(term) ? 1 : 0), 0);
}

function renderMemory(memory, maxChars) {
  const text = `${memory.title}\n${memory.body}`;
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}

function memoryResult(memory, scope, rendered) {
  const evidence_refs = memory.evidence.map(ref => ({ ...ref }));
  return {
    slug: memory.slug,
    title: memory.title,
    body: rendered,
    tags: [...memory.tags],
    evidence_refs,
    quotes: [...memory.quotes],
    scope_id: scope.scope_id,
    snapshot_digest: scope.snapshot_digest,
    source_snapshot_sha256: scope.snapshot_digest,
    authority: 'none',
    current_truth: false,
    classification: 'recalled_memory',
  };
}

function summarizeContext(records) {
  const context_bytes = records.reduce((total, record) => total + Buffer.byteLength(`${record.title}\n${record.body}`, 'utf8'), 0);
  const context_tokens = Math.ceil(context_bytes / 4);
  return { context_bytes, context_tokens };
}

/**
 * Create a Kura alternate MemoryProvider over a read-only JSON export.
 *
 * The first successful read binds the provider to the store snapshot.  A
 * changed snapshot is refused until the caller constructs a fresh provider
 * (an explicit refresh/new-snapshot boundary).  There is deliberately no
 * write/capture/distill method.
 */
export function createKuraReadOnlyProvider({ storePath, storeId, scope, upstream = KURA_UPSTREAM, expectedSnapshotDigest = null } = {}) {
  const boundScope = normalizeScope(scope);
  const boundStore = normalizeId(storeId, 'KURA_STORE_ID_REQUIRED');
  if (!upstream || upstream.repository !== KURA_UPSTREAM.repository || upstream.commit !== KURA_UPSTREAM.commit || upstream.version !== KURA_UPSTREAM.version) fail('KURA_UPSTREAM_PIN_REQUIRED');
  const descriptor = createProviderDescriptor({
    provider_id: `kura-readonly-${boundStore}`,
    provider_kind: 'MemoryProvider',
    version: `kura-readonly-${upstream.commit.slice(0, 12)}`,
    capabilities: ['read', 'search', 'snapshot'],
    privacy: { egress: 'none', classification: 'project', secrets_allowed: false },
    grounding: { mode: 'provider', requires_evidence_refs: true, preserves_lineage: true, output_classes: ['recalled_memory', 'retained_evidence'] },
    scope_requirements: { required_fields: ['scope_id', 'snapshot_digest'] },
    status: 'experimental',
  });

  let boundDigest = expectedSnapshotDigest ?? boundScope.snapshot_digest ?? null;

  async function load() {
    const snapshot = await readStore(storePath, { storeId: boundStore, scope: boundScope });
    if (boundDigest === null) boundDigest = snapshot.snapshot_digest;
    if (snapshot.snapshot_digest !== boundDigest) fail('KURA_STALE_STORE_SNAPSHOT');
    return snapshot;
  }

  function operationScope(input = {}) {
    return assertScope(input.scope, { ...boundScope, ...(boundDigest ? { snapshot_digest: boundDigest } : {}) });
  }

  async function snapshot(input = {}) {
    const requestedScope = operationScope(input);
    const store = await load();
    return {
      schema: 'histos.kura-readonly-snapshot/v1',
      store_id: store.store_id,
      scope_id: requestedScope.scope_id,
      snapshot_digest: store.snapshot_digest,
      revision: store.revision,
      memory_count: store.memories.length,
      upstream: clone(upstream),
      authority: 'none',
      current_truth: false,
    };
  }

  async function read(input = {}) {
    const requestedScope = operationScope(input);
    const store = await load();
    const slug = normalizeId(input.slug ?? input.id, 'KURA_MEMORY_ID_REQUIRED');
    const memory = store.memories.find(entry => entry.slug === slug);
    if (!memory) fail('KURA_MEMORY_NOT_FOUND');
    const rendered = renderMemory(memory, Number.isInteger(input.maxChars ?? input.max_chars) ? Math.max(1, Math.min(20000, input.maxChars ?? input.max_chars)) : 20000);
    return memoryResult(memory, requestedScope, rendered);
  }

  async function recall(input = {}) {
    const requestedScope = operationScope(input);
    const store = await load();
    const query = boundedString(input.query ?? input.question ?? '', 'KURA_QUERY_REQUIRED', 2000);
    const maxResults = Math.max(1, Math.min(20, Number.isInteger(input.maxResults ?? input.max_results) ? (input.maxResults ?? input.max_results) : 5));
    const maxChars = Math.max(64, Math.min(20000, Number.isInteger(input.maxChars ?? input.max_chars) ? (input.maxChars ?? input.max_chars) : 4000));
    const ranked = store.memories.map(memory => ({ memory, score: scoreMemory(memory, query) }))
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.memory.slug.localeCompare(right.memory.slug))
      .slice(0, maxResults);
    const records = [];
    let remaining = maxChars;
    for (const { memory, score } of ranked) {
      if (remaining <= 0) break;
      const record = memoryResult(memory, requestedScope, renderMemory(memory, remaining));
      const renderedBytes = Buffer.byteLength(`${record.title}\n${record.body}`, 'utf8');
      if (records.length && renderedBytes > remaining) break;
      records.push({ ...record, score });
      remaining -= renderedBytes;
    }
    const context = summarizeContext(records);
    return {
      schema: 'histos.kura-readonly-recall/v1',
      store_id: store.store_id,
      scope_id: requestedScope.scope_id,
      snapshot_digest: store.snapshot_digest,
      query,
      records,
      refusals: records.length ? [] : [{ code: 'KURA_ABSTAIN_NO_MATCH', query }],
      abstained: records.length === 0,
      ...context,
      upstream: clone(upstream),
      authority: 'none',
      current_truth: false,
    };
  }

  async function evaluateCandidate(input = {}) {
    const requestedScope = operationScope(input);
    const store = await load();
    return evaluateKuraCandidate({ store, scope: requestedScope, candidate: input.candidate ?? input });
  }

  function rejectWrite() {
    fail('KURA_READ_ONLY_WRITE_REJECTED');
  }

  return {
    descriptor,
    scope: clone(boundScope),
    storeId: boundStore,
    upstream: clone(upstream),
    snapshot,
    read,
    recall,
    evaluateCandidate,
    remember: rejectWrite,
    write: rejectWrite,
    distill: rejectWrite,
    invoke(operation, input = {}) {
      if (operation === 'snapshot') return snapshot(input);
      if (operation === 'read' || operation === 'read_memory') return read(input);
      if (operation === 'recall' || operation === 'retrieve' || operation === 'search') return recall(input);
      if (operation === 'remember' || operation === 'write' || operation === 'capture' || operation === 'distill' || operation === 'admin') return rejectWrite();
      fail('PROVIDER_OPERATION_UNSUPPORTED');
    },
  };
}

/**
 * Apply the Kura quote/echo floor without writing a store.  This mirrors the
 * upstream deterministic gate: exact quotes must descend to reviewed evidence
 * and a quote already present in the store is not new material.
 */
export function evaluateKuraCandidate({ store, scope, candidate } = {}) {
  if (!store || typeof store !== 'object' || !Array.isArray(store.memories)) fail('KURA_STORE_REQUIRED');
  const requestedScope = normalizeScope(scope ?? store.scope);
  if (store.scope?.scope_id && store.scope.scope_id !== requestedScope.scope_id) fail('KURA_SCOPE_MISMATCH');
  const body = boundedString(candidate?.body ?? candidate?.text ?? '', 'KURA_CANDIDATE_BODY_REQUIRED', 20000);
  const quotes = [...new Set((candidate?.quotes ?? candidate?.evidence_quotes ?? []).map(quote => boundedString(quote, 'KURA_CANDIDATE_QUOTE_INVALID', 1000)))];
  const existing = new Set(store.memories.flatMap(memory => [memory.body, ...(memory.quotes ?? [])]));
  const echoed = quotes.filter(quote => existing.has(quote) || existing.has(body) || store.memories.some(memory => memory.body === body));
  if (echoed.length) {
    return {
      schema: 'histos.kura-readonly-candidate/v1',
      accepted: false,
      reason: 'STORE_ECHO',
      surviving_quotes: [],
      echoed_quotes: echoed,
      scope_id: requestedScope.scope_id,
      authority: 'none',
      current_truth: false,
    };
  }
  const evidenceText = store.memories.flatMap(memory => [memory.body, ...(memory.quotes ?? []), ...memory.evidence.map(ref => ref.quote).filter(Boolean)]);
  const surviving_quotes = quotes.filter(quote => evidenceText.some(text => text.includes(quote)));
  if (!surviving_quotes.length) {
    return {
      schema: 'histos.kura-readonly-candidate/v1',
      accepted: false,
      reason: 'QUOTE_NOT_FOUND',
      surviving_quotes: [],
      echoed_quotes: [],
      scope_id: requestedScope.scope_id,
      authority: 'none',
      current_truth: false,
    };
  }
  return {
    schema: 'histos.kura-readonly-candidate/v1',
    accepted: true,
    reason: 'EVIDENCE_QUOTE_SURVIVES',
    surviving_quotes,
    echoed_quotes: [],
    scope_id: requestedScope.scope_id,
    authority: 'none',
    current_truth: false,
  };
}

function normalizeProbeResult(result) {
  if (!result || typeof result !== 'object') return { records: [], refusals: [{ code: 'INVALID_PROVIDER_RESULT' }], context_bytes: 0, context_tokens: 0 };
  return {
    records: Array.isArray(result.records) ? result.records : [],
    refusals: Array.isArray(result.refusals) ? result.refusals : [],
    context_bytes: Number.isFinite(result.context_bytes) ? result.context_bytes : summarizeContext(Array.isArray(result.records) ? result.records : []).context_bytes,
    context_tokens: Number.isFinite(result.context_tokens) ? result.context_tokens : summarizeContext(Array.isArray(result.records) ? result.records : []).context_tokens,
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

async function evaluateProvider({ id, version, recall, cases, scope, budget, clock }) {
  const rows = [];
  const latencies = [];
  for (const testCase of cases) {
    const started = clock();
    let result;
    let error = null;
    try {
      result = normalizeProbeResult(await recall({ query: testCase.query, scope, maxResults: budget.max_results, maxChars: budget.max_chars }));
    } catch (caught) {
      error = caught;
      result = { records: [], refusals: [{ code: caught?.message ?? 'PROVIDER_ERROR' }], context_bytes: 0, context_tokens: 0 };
    }
    const elapsed = Math.max(0, Number(clock()) - Number(started));
    latencies.push(elapsed);
    const slugs = result.records.map(record => record.slug ?? record.id).filter(Boolean);
    const expected = testCase.expected_slug ?? null;
    const recallHit = expected ? slugs.includes(expected) : false;
    const falseRecall = !expected && slugs.length > 0;
    const abstained = !expected && slugs.length === 0;
    const hit = expected ? result.records.find(record => (record.slug ?? record.id) === expected) : null;
    const evidenceDescent = Boolean(hit && Array.isArray(hit.evidence_refs ?? hit.evidence) && (hit.evidence_refs ?? hit.evidence).length);
    rows.push({
      id: testCase.id,
      query: testCase.query,
      expected_slug: expected,
      returned_slugs: slugs,
      recall_hit: recallHit,
      false_recall: falseRecall,
      abstained,
      evidence_descent: evidenceDescent,
      context_bytes: result.context_bytes,
      context_tokens: result.context_tokens,
      latency_ms: elapsed,
      refused: Boolean(error),
      ...(error ? { refusal_code: error.message } : {}),
    });
  }
  const expectedCases = rows.filter(row => row.expected_slug);
  const negativeCases = rows.filter(row => !row.expected_slug);
  const recallHits = expectedCases.filter(row => row.recall_hit).length;
  const falseRecalls = negativeCases.filter(row => row.false_recall).length;
  const abstentions = negativeCases.filter(row => row.abstained).length;
  const descentHits = expectedCases.filter(row => row.evidence_descent).length;
  return {
    provider: { id, version },
    cases: rows,
    summary: {
      cases: rows.length,
      expected: expectedCases.length,
      recall_hits: recallHits,
      recall_denominator: expectedCases.length,
      recall_rate: expectedCases.length ? recallHits / expectedCases.length : null,
      false_recall: falseRecalls,
      false_recall_denominator: negativeCases.length,
      abstentions,
      abstention_denominator: negativeCases.length,
      evidence_descent_hits: descentHits,
      evidence_descent_denominator: expectedCases.length,
      evidence_descent_rate: expectedCases.length ? descentHits / expectedCases.length : null,
      context_bytes: rows.reduce((sum, row) => sum + row.context_bytes, 0),
      context_tokens: rows.reduce((sum, row) => sum + row.context_tokens, 0),
      latency_ms: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? Math.max(...latencies) : null,
      },
    },
  };
}

/**
 * Compare Kura read/recall and a native/lexical callback on identical cases.
 * Callers may supply restart/stale probes; absent host capabilities are explicit
 * NOT_RUN entries rather than synthetic passes.
 */
export async function runKuraReadOnlyComparison({ scope, cases, kuraProvider, baselineRecall, baselineId = 'native-h03-lexical', baselineVersion = 'native-h03-v1', budget = {}, restartFactory = null, staleProbe = null, clock = () => performance.now(), limitations = [] } = {}) {
  const normalizedScope = normalizeScope(scope);
  if (!Array.isArray(cases) || !cases.length) fail('KURA_BENCH_CASES_REQUIRED');
  if (!kuraProvider || typeof kuraProvider.recall !== 'function') fail('KURA_PROVIDER_REQUIRED');
  if (typeof baselineRecall !== 'function') fail('KURA_BASELINE_REQUIRED');
  const normalizedBudget = {
    max_results: Math.max(1, Math.min(20, Number.isInteger(budget.max_results ?? budget.maxResults) ? (budget.max_results ?? budget.maxResults) : 5)),
    max_chars: Math.max(64, Math.min(20000, Number.isInteger(budget.max_chars ?? budget.maxChars) ? (budget.max_chars ?? budget.maxChars) : 4000)),
  };
  const normalizedCases = cases.map(testCase => {
    if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) fail('KURA_BENCH_CASE_INVALID');
    return {
      id: normalizeId(testCase.id, 'KURA_BENCH_CASE_ID_INVALID'),
      query: boundedString(testCase.query, 'KURA_BENCH_QUERY_INVALID', 2000),
      ...(testCase.expected_slug ? { expected_slug: normalizeId(testCase.expected_slug, 'KURA_BENCH_EXPECTED_ID_INVALID') } : {}),
    };
  });
  const kuraResults = await evaluateProvider({
    id: kuraProvider.descriptor?.provider_id ?? 'kura-readonly',
    version: kuraProvider.descriptor?.version ?? `kura-readonly-${KURA_UPSTREAM.commit.slice(0, 12)}`,
    recall: input => kuraProvider.recall(input),
    cases: normalizedCases,
    scope: normalizedScope,
    budget: normalizedBudget,
    clock,
  });
  const baselineResults = await evaluateProvider({
    id: baselineId,
    version: baselineVersion,
    recall: baselineRecall,
    cases: normalizedCases,
    scope: normalizedScope,
    budget: normalizedBudget,
    clock,
  });
  let restart = { status: 'NOT_RUN', reason: 'restartFactory_not_supplied' };
  if (typeof restartFactory === 'function') {
    const positive = normalizedCases.find(testCase => testCase.expected_slug);
    if (!positive) restart = { status: 'NOT_RUN', reason: 'no_positive_case' };
    else {
      try {
        const fresh = await restartFactory();
        const before = await kuraProvider.recall({ query: positive.query, scope: normalizedScope, maxResults: normalizedBudget.max_results, maxChars: normalizedBudget.max_chars });
        const after = await fresh.recall({ query: positive.query, scope: normalizedScope, maxResults: normalizedBudget.max_results, maxChars: normalizedBudget.max_chars });
        const beforeSlugs = (before.records ?? []).map(record => record.slug ?? record.id);
        const afterSlugs = (after.records ?? []).map(record => record.slug ?? record.id);
        restart = {
          status: JSON.stringify(beforeSlugs) === JSON.stringify(afterSlugs) && before.snapshot_digest === after.snapshot_digest ? 'PASS' : 'FAIL',
          query: positive.query,
          before_slugs: beforeSlugs,
          after_slugs: afterSlugs,
          before_snapshot_digest: before.snapshot_digest,
          after_snapshot_digest: after.snapshot_digest,
        };
      } catch (error) {
        restart = { status: 'FAIL', error: error.message };
      }
    }
  }
  let stale = { status: 'NOT_RUN', reason: 'staleProbe_not_supplied' };
  if (typeof staleProbe === 'function') {
    try {
      stale = await staleProbe({ provider: kuraProvider, scope: normalizedScope });
      if (!stale || typeof stale !== 'object' || !['PASS', 'FAIL', 'NOT_RUN'].includes(stale.status)) stale = { status: 'FAIL', reason: 'staleProbe_invalid_result' };
    } catch (error) {
      stale = { status: 'FAIL', error: error.message };
    }
  }
  let readOnly = { status: 'NOT_RUN', reason: 'provider_write_probe_not_run' };
  try {
    await kuraProvider.invoke('remember', { scope: normalizedScope, slug: 'blocked', body: 'blocked' });
    readOnly = { status: 'FAIL', reason: 'write_call_succeeded' };
  } catch (error) {
    readOnly = { status: error.message === 'KURA_READ_ONLY_WRITE_REJECTED' || error.message === 'PROVIDER_OPERATION_UNSUPPORTED' ? 'PASS' : 'FAIL', refusal: error.message };
  }
  return {
    schema: KURA_READONLY_REPORT_SCHEMA,
    fixture: {
      scope: normalizedScope,
      budget: normalizedBudget,
      cases: normalizedCases,
      equal_task_and_scope: true,
    },
    upstream: clone(kuraProvider.upstream ?? KURA_UPSTREAM),
    providers: {
      kura: {
        ...kuraResults,
        store_id: kuraProvider.storeId ?? null,
        comparison_role: 'alternate_read_only_memory_provider',
      },
      baseline: {
        ...baselineResults,
        comparison_role: 'native_h03_or_lexical_baseline',
      },
    },
    recovery: { restart, stale_input: stale },
    read_only_enforcement: readOnly,
    limitations: [...new Set([
      'No paid/provider model call was used; this is a deterministic read/recall comparison.',
      'Kura writes/distillation are intentionally out of scope for R4; H03 remains the host trust boundary.',
      ...limitations,
    ])],
    authority_boundary: 'authority=none,current_truth=false; recalled memory is not current truth or Mission authority',
  };
}

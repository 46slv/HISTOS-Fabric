import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const INDEX_SCHEMA = 'histos.relationship-index/v0';
const REPORT_SCHEMA = 'histos.relationship-evaluation/v0';
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PATH_REJECT = /(^|\/)(?:\.|\.\.)($|\/)/u;
const RELATION_TYPES = ['contradicts', 'supersedes'];
const RELATION_SET = new Set(RELATION_TYPES);
const STATUSES = new Set(['candidate', 'verified', 'deprecated']);
const DEFAULT_LIMITS = Object.freeze({
  max_nodes: 512,
  max_edges: 2048,
  max_depth: 3,
  max_fanout: 32,
  max_results: 16,
  max_query_tokens: 32,
});

const digest = (value) => createHash('sha256').update(value).digest('hex');

function fail(code) {
  throw new Error(code);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return digest(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
}

function assertSha(value, code) {
  if (!SHA256_RE.test(value ?? '')) fail(code);
  return value;
}

function normalizePath(value, code = 'INVALID_RELATION_PATH') {
  if (typeof value !== 'string' || !value || value.includes(':')) fail(code);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || PATH_REJECT.test(normalized) || normalized.includes('//')) fail(code);
  return normalized;
}

function uniqueSorted(values, code) {
  if (!Array.isArray(values)) fail(code);
  const normalized = values.map((value) => normalizePath(value, code));
  if (new Set(normalized).size !== normalized.length) fail(code);
  return normalized.sort((a, b) => a.localeCompare(b));
}

function normalizeScope(input) {
  if (!input || typeof input.scope_id !== 'string' || !input.scope_id.trim()) fail('INVALID_RELATION_SCOPE');
  const sourcePaths = uniqueSorted(input.source_paths ?? [], 'INVALID_RELATION_SCOPE_PATHS');
  const evidencePaths = uniqueSorted(input.evidence_paths ?? [], 'INVALID_RELATION_SCOPE_PATHS');
  const result = { scope_id: input.scope_id, source_paths: sourcePaths, evidence_paths: evidencePaths };
  if (input.source_snapshot_digest !== undefined) assertSha(input.source_snapshot_digest, 'INVALID_SOURCE_SNAPSHOT');
  if (input.source_snapshot_digest !== undefined) result.source_snapshot_digest = input.source_snapshot_digest;
  return result;
}

function normalizeLimits(input = {}) {
  const limits = { ...DEFAULT_LIMITS, ...input };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_RELATION_LIMITS');
    limits[key] = value;
  }
  if (limits.max_results > limits.max_nodes || limits.max_depth > limits.max_nodes) fail('INVALID_RELATION_LIMITS');
  return limits;
}

function normalizeQueryLimit(value, fallback, maximum) {
  if (value === null || value === undefined) return Math.min(fallback, maximum);
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_RELATION_QUERY_LIMIT');
  return Math.min(value, maximum);
}

function identity(ref) {
  const value = {
    kind: ref.kind,
    path: normalizePath(ref.path),
    sha256: assertSha(ref.sha256, 'INVALID_RELATION_REFERENCE'),
    bytes: ref.bytes,
  };
  if (!['source', 'evidence'].includes(value.kind) || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    fail('INVALID_RELATION_REFERENCE');
  }
  if (ref.start_line !== undefined || ref.end_line !== undefined) {
    if (!Number.isSafeInteger(ref.start_line) || !Number.isSafeInteger(ref.end_line) || ref.start_line < 1 || ref.end_line < ref.start_line) {
      fail('INVALID_RELATION_REFERENCE');
    }
    value.start_line = ref.start_line;
    value.end_line = ref.end_line;
  }
  return value;
}

function sourceKey(item) {
  return `${item.kind}:${item.path}`;
}

function normalizeSources(sources, scope) {
  if (!Array.isArray(sources)) fail('INVALID_RELATION_SOURCES');
  const normalized = sources.map((source) => {
    if (!source || typeof source.path !== 'string') fail('INVALID_RELATION_SOURCE');
    const item = identity({ ...source, kind: source.kind ?? 'source' });
    if (source.scope_id !== undefined && source.scope_id !== scope.scope_id) fail('SOURCE_SCOPE_MISMATCH');
    return { ...item, scope_id: scope.scope_id };
  });
  const keys = new Set();
  for (const item of normalized) {
    if (keys.has(sourceKey(item))) fail('DUPLICATE_RELATION_SOURCE');
    keys.add(sourceKey(item));
  }
  normalized.sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  return normalized;
}

function sourceSnapshotDigest(sources) {
  return sha256(canonical(sources.map(({ kind, path, sha256: sourceSha, bytes }) => ({ kind, path, sha256: sourceSha, bytes }))));
}

function normalizeRelations(relations) {
  if (relations === undefined || relations === null) return { contradicts: [], supersedes: [] };
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) fail('INVALID_RELATION_SET');
  for (const key of Object.keys(relations)) if (!RELATION_SET.has(key)) fail('UNSUPPORTED_RELATION');
  const output = {};
  for (const type of RELATION_TYPES) {
    const values = relations[type] ?? [];
    if (!Array.isArray(values) || values.some((id) => typeof id !== 'string' || !ID_RE.test(id))) fail('INVALID_RELATION_SET');
    if (new Set(values).size !== values.length) fail('DUPLICATE_RELATION');
    output[type] = [...values].sort((a, b) => a.localeCompare(b));
  }
  const overlap = output.contradicts.filter((id) => output.supersedes.includes(id));
  if (overlap.length) fail('CONFLICTING_RELATION');
  return output;
}

function normalizeRecordEnvelope(input, scope, sourceMap) {
  if (!input || typeof input !== 'object' || !input.record || typeof input.record !== 'object') fail('INVALID_RELATION_RECORD');
  const record = input.record;
  const recordSha = assertSha(input.record_sha256, 'MISSING_RECORD_CHECKSUM');
  if (sha256(canonical(record)) !== recordSha) fail('RECORD_CHECKSUM_MISMATCH');
  if (!ID_RE.test(record.id ?? '') || !STATUSES.has(record.status) || record.scope_id !== scope.scope_id) fail('INVALID_RELATION_RECORD');
  if (record.authority !== 'none' || record.current_truth !== false) fail('AUTHORITY_BOUNDARY_VIOLATION');
  if (typeof record.title !== 'string' || typeof record.summary !== 'string' || typeof record.details !== 'string') fail('INVALID_RELATION_RECORD');
  const claimSha = record.claim_sha256 ?? record.verification?.claim_sha256;
  assertSha(claimSha, 'MISSING_CLAIM_CHECKSUM');
  if (!Array.isArray(record.references) || record.references.length === 0) fail('RELATION_RECORD_REQUIRES_REFERENCE');
  const references = record.references.map(identity);
  for (const ref of references) {
    const allowedPaths = ref.kind === 'source' ? scope.source_paths : scope.evidence_paths;
    if (allowedPaths.length > 0 && !allowedPaths.includes(ref.path)) fail('RELATION_REFERENCE_OUT_OF_SCOPE');
    const expected = sourceMap.get(`${ref.kind}:${ref.path}`);
    if (!expected) fail('RELATION_REFERENCE_OUT_OF_SCOPE');
    if (expected.sha256 !== ref.sha256 || expected.bytes !== ref.bytes) fail('RELATION_REFERENCE_STALE_OR_FORGED');
  }
  const relations = normalizeRelations(record.relations);
  return {
    id: record.id,
    record,
    record_sha256: recordSha,
    claim_sha256: claimSha,
    references,
    relations,
    searchable: `${record.id} ${record.kind ?? ''} ${record.title} ${record.summary} ${record.details}`.normalize('NFKC').toLocaleLowerCase(),
  };
}

function coreForDigest(index) {
  const { derived_digest: ignored, ...core } = index;
  return core;
}

export function sealRecord(record) {
  if (!record || typeof record !== 'object') fail('INVALID_RELATION_RECORD');
  return { record, record_sha256: sha256(canonical(record)) };
}

export function buildTypedRelationshipIndex({ scope: inputScope, records, sources, limits: inputLimits = {} }) {
  const scope = normalizeScope(inputScope);
  const limits = normalizeLimits(inputLimits);
  const normalizedSources = normalizeSources(sources, scope);
  const sourceSnapshot = sourceSnapshotDigest(normalizedSources);
  if (scope.source_snapshot_digest !== undefined && scope.source_snapshot_digest !== sourceSnapshot) fail('SOURCE_SNAPSHOT_MISMATCH');
  const indexScope = { ...scope, source_snapshot_digest: sourceSnapshot };
  const sourceMap = new Map(normalizedSources.map((source) => [sourceKey(source), source]));
  if (!Array.isArray(records) || records.length === 0 || records.length > limits.max_nodes) fail('RELATION_NODE_BUDGET');
  const nodes = records.map((item) => normalizeRecordEnvelope(item, scope, sourceMap));
  const nodeIds = new Set();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) fail('DUPLICATE_RELATION_NODE');
    nodeIds.add(node.id);
  }
  const edges = [];
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const node of nodes) {
    for (const type of RELATION_TYPES) {
      for (const target of node.relations[type]) {
        if (!nodeIds.has(target)) fail('UNKNOWN_RELATION_TARGET');
        if (target === node.id) fail('SELF_RELATION');
        const edge = { from: node.id, to: target, type, claim_sha256: node.claim_sha256 };
        edges.push(edge);
        degree.set(node.id, degree.get(node.id) + 1);
        degree.set(target, degree.get(target) + 1);
      }
    }
  }
  if (edges.length > limits.max_edges) fail('RELATION_EDGE_BUDGET');
  if ([...degree.values()].some((count) => count > limits.max_fanout)) fail('RELATION_FANOUT_BUDGET');
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
  const index = {
    schema: INDEX_SCHEMA,
    scope: indexScope,
    limits,
    retention: { policy: 'manual', rebuildable: true },
    authority_boundary: 'Relationship retrieval is a bounded read model. Records remain scoped historical data; current truth and Mission authority stay with the caller.',
    sources: normalizedSources,
    nodes: nodes.map(({ searchable: ignored, ...node }) => node),
    edges,
    derived_digest: null,
  };
  index.derived_digest = sha256(canonical(coreForDigest(index)));
  return {
    index,
    metrics: {
      maintenance: 'full_rebuild',
      records_scanned: records.length,
      nodes_built: nodes.length,
      edges_built: edges.length,
      sources_scanned: normalizedSources.length,
      source_bytes: normalizedSources.reduce((sum, source) => sum + source.bytes, 0),
      index_bytes: Buffer.byteLength(canonical(index), 'utf8'),
    },
  };
}

function validateNode(node, scope, sourceMap) {
  const checked = normalizeRecordEnvelope({ record: node.record, record_sha256: node.record_sha256 }, scope, sourceMap);
  if (checked.id !== node.id || checked.claim_sha256 !== node.claim_sha256) fail('INDEX_CORRUPT');
  return checked;
}

export function validateTypedRelationshipIndex(index, { scope: expectedScope = null } = {}) {
  if (!index || index.schema !== INDEX_SCHEMA || !Array.isArray(index.sources) || !Array.isArray(index.nodes) || !Array.isArray(index.edges)) fail('INDEX_CORRUPT');
  if (sha256(canonical(coreForDigest(index))) !== index.derived_digest) fail('INDEX_CORRUPT');
  const limits = normalizeLimits(index.limits);
  if (canonical(limits) !== canonical(index.limits)) fail('INDEX_CORRUPT');
  const scope = normalizeScope(index.scope);
  const sources = normalizeSources(index.sources, scope);
  if (sourceSnapshotDigest(sources) !== scope.source_snapshot_digest) fail('INDEX_CORRUPT');
  const sourceMap = new Map(sources.map((source) => [sourceKey(source), source]));
  const ids = new Set();
  const normalizedNodes = [];
  for (const node of index.nodes) {
    const checked = validateNode(node, scope, sourceMap);
    if (ids.has(checked.id)) fail('INDEX_CORRUPT');
    ids.add(checked.id);
    normalizedNodes.push(checked);
  }
  if (index.nodes.length > limits.max_nodes || index.edges.length > limits.max_edges) fail('INDEX_CORRUPT');
  const expectedEdges = [];
  const degree = new Map(normalizedNodes.map((node) => [node.id, 0]));
  for (const node of normalizedNodes) {
    for (const type of RELATION_TYPES) {
      for (const target of node.relations[type]) {
        if (!ids.has(target)) fail('INDEX_CORRUPT');
        expectedEdges.push({ from: node.id, to: target, type, claim_sha256: node.claim_sha256 });
        degree.set(node.id, degree.get(node.id) + 1);
        degree.set(target, degree.get(target) + 1);
      }
    }
  }
  expectedEdges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
  const actualEdges = index.edges.map((edge) => ({ from: edge.from, to: edge.to, type: edge.type, claim_sha256: edge.claim_sha256 }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type));
  if (canonical(actualEdges) !== canonical(expectedEdges) || [...degree.values()].some((count) => count > limits.max_fanout)) fail('INDEX_CORRUPT');
  for (const edge of index.edges) {
    if (!RELATION_SET.has(edge.type) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !SHA256_RE.test(edge.claim_sha256 ?? '')) fail('INDEX_CORRUPT');
  }
  if (expectedScope !== null) {
    const normalizedExpectedScope = normalizeScope(expectedScope);
    if (normalizedExpectedScope.source_snapshot_digest === undefined || canonical(normalizedExpectedScope) !== canonical(scope)) {
      fail('SCOPE_MISMATCH');
    }
  }
  return { index, scope, sources, sourceMap, nodes: normalizedNodes, nodeById: new Map(normalizedNodes.map((node) => [node.id, node])) };
}

function tokenize(value) {
  return [...new Set(String(value).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [])]
    .flatMap((token) => token.split(/[._-]+/u)).filter((token) => token.length >= 2);
}

function lexicalScore(node, tokens) {
  const haystack = node.searchable ?? `${node.id} ${node.record.kind ?? ''} ${node.record.title} ${node.record.summary} ${node.record.details}`.normalize('NFKC').toLocaleLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token));
  return { score: matched.length ? matched.length * 100 + Math.min(node.record.title.length, 100) / 100 : 0, matched };
}

function publicResult(node, why, score = 0) {
  return {
    record_id: node.id,
    record: node.record,
    score: Number(score.toFixed(3)),
    why_included: why,
    provenance: {
      scope_id: node.record.scope_id,
      claim_sha256: node.claim_sha256,
      record_sha256: node.record_sha256,
      references: node.references,
    },
    authority_boundary: 'Historical scoped record only; current truth and Mission authority are not provided by this result.',
  };
}

function eligible(node, includeCandidates) {
  return node.record.status === 'verified' || (includeCandidates && node.record.status === 'candidate');
}

export function lexicalBaseline({ index, scope = null, query, maxResults = null, includeCandidates = false }) {
  const checked = validateTypedRelationshipIndex(index, { scope });
  if (typeof query !== 'string' || !query.trim()) fail('INVALID_RELATION_QUERY');
  const tokens = tokenize(query);
  if (tokens.length > index.limits.max_query_tokens) fail('QUERY_TOKEN_BUDGET');
  const candidates = checked.nodes.filter((node) => eligible(node, includeCandidates)).map((node) => {
    const lexical = lexicalScore(node, tokens);
    return { node, lexical };
  }).filter(({ lexical }) => lexical.score > 0)
    .sort((a, b) => b.lexical.score - a.lexical.score || a.node.id.localeCompare(b.node.id));
  const cap = normalizeQueryLimit(maxResults, index.limits.max_results, index.limits.max_results);
  const selected = candidates.slice(0, cap).map(({ node, lexical }) => publicResult(node, [{ kind: 'lexical', matched_tokens: lexical.matched }], lexical.score));
  return {
    schema: 'histos.relationship-lexical/v0',
    scope: checked.scope,
    query,
    results: selected,
    receipt: { baseline: 'fixed-lexical-token-presence/v0', query_tokens: tokens, candidate_count: candidates.length, selected_count: selected.length },
  };
}

export function queryTypedRelationships({ index, scope = null, query, maxResults = null, maxDepth = null, includeCandidates = false, maxVisited = null }) {
  const checked = validateTypedRelationshipIndex(index, { scope });
  if (typeof query !== 'string' || !query.trim()) fail('INVALID_RELATION_QUERY');
  const tokens = tokenize(query);
  if (tokens.length > index.limits.max_query_tokens) fail('QUERY_TOKEN_BUDGET');
  const depthLimit = normalizeQueryLimit(maxDepth, index.limits.max_depth, index.limits.max_depth);
  const resultLimit = normalizeQueryLimit(maxResults, index.limits.max_results, index.limits.max_results);
  const visitLimit = normalizeQueryLimit(maxVisited, index.limits.max_nodes, index.limits.max_nodes);
  const byId = checked.nodeById;
  const adjacency = new Map([...byId.keys()].map((id) => [id, []]));
  for (const edge of index.edges) {
    adjacency.get(edge.from).push({ edge, neighbor: edge.to, direction: 'declared' });
    adjacency.get(edge.to).push({ edge, neighbor: edge.from, direction: 'incoming' });
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.neighbor.localeCompare(b.neighbor) || a.edge.type.localeCompare(b.edge.type) || a.direction.localeCompare(b.direction));
  const lexicalSeeds = checked.nodes.map((node) => ({ node, lexical: lexicalScore(node, tokens) }))
    .filter(({ node, lexical }) => eligible(node, includeCandidates) && lexical.score > 0)
    .sort((a, b) => b.lexical.score - a.lexical.score || a.node.id.localeCompare(b.node.id));
  const seeds = lexicalSeeds.slice(0, visitLimit);
  const selected = new Map();
  const queue = [];
  for (const { node, lexical } of seeds) {
    selected.set(node.id, { node, score: lexical.score, why: [{ kind: 'lexical', matched_tokens: lexical.matched }] });
    queue.push({ id: node.id, depth: 0, path: [] });
  }
  let edgesConsidered = 0;
  let relationshipExpansions = 0;
  let truncated = lexicalSeeds.length > seeds.length;
  const visitedDepth = new Map(queue.map((item) => [item.id, 0]));
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= depthLimit) continue;
    for (const adjacent of adjacency.get(current.id) ?? []) {
      if (edgesConsidered >= index.limits.max_edges) { truncated = true; break; }
      edgesConsidered += 1;
      const nextDepth = current.depth + 1;
      const neighbor = byId.get(adjacent.neighbor);
      if (!neighbor) { truncated = true; break; }
      // Excluded candidates and deprecated records are hard traversal barriers.
      // They must not become results or bridges to otherwise eligible records.
      if (!eligible(neighbor, includeCandidates)) continue;
      const priorDepth = visitedDepth.get(adjacent.neighbor);
      if (priorDepth !== undefined && priorDepth <= nextDepth) continue;
      if (visitedDepth.size >= visitLimit) { truncated = true; break; }
      visitedDepth.set(adjacent.neighbor, nextDepth);
      const path = [...current.path, { from: adjacent.edge.from, to: adjacent.edge.to, type: adjacent.edge.type, direction: adjacent.direction, depth: nextDepth, claim_sha256: adjacent.edge.claim_sha256 }];
      relationshipExpansions += 1;
      const relationWhy = { kind: 'relationship', via: path };
      const existing = selected.get(neighbor.id);
      if (!existing || nextDepth < (existing.relationship_depth ?? Number.POSITIVE_INFINITY)) {
        selected.set(neighbor.id, { node: neighbor, score: Math.max(1, 50 - nextDepth), why: existing ? [...existing.why, relationWhy] : [relationWhy], relationship_depth: nextDepth });
      } else if (existing && !existing.why.some((why) => why.kind === 'relationship')) {
        existing.why.push(relationWhy);
      }
      if (nextDepth < depthLimit) queue.push({ id: adjacent.neighbor, depth: nextDepth, path });
    }
    if (truncated) break;
  }
  const output = [...selected.values()].sort((a, b) => b.score - a.score || (a.relationship_depth ?? 0) - (b.relationship_depth ?? 0) || a.node.id.localeCompare(b.node.id)).slice(0, resultLimit)
    .map(({ node, score, why }) => publicResult(node, why, score));
  return {
    schema: 'histos.relationship-query/v0',
    scope: checked.scope,
    query,
    results: output,
    receipt: {
      query_tokens: tokens,
      lexical_seed_count: lexicalSeeds.length,
      relationship_expansions: relationshipExpansions,
      visited_nodes: visitedDepth.size,
      edges_considered: edgesConsidered,
      max_depth: depthLimit,
      truncated,
      include_candidates: includeCandidates,
      candidate_authority: 'Candidates are opt-in and remain candidates; no result can become current truth or Mission authority.',
    },
  };
}

function ids(result) {
  return result.results.map((item) => item.record_id);
}

function countExpected(resultIds, expected) {
  const expectedSet = new Set(expected);
  return resultIds.filter((id) => expectedSet.has(id)).length;
}

export function evaluateHeldOut({ scope, records, sources, cases, limits = {} }) {
  if (!Array.isArray(cases) || cases.length === 0) fail('INVALID_HELD_OUT_CASES');
  const buildStart = performance.now();
  const built = buildTypedRelationshipIndex({ scope, records, sources, limits });
  const buildElapsed = performance.now() - buildStart;
  const rows = cases.map((item) => {
    if (!item || typeof item.id !== 'string' || typeof item.query !== 'string' || !Array.isArray(item.expected_ids)) fail('INVALID_HELD_OUT_CASE');
    const lexicalStart = performance.now();
    const lexical = lexicalBaseline({ index: built.index, query: item.query, maxResults: item.max_results });
    const lexicalElapsed = performance.now() - lexicalStart;
    const relationStart = performance.now();
    const relationship = queryTypedRelationships({ index: built.index, query: item.query, maxResults: item.max_results });
    const relationshipElapsed = performance.now() - relationStart;
    const expected = [...item.expected_ids].sort();
    return {
      id: item.id,
      kind: item.kind ?? 'held_out',
      query: item.query,
      expected_ids: expected,
      lexical_ids: ids(lexical),
      relationship_ids: ids(relationship),
      lexical_correct: countExpected(ids(lexical), expected),
      relationship_correct: countExpected(ids(relationship), expected),
      lexical_latency_ms: Number(lexicalElapsed.toFixed(3)),
      relationship_latency_ms: Number(relationshipElapsed.toFixed(3)),
      lexical_result_bytes: Buffer.byteLength(canonical(lexical), 'utf8'),
      relationship_result_bytes: Buffer.byteLength(canonical(relationship), 'utf8'),
      relationship_expansions: relationship.receipt.relationship_expansions,
    };
  });
  const aggregate = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  const relationRows = rows.filter((row) => row.kind === 'relation');
  const nonRelationRows = rows.filter((row) => row.kind !== 'relation');
  return {
    schema: REPORT_SCHEMA,
    evaluation: 'fixed-lexical-token-presence/v0 versus bounded-typed-relationship/v0',
    scope: built.index.scope,
    index: {
      schema: built.index.schema,
      derived_digest: built.index.derived_digest,
      bytes: Buffer.byteLength(canonical(built.index), 'utf8'),
      nodes: built.index.nodes.length,
      edges: built.index.edges.length,
      source_bytes: built.metrics.source_bytes,
    },
    maintenance: { ...built.metrics, rebuild_elapsed_ms: Number(buildElapsed.toFixed(3)), updates: 'full_rebuild_only' },
    cases: rows,
    aggregate: {
      cases: rows.length,
      relation_cases: relationRows.length,
      non_relation_cases: nonRelationRows.length,
      expected_hits_lexical: aggregate('lexical_correct'),
      expected_hits_relationship: aggregate('relationship_correct'),
      relationship_gain_on_relation_cases: aggregate('relationship_correct') - aggregate('lexical_correct'),
      relationship_gain_on_non_relation_cases: nonRelationRows.reduce((sum, row) => sum + row.relationship_correct - row.lexical_correct, 0),
      lexical_latency_ms: Number(aggregate('lexical_latency_ms').toFixed(3)),
      relationship_latency_ms: Number(aggregate('relationship_latency_ms').toFixed(3)),
      lexical_result_bytes: aggregate('lexical_result_bytes'),
      relationship_result_bytes: aggregate('relationship_result_bytes'),
    },
    limitation: 'Latency is an observational run metric; relationship retrieval is not claimed as a universal lexical improvement. Gains are reported only for explicit relation cases.',
  };
}

export const H06_DEFAULT_LIMITS = DEFAULT_LIMITS;

import { createHash } from 'node:crypto';

// A01 is deliberately a read-only, deterministic experiment surface.  It does
// not install a policy, mutate a cache, promote memory, or change Mission
// authority.  The caller may persist the returned report as evidence, but the
// module itself has no persistence API.
export const POLICY_SCHEMA = 'histos.retrieval-policy/v1';
export const POLICY_ENVELOPE_SCHEMA = 'histos.retrieval-policy-envelope/v1';
export const REPORT_SCHEMA = 'histos.retrieval-policy-experiment/v1';

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PATH_BAD = /(^|\/)(?:\.|\.\.)($|\/)/u;
const SPLITS = new Set(['development', 'held_out']);
const POLICY_KINDS = new Set(['baseline', 'candidate']);
const IMMUTABLE_KEYS = Object.freeze([
  'schema', 'scope', 'provenance', 'authority', 'current_truth', 'safety',
]);
const PARAMETER_KEYS = Object.freeze(['retrieval', 'budget', 'cache']);
const RETRIEVAL_KEYS = Object.freeze(['lexical_weight', 'relationship_weight', 'expansion_depth']);
const BUDGET_KEYS = Object.freeze(['result_limit', 'token_share']);
const CACHE_KEYS = Object.freeze(['enabled', 'max_age_ms']);

const DEFAULT_SAFETY = Object.freeze({
  authority: 'none',
  current_truth: false,
  max_results: 8,
  max_tokens: 2048,
  max_depth: 3,
  max_cache_age_ms: 300_000,
  budget_unit: 'result-count-and-rendered-tokens',
});

const fail = (code) => { throw new Error(code); };

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value))).digest('hex');
}

function keys(value, allowed, required = allowed) {
  if (!plain(value)) fail('INVALID_POLICY_FIELDS');
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('UNKNOWN_POLICY_FIELD');
  if (required.some((key) => !Object.hasOwn(value, key))) fail('MISSING_POLICY_FIELD');
}

function text(value, code = 'INVALID_POLICY_TEXT') {
  if (typeof value !== 'string' || !value.trim()) fail(code);
  return value;
}

function id(value, code = 'INVALID_POLICY_ID') {
  if (!ID.test(value ?? '')) fail(code);
  return value;
}

function hash(value, code = 'INVALID_POLICY_HASH') {
  if (!SHA256.test(value ?? '')) fail(code);
  return value;
}

function integer(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function finite(value, min, max, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code);
  return value;
}

function normalizePath(value, code = 'INVALID_POLICY_PATH') {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.includes('//') || PATH_BAD.test(value)) fail(code);
  return value;
}

function paths(values, code = 'INVALID_POLICY_PATHS') {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) fail(code);
  const normalized = values.map((value) => normalizePath(value, code));
  if (new Set(normalized).size !== normalized.length) fail(code);
  return [...normalized].sort((a, b) => a.localeCompare(b));
}

function normalizeScope(input) {
  keys(input, ['scope_id', 'source_snapshot_digest', 'source_paths', 'evidence_paths']);
  const scope = {
    scope_id: id(input.scope_id, 'INVALID_POLICY_SCOPE'),
    source_snapshot_digest: hash(input.source_snapshot_digest, 'INVALID_POLICY_SOURCE_SNAPSHOT'),
    source_paths: paths(input.source_paths),
    evidence_paths: paths(input.evidence_paths),
  };
  return scope;
}

function normalizeProvenance(input) {
  keys(input, ['mode', 'source_identity_required', 'evidence_identity_required']);
  if (input.mode !== 'evidence-linked') fail('INVALID_POLICY_PROVENANCE');
  if (input.source_identity_required !== true || input.evidence_identity_required !== true) fail('INVALID_POLICY_PROVENANCE');
  return { mode: input.mode, source_identity_required: true, evidence_identity_required: true };
}

function normalizeSafety(input) {
  keys(input, Object.keys(DEFAULT_SAFETY));
  if (input.authority !== 'none' || input.current_truth !== false) fail('POLICY_AUTHORITY_BOUNDARY_VIOLATION');
  if (input.budget_unit !== DEFAULT_SAFETY.budget_unit) fail('INVALID_POLICY_SAFETY');
  return {
    authority: 'none', current_truth: false,
    max_results: integer(input.max_results, 1, 1024, 'INVALID_POLICY_SAFETY'),
    max_tokens: integer(input.max_tokens, 1, 1_000_000, 'INVALID_POLICY_SAFETY'),
    max_depth: integer(input.max_depth, 0, 32, 'INVALID_POLICY_SAFETY'),
    max_cache_age_ms: integer(input.max_cache_age_ms, 0, 86_400_000, 'INVALID_POLICY_SAFETY'),
    budget_unit: DEFAULT_SAFETY.budget_unit,
  };
}

function normalizeParameters(input, safety) {
  keys(input, PARAMETER_KEYS);
  const retrieval = input.retrieval;
  const budget = input.budget;
  const cache = input.cache;
  keys(retrieval, RETRIEVAL_KEYS);
  keys(budget, BUDGET_KEYS);
  keys(cache, CACHE_KEYS);
  const normalized = {
    retrieval: {
      lexical_weight: finite(retrieval.lexical_weight, 0, 100, 'INVALID_RETRIEVAL_PARAMETER'),
      relationship_weight: finite(retrieval.relationship_weight, 0, 100, 'INVALID_RETRIEVAL_PARAMETER'),
      expansion_depth: integer(retrieval.expansion_depth, 0, safety.max_depth, 'INVALID_RETRIEVAL_PARAMETER'),
    },
    budget: {
      result_limit: integer(budget.result_limit, 1, safety.max_results, 'INVALID_BUDGET_PARAMETER'),
      token_share: finite(budget.token_share, 0.01, 1, 'INVALID_BUDGET_PARAMETER'),
    },
    cache: {
      enabled: cache.enabled,
      max_age_ms: integer(cache.max_age_ms, 0, safety.max_cache_age_ms, 'INVALID_CACHE_PARAMETER'),
    },
  };
  if (typeof normalized.cache.enabled !== 'boolean') fail('INVALID_CACHE_PARAMETER');
  if (!normalized.cache.enabled && normalized.cache.max_age_ms !== 0) fail('INVALID_CACHE_PARAMETER');
  if (normalized.retrieval.lexical_weight === 0 && normalized.retrieval.relationship_weight === 0) fail('ZERO_RETRIEVAL_WEIGHTS');
  return normalized;
}

/** Normalize and validate one policy.  This does not assert candidate-vs-baseline lineage. */
export function validatePolicy(input) {
  keys(input, ['schema', 'policy_id', 'version', 'kind', 'scope', 'provenance', 'authority', 'current_truth', 'safety', 'parameters', 'label', 'parent_policy_sha256'], ['schema', 'policy_id', 'version', 'kind', 'scope', 'provenance', 'authority', 'current_truth', 'safety', 'parameters']);
  if (input.schema !== POLICY_SCHEMA) fail('INVALID_POLICY_SCHEMA');
  const policy = {
    schema: POLICY_SCHEMA,
    policy_id: id(input.policy_id),
    version: integer(input.version, 1, 1_000_000, 'INVALID_POLICY_VERSION'),
    kind: input.kind,
    scope: normalizeScope(input.scope),
    provenance: normalizeProvenance(input.provenance),
    authority: input.authority,
    current_truth: input.current_truth,
    safety: normalizeSafety(input.safety),
    parameters: null,
    label: text(input.label ?? input.policy_id),
  };
  if (!POLICY_KINDS.has(policy.kind)) fail('INVALID_POLICY_KIND');
  if (policy.authority !== 'none' || policy.current_truth !== false) fail('POLICY_AUTHORITY_BOUNDARY_VIOLATION');
  policy.parameters = normalizeParameters(input.parameters, policy.safety);
  if (input.parent_policy_sha256 !== undefined) policy.parent_policy_sha256 = hash(input.parent_policy_sha256, 'INVALID_PARENT_POLICY');
  if (policy.kind === 'candidate' && !policy.parent_policy_sha256) fail('CANDIDATE_PARENT_REQUIRED');
  if (policy.kind === 'baseline' && policy.parent_policy_sha256 !== undefined) fail('BASELINE_PARENT_FORBIDDEN');
  return policy;
}

/** Add the checksum used for durable evidence and reject any pre-existing forgery. */
export function sealPolicy(input) {
  const policy = validatePolicy(input);
  return { schema: POLICY_ENVELOPE_SCHEMA, policy, policy_sha256: sha256(canonical(policy)) };
}

function validateEnvelope(input) {
  keys(input, ['schema', 'policy', 'policy_sha256']);
  if (input.schema !== POLICY_ENVELOPE_SCHEMA || !plain(input.policy)) fail('INVALID_POLICY_ENVELOPE');
  const policy = validatePolicy(input.policy);
  if (hash(input.policy_sha256, 'MISSING_POLICY_CHECKSUM') !== sha256(canonical(policy))) fail('POLICY_CHECKSUM_MISMATCH');
  return { schema: POLICY_ENVELOPE_SCHEMA, policy, policy_sha256: input.policy_sha256 };
}

function exact(a, b) { return canonical(a) === canonical(b); }

/** Validate that a candidate only changes the explicitly approved parameter surface. */
export function validateCandidate({ baseline: baselineInput, candidate: candidateInput }) {
  const baseline = validateEnvelope(baselineInput);
  const candidate = validateEnvelope(candidateInput);
  if (baseline.policy.kind !== 'baseline') fail('BASELINE_REQUIRED');
  if (candidate.policy.kind !== 'candidate') fail('CANDIDATE_REQUIRED');
  if (candidate.policy.parent_policy_sha256 !== baseline.policy_sha256) fail('POLICY_PARENT_MISMATCH');
  for (const field of IMMUTABLE_KEYS) {
    if (!exact(candidate.policy[field], baseline.policy[field])) fail(`IMMUTABLE_POLICY_FIELD_CHANGED:${field}`);
  }
  // Policy metadata may identify the experiment, but must not smuggle an
  // unapproved configuration field through an object extension.
  if (!exact(Object.keys(candidate.policy.parameters).sort(), PARAMETER_KEYS.slice().sort())) fail('UNAPPROVED_POLICY_PARAMETER');
  return { baseline, candidate };
}

function normalizeIdentity(input, scope, catalogs, code = 'INVALID_POLICY_EVIDENCE') {
  if (!plain(input)) fail(code);
  keys(input, ['kind', 'path', 'sha256', 'bytes']);
  const ref = {
    kind: input.kind,
    path: normalizePath(input.path, code),
    sha256: hash(input.sha256, code),
    bytes: integer(input.bytes, 0, Number.MAX_SAFE_INTEGER, code),
  };
  if (!['source', 'evidence'].includes(ref.kind)) fail(code);
  const allowed = ref.kind === 'source' ? scope.source_paths : scope.evidence_paths;
  if (!allowed.includes(ref.path)) fail('POLICY_EVIDENCE_OUT_OF_SCOPE');
  const catalog = catalogs.get(`${ref.kind}:${ref.path}`);
  if (!catalog || catalog.sha256 !== ref.sha256 || catalog.bytes !== ref.bytes) fail('POLICY_EVIDENCE_STALE_OR_FORGED');
  return ref;
}

function catalogMap(values, scope) {
  if (!Array.isArray(values) || values.length === 0) fail('POLICY_EVIDENCE_CATALOG_REQUIRED');
  const map = new Map();
  for (const value of values) {
    if (!plain(value)) fail('INVALID_POLICY_EVIDENCE');
    keys(value, ['kind', 'path', 'sha256', 'bytes']);
    const item = normalizeIdentity(value, scope, new Map([[`${value.kind}:${value.path}`, value]]));
    const key = `${item.kind}:${item.path}`;
    if (map.has(key) && !exact(map.get(key), item)) fail('DUPLICATE_POLICY_EVIDENCE');
    map.set(key, item);
  }
  return map;
}

function normalizeDocuments(item, scope, catalogs) {
  if (!Array.isArray(item.documents) || item.documents.length === 0 || item.documents.length > 1024) fail('INVALID_POLICY_CASE_DOCUMENTS');
  const seen = new Set();
  return item.documents.map((document) => {
    if (!plain(document)) fail('INVALID_POLICY_DOCUMENT');
    keys(document, ['id', 'text', 'related_ids', 'source_ref']);
    const documentId = id(document.id, 'INVALID_POLICY_DOCUMENT_ID');
    if (seen.has(documentId)) fail('DUPLICATE_POLICY_DOCUMENT');
    seen.add(documentId);
    const related = document.related_ids ?? [];
    if (!Array.isArray(related) || related.some((value) => !ID.test(value)) || new Set(related).size !== related.length || related.includes(documentId)) fail('INVALID_POLICY_RELATIONS');
    const sourceRef = document.source_ref ? normalizeIdentity(document.source_ref, scope, catalogs, 'INVALID_POLICY_SOURCE_REFERENCE') : null;
    return { id: documentId, text: text(document.text, 'INVALID_POLICY_DOCUMENT_TEXT'), related_ids: [...related].sort(), source_ref: sourceRef };
  });
}

function normalizeCase(item, scope, catalogs, documentDefaults = null) {
  if (!plain(item)) fail('INVALID_POLICY_CASE');
  keys(item, ['id', 'split', 'query', 'expected_ids', 'documents', 'evidence_refs']);
  const caseId = id(item.id, 'INVALID_POLICY_CASE_ID');
  if (!SPLITS.has(item.split)) fail('INVALID_POLICY_CASE_SPLIT');
  const query = text(item.query, 'INVALID_POLICY_QUERY');
  if (!Array.isArray(item.expected_ids) || item.expected_ids.some((value) => !ID.test(value)) || new Set(item.expected_ids).size !== item.expected_ids.length) fail('INVALID_POLICY_EXPECTATIONS');
  const documents = normalizeDocuments({ documents: item.documents ?? documentDefaults }, scope, catalogs);
  const documentIds = new Set(documents.map((document) => document.id));
  if (item.expected_ids.some((value) => !documentIds.has(value))) fail('EXPECTED_DOCUMENT_MISSING');
  if (!Array.isArray(item.evidence_refs)) fail('POLICY_EVIDENCE_BINDING_REQUIRED');
  const refs = item.evidence_refs.map((value) => {
    if (!plain(value)) fail('INVALID_POLICY_EVIDENCE_BINDING');
    keys(value, ['document_id', 'ref']);
    if (!documentIds.has(value.document_id)) fail('POLICY_EVIDENCE_OUT_OF_SCOPE');
    return { document_id: value.document_id, ref: normalizeIdentity(value.ref, scope, catalogs) };
  });
  const byDocument = new Set(refs.map((value) => value.document_id));
  for (const expected of item.expected_ids) if (!byDocument.has(expected)) fail('MISSING_POLICY_EVIDENCE_BINDING');
  if (refs.some((value) => !item.expected_ids.includes(value.document_id))) fail('UNEXPECTED_POLICY_EVIDENCE_BINDING');
  return { id: caseId, split: item.split, query, expected_ids: [...item.expected_ids].sort(), documents, evidence_refs: refs };
}

function tokens(value) {
  return [...new Set(String(value).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [])]
    .flatMap((token) => token.split(/[._-]+/u)).filter((token) => token.length >= 2);
}

function lexicalScore(document, queryTokens) {
  const haystack = document.text.normalize('NFKC').toLocaleLowerCase();
  const matched = queryTokens.filter((token) => haystack.includes(token));
  return { score: matched.length, matched };
}

function retrieve(policy, item) {
  const params = policy.parameters;
  const queryTokens = tokens(item.query);
  const byId = new Map(item.documents.map((document) => [document.id, document]));
  const lexical = item.documents.map((document) => ({ document, lexical: lexicalScore(document, queryTokens) }))
    .filter((entry) => entry.lexical.score > 0)
    .sort((a, b) => b.lexical.score - a.lexical.score || a.document.id.localeCompare(b.document.id));
  const selected = new Map();
  const queue = [];
  const expanded = new Set();
  for (const entry of lexical) {
    const score = entry.lexical.score * params.retrieval.lexical_weight;
    selected.set(entry.document.id, { document: entry.document, score, depth: 0, why: [{ kind: 'lexical', matched_tokens: entry.lexical.matched }] });
    queue.push({ document: entry.document, depth: 0, path: [] });
  }
  let relationshipExpansions = 0;
  while (queue.length) {
    const current = queue.shift();
    if (expanded.has(current.document.id)) continue;
    expanded.add(current.document.id);
    if (current.depth >= params.retrieval.expansion_depth) continue;
    for (const relatedId of current.document.related_ids) {
      const related = byId.get(relatedId);
      if (!related) fail('POLICY_RELATION_TARGET_MISSING');
      const depth = current.depth + 1;
      const path = [...current.path, { from: current.document.id, to: related.id, depth }];
      const relationScore = params.retrieval.relationship_weight / depth;
      const prior = selected.get(related.id);
      if (!prior || relationScore > prior.score || (relationScore === prior.score && depth < prior.depth)) {
        selected.set(related.id, { document: related, score: relationScore, depth, why: [{ kind: 'relationship', via: path }] });
      } else if (!prior.why.some((why) => why.kind === 'relationship')) {
        prior.why.push({ kind: 'relationship', via: path });
      }
      relationshipExpansions += 1;
      if (depth < params.retrieval.expansion_depth && !queue.some((entry) => entry.document.id === related.id)) queue.push({ document: related, depth, path });
    }
  }
  const rows = [...selected.values()]
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.document.id.localeCompare(b.document.id))
    .slice(0, params.budget.result_limit)
    .map(({ document, score, depth, why }) => ({
      id: document.id,
      score: Number(score.toFixed(6)),
      depth,
      why,
      provenance: {
        scope_id: policy.scope.scope_id,
        source_ref: document.source_ref,
        authority: 'none',
        current_truth: false,
      },
    }));
  return {
    ids: rows.map((row) => row.id),
    results: rows,
    receipt: {
      query_tokens: queryTokens,
      lexical_seed_count: lexical.length,
      relationship_expansions: relationshipExpansions,
      result_limit: params.budget.result_limit,
      token_share: params.budget.token_share,
      cache: { enabled: params.cache.enabled, max_age_ms: params.cache.max_age_ms, hit: false },
    },
  };
}

function scoreCase(retrieval, item) {
  const actual = retrieval.ids;
  const expected = item.expected_ids;
  const expectedSet = new Set(expected);
  const hits = actual.filter((value) => expectedSet.has(value)).length;
  const falsePositives = actual.filter((value) => !expectedSet.has(value)).length;
  const exact = actual.length === expected.length && hits === expected.length;
  const noAnswer = expected.length === 0 ? actual.length === 0 : null;
  return {
    expected_count: expected.length,
    result_count: actual.length,
    hits,
    false_positives: falsePositives,
    recall: expected.length ? hits / expected.length : (noAnswer ? 1 : 0),
    precision: actual.length ? hits / actual.length : (expected.length ? 0 : 1),
    exact,
    no_answer_pass: noAnswer,
  };
}

function aggregate(rows) {
  const expected = rows.reduce((sum, row) => sum + row.metrics.expected_count, 0);
  const hits = rows.reduce((sum, row) => sum + row.metrics.hits, 0);
  const falsePositives = rows.reduce((sum, row) => sum + row.metrics.false_positives, 0);
  const noAnswer = rows.filter((row) => row.metrics.no_answer_pass !== null);
  return {
    cases: rows.length,
    expected: expected,
    hits,
    recall: expected ? hits / expected : null,
    false_positives: falsePositives,
    exact_cases: rows.filter((row) => row.metrics.exact).length,
    no_answer_cases: noAnswer.length,
    no_answer_pass: noAnswer.filter((row) => row.metrics.no_answer_pass).length,
    rendered_result_bytes: rows.reduce((sum, row) => sum + row.result_bytes, 0),
  };
}

function aggregateDelta(candidate, baseline) {
  return {
    hits: candidate.hits - baseline.hits,
    recall: Number((candidate.recall - baseline.recall).toFixed(6)),
    false_positives: candidate.false_positives - baseline.false_positives,
    exact_cases: candidate.exact_cases - baseline.exact_cases,
    no_answer_pass: candidate.no_answer_pass - baseline.no_answer_pass,
  };
}

function candidateDecision(candidate, baseline) {
  const heldOut = aggregateDelta(candidate.splits.held_out, baseline.splits.held_out);
  const regressions = [];
  if (heldOut.recall < 0) regressions.push('HELD_OUT_RECALL_REGRESSION');
  if (heldOut.exact_cases < 0) regressions.push('HELD_OUT_EXACT_CASE_REGRESSION');
  if (heldOut.no_answer_pass < 0) regressions.push('HELD_OUT_NO_ANSWER_REGRESSION');
  if (heldOut.false_positives > 0) regressions.push('HELD_OUT_FALSE_POSITIVE_REGRESSION');
  return { eligible: regressions.length === 0, regressions, held_out_delta: heldOut };
}

/**
 * Evaluate a fixed baseline and bounded candidates.  Gold/evidence is used
 * only after retrieval, never to select a result.  At least one held-out case
 * is mandatory and every positive expected ID must be bound to a catalogued
 * source/evidence identity.
 */
export function evaluatePolicyExperiment({ baseline: baselineInput, candidates: candidateInputs = [], cases: inputCases, evidence }) {
  const baseline = validateEnvelope(baselineInput);
  if (baseline.policy.kind !== 'baseline') fail('BASELINE_REQUIRED');
  const catalogs = catalogMap(evidence, baseline.policy.scope);
  if (!Array.isArray(inputCases) || inputCases.length === 0) fail('POLICY_CASES_REQUIRED');
  const ids = new Set();
  const cases = inputCases.map((item) => {
    const normalized = normalizeCase(item, baseline.policy.scope, catalogs);
    if (ids.has(normalized.id)) fail('DUPLICATE_POLICY_CASE');
    ids.add(normalized.id);
    return normalized;
  });
  if (!cases.some((item) => item.split === 'held_out')) fail('HELD_OUT_CASE_REQUIRED');
  const evaluate = (envelope) => {
    const rows = cases.map((item) => {
      const retrieval = retrieve(envelope.policy, item);
      const metrics = scoreCase(retrieval, item);
      return {
        case_id: item.id,
        split: item.split,
        expected_ids: item.expected_ids,
        result_ids: retrieval.ids,
        results: retrieval.results,
        receipt: retrieval.receipt,
        metrics,
        result_bytes: Buffer.byteLength(canonical(retrieval), 'utf8'),
        evidence_binding_count: item.evidence_refs.length,
      };
    });
    const splits = {
      development: aggregate(rows.filter((row) => row.split === 'development')),
      held_out: aggregate(rows.filter((row) => row.split === 'held_out')),
    };
    return {
      policy: { policy_id: envelope.policy.policy_id, version: envelope.policy.version, kind: envelope.policy.kind, policy_sha256: envelope.policy_sha256, parameters: envelope.policy.parameters },
      rows,
      splits,
    };
  };
  const baselineResult = evaluate(baseline);
  const candidateResults = candidateInputs.map((input) => {
    const pair = validateCandidate({ baseline, candidate: input });
    const result = evaluate(pair.candidate);
    const decision = candidateDecision(result, baselineResult);
    return { ...result, decision };
  });
  const ranked = candidateResults.filter((item) => item.decision.eligible).sort((a, b) => {
    const ah = a.decision.held_out_delta;
    const bh = b.decision.held_out_delta;
    return bh.hits - ah.hits || bh.recall - ah.recall || bh.exact_cases - ah.exact_cases || ah.false_positives - bh.false_positives || a.policy.policy_id.localeCompare(b.policy.policy_id);
  });
  const selected = ranked[0] ?? null;
  const selection = selected
    ? { decision: 'CANDIDATE_SELECTED', policy_id: selected.policy.policy_id, policy_sha256: selected.policy.policy_sha256, reason: 'deterministic held-out non-regression ranking' }
    : { decision: 'BASELINE_ROLLBACK', policy_id: baseline.policy.policy_id, policy_sha256: baseline.policy_sha256, reason: 'all candidates regressed or were rejected' };
  return {
    schema: REPORT_SCHEMA,
    experiment: 'retrieval-policy-self-improvement/v1',
    baseline: baselineResult,
    candidates: candidateResults,
    selection,
    rollback: {
      available: true,
      baseline_policy_id: baseline.policy.policy_id,
      baseline_policy_sha256: baseline.policy_sha256,
      selected_policy_id: selection.policy_id,
      active_authority: 'none; caller must explicitly review and install any candidate',
    },
    evaluation_contract: {
      splits: ['development', 'held_out'],
      evidence_catalog_entries: catalogs.size,
      labels_used_after_retrieval: true,
      candidate_mutation: 'none',
      baseline_fixed: true,
    },
  };
}

export function rollbackToBaseline(report, baselineInput) {
  const baseline = validateEnvelope(baselineInput);
  if (!report || report.schema !== REPORT_SCHEMA || !report.rollback || report.rollback.baseline_policy_sha256 !== baseline.policy_sha256) fail('ROLLBACK_BASELINE_MISMATCH');
  return { ...baseline, rollback: { disposition: 'BASELINE_RESTORED', reason: 'deterministic rollback receipt', source_report_schema: report.schema } };
}

export function selectPolicy(report) {
  if (!report || report.schema !== REPORT_SCHEMA || !report.selection) fail('INVALID_POLICY_REPORT');
  return { decision: report.selection.decision, policy_id: report.selection.policy_id, policy_sha256: report.selection.policy_sha256, active: false, authority: 'none' };
}

export const A01_DEFAULT_SAFETY = DEFAULT_SAFETY;

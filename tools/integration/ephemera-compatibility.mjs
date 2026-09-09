import { createHash } from 'node:crypto';
import {
  createEvidenceEventJournal,
  digest,
  normalizeEphemeraEvent,
} from '../events/evidence-events.mjs';

/**
 * A deliberately small HISTOS-side seam for EPHEMERA H05.
 *
 * EPHEMERA owns Mission identity, policy and transitions.  This module only
 * prepares the public H01/H03 request and validates the detached responses
 * that the System adapter is allowed to consume.  It does not import a
 * Mission store and it never calls a transition callback.
 */
export const EPHEMERA_H05_COMPATIBILITY_SCHEMA = 'histos.ephemera-h05-compatibility/v1';
export const HISTOS_CONTEXT_CAPSULE_SCHEMA = 'histos.context-capsule/v1';
export const HISTOS_MEMORY_RECALL_SCHEMA = 'histos.memory-recall/v0';
export const H05_COMPATIBILITY_VERSION = 1;

const SHA256 = /^[a-f0-9]{64}$/iu;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|[\\/])\.\.?(?:[\\/]|$)).+$/u;
const H05_SCOPE_FIELDS = new Set(['scope_id', 'snapshot_digest', 'paths', 'source_paths', 'evidence_paths']);
const ROLE_FIELDS = new Set([
  'role', 'allowed_paths', 'allowed_evidence_paths', 'allowed_memory_kinds', 'allowed_memory_ids',
  'max_tokens', 'max_memory_records', 'allow_candidates', 'allow_current_truth',
]);
const REQUEST_FIELDS = new Set(['scope', 'current_truth_refs', 'role_policy', 'goal', 'query']);
const MEMORY_FIELDS = new Set([
  'schema', 'version', 'scope', 'query', 'current_truth_refs', 'authority_boundary', 'records',
  'refusals', 'supersessions', 'authority', 'current_truth', 'freshness', 'status', 'complete',
  'incomplete', 'request_digest',
]);
const CONTEXT_FIELDS = new Set([
  'schema', 'version', 'goal', 'scope', 'current_truth_refs', 'source_map', 'source_fragments',
  'evidence_refs', 'memory', 'open_questions', 'rendered_context', 'budget', 'selection_receipt',
  'authority', 'current_truth', 'freshness', 'status', 'complete', 'incomplete', 'request_digest',
]);
const REF_FIELDS = new Set([
  'kind', 'path', 'sha256', 'source_sha256', 'bytes', 'scope_id', 'snapshot_digest',
  'source_snapshot_sha256', 'start_line', 'end_line', 'authority', 'current_truth', 'fresh',
  'freshness', 'stale', 'status', 'lineage_id', 'provenance_kind', 'supports_claim',
]);

export class EphemeraCompatibilityError extends Error {
  constructor(code, message, field = null, cause = undefined) {
    super(`${code}: ${message}`);
    this.name = 'EphemeraCompatibilityError';
    this.code = code;
    this.field = field;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, message = code, field = null, cause = undefined) {
  throw new EphemeraCompatibilityError(code, message, field, cause);
}

function plain(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INVALID_OBJECT', `${field} must be a plain object.`, field);
  }
  return value;
}

function exactFields(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${field}.${key} is not part of the public H05 contract.`, `${field}.${key}`);
}

function clone(value) {
  try { return structuredClone(value); }
  catch (error) { fail('NON_DETACHED_VALUE', 'H05 contract value must be structured-cloneable.', null, error); }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) fail('INVALID_STRING', `${field} must be exact non-empty text.`, field);
  return value;
}

function id(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID', `${field} is not a bounded identifier.`, field);
  return value;
}

function hash(value, field) {
  if (typeof value !== 'string') fail('INVALID_DIGEST', `${field} must be a SHA-256 digest.`, field);
  const raw = value.startsWith('sha256:') ? value.slice(7) : value;
  if (!SHA256.test(raw)) fail('INVALID_DIGEST', `${field} must be a SHA-256 digest.`, field);
  return raw.toLowerCase();
}

function relativePath(value, field) {
  if (typeof value !== 'string' || !PATH.test(value) || value.includes('\\') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('INVALID_SCOPE_PATH', `${field} must be a relative traversal-free path.`, field);
  }
  return value;
}

function uniquePaths(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail('INVALID_SCOPE_PATHS', `${field} must be an array of unique relative paths.`, field);
  const result = value.map((item, index) => relativePath(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) fail('DUPLICATE_SCOPE_PATH', `${field} must not contain duplicate paths.`, field);
  return result;
}

function normalizeScope(value, field = 'scope') {
  const input = plain(value, field);
  exactFields(input, H05_SCOPE_FIELDS, field);
  const scope = {
    scope_id: id(input.scope_id, `${field}.scope_id`),
    snapshot_digest: hash(input.snapshot_digest, `${field}.snapshot_digest`),
    paths: uniquePaths(input.paths ?? [], `${field}.paths`),
    source_paths: uniquePaths(input.source_paths ?? input.paths ?? [], `${field}.source_paths`),
    evidence_paths: uniquePaths(input.evidence_paths ?? [], `${field}.evidence_paths`),
  };
  const all = new Set([...scope.paths, ...scope.source_paths, ...scope.evidence_paths]);
  for (const pathValue of [...scope.source_paths, ...scope.evidence_paths]) if (!all.has(pathValue)) fail('INVALID_SCOPE_PATHS', `${field} contains an inconsistent path set.`, field);
  return scope;
}

function scopeIdentity(scope) {
  return { scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest };
}

function normalizeRolePolicy(value, scope) {
  const input = plain(value, 'role_policy');
  exactFields(input, ROLE_FIELDS, 'role_policy');
  const role = text(input.role, 'role_policy.role');
  const allowedPaths = uniquePaths(input.allowed_paths ?? [], 'role_policy.allowed_paths');
  const allowedEvidencePaths = uniquePaths(input.allowed_evidence_paths ?? allowedPaths, 'role_policy.allowed_evidence_paths');
  const allowedKinds = input.allowed_memory_kinds ?? [];
  const allowedIds = input.allowed_memory_ids ?? [];
  if (!Array.isArray(allowedKinds) || allowedKinds.some((item) => typeof item !== 'string' || !item)) fail('INVALID_ROLE_POLICY', 'role_policy.allowed_memory_kinds must be text.', 'role_policy.allowed_memory_kinds');
  if (!Array.isArray(allowedIds) || allowedIds.some((item) => typeof item !== 'string' || !ID.test(item))) fail('INVALID_ROLE_POLICY', 'role_policy.allowed_memory_ids must be bounded IDs.', 'role_policy.allowed_memory_ids');
  if (!Number.isSafeInteger(input.max_tokens) || input.max_tokens < 1 || input.max_tokens > 8000) fail('INVALID_TOKEN_BUDGET', 'role_policy.max_tokens must be between 1 and 8000.', 'role_policy.max_tokens');
  const maxMemoryRecords = input.max_memory_records ?? 32;
  if (!Number.isSafeInteger(maxMemoryRecords) || maxMemoryRecords < 0 || maxMemoryRecords > 100) fail('INVALID_MEMORY_BUDGET', 'role_policy.max_memory_records must be bounded.', 'role_policy.max_memory_records');
  const allowCandidates = input.allow_candidates ?? false;
  const allowCurrentTruth = input.allow_current_truth ?? true;
  if (typeof allowCandidates !== 'boolean' || typeof allowCurrentTruth !== 'boolean') fail('INVALID_ROLE_POLICY', 'role_policy booleans are invalid.', 'role_policy');
  const scopePaths = new Set([...scope.paths, ...scope.source_paths, ...scope.evidence_paths]);
  for (const [field, paths] of [['allowed_paths', allowedPaths], ['allowed_evidence_paths', allowedEvidencePaths]]) {
    for (const pathValue of paths) {
      if (!scopePaths.has(pathValue)) fail('ROLE_SCOPE_OUT_OF_BOUNDS', `${field} contains a path outside the Mission scope.`, `role_policy.${field}`);
    }
  }
  return {
    role,
    allowed_paths: allowedPaths,
    allowed_evidence_paths: allowedEvidencePaths,
    allowed_memory_kinds: [...allowedKinds],
    allowed_memory_ids: [...allowedIds],
    max_tokens: input.max_tokens,
    max_memory_records: maxMemoryRecords,
    allow_candidates: allowCandidates,
    allow_current_truth: allowCurrentTruth,
  };
}

function refDigest(value, field) {
  return hash(value.sha256 ?? value.source_sha256, `${field}.sha256`);
}

function normalizeReference(value, scope, policy, field, { currentTruth = false, evidence = false } = {}) {
  const input = plain(value, field);
  exactFields(input, REF_FIELDS, field);
  const pathValue = relativePath(input.path, `${field}.path`);
  const digestValue = refDigest(input, field);
  const all = new Set([...scope.paths, ...scope.source_paths, ...scope.evidence_paths]);
  if (!all.has(pathValue)) fail('REFERENCE_OUT_OF_SCOPE', `${field}.path is outside the scope.`, `${field}.path`);
  const allowed = evidence || input.kind === 'evidence' ? policy.allowed_evidence_paths : policy.allowed_paths;
  if (!allowed.includes(pathValue)) fail('ROLE_ALLOWLIST_REFUSED', `${field}.path is not allowed for this role.`, `${field}.path`);
  if (input.scope_id !== undefined && input.scope_id !== scope.scope_id) fail('SCOPE_MISMATCH', `${field}.scope_id does not match scope.`, `${field}.scope_id`);
  for (const snapshotField of ['snapshot_digest', 'source_snapshot_sha256']) {
    if (input[snapshotField] !== undefined && hash(input[snapshotField], `${field}.${snapshotField}`) !== scope.snapshot_digest) fail('STALE_SCOPE', `${field}.${snapshotField} does not match snapshot.`, `${field}.${snapshotField}`);
  }
  if (input.bytes !== undefined && (!Number.isSafeInteger(input.bytes) || input.bytes < 0)) fail('INVALID_REFERENCE_BYTES', `${field}.bytes must be non-negative.`, `${field}.bytes`);
  if (input.start_line !== undefined || input.end_line !== undefined) {
    if (!Number.isSafeInteger(input.start_line) || !Number.isSafeInteger(input.end_line) || input.start_line < 1 || input.end_line < input.start_line) fail('INVALID_REFERENCE_RANGE', `${field} line range is invalid.`, field);
  }
  if (input.stale === true || input.fresh === false || input.freshness === 'stale' || input.status === 'stale') fail('STALE_SCOPE', `${field} is marked stale.`, field);
  if (currentTruth && input.current_truth === false) fail('CURRENT_TRUTH_MUTATION', `${field}.current_truth cannot be downgraded.`, `${field}.current_truth`);
  if (!currentTruth && input.current_truth !== undefined && input.current_truth !== false) fail('CURRENT_TRUTH_MUTATION', `${field}.current_truth must remain false.`, `${field}.current_truth`);
  if (input.authority !== undefined && !['none', 'source'].includes(input.authority)) fail('AUTHORITY_MUTATION', `${field}.authority is not a public marker.`, `${field}.authority`);
  return {
    ...clone(input),
    path: pathValue,
    sha256: digestValue,
    ...(input.source_sha256 === undefined ? {} : { source_sha256: digestValue }),
    ...(input.sha256 === undefined ? {} : { sha256: digestValue }),
    ...(input.current_truth === undefined && currentTruth ? { current_truth: true } : {}),
  };
}

function truthIdentity(ref) {
  return {
    kind: ref.kind === 'evidence' ? 'evidence' : 'source',
    path: ref.path,
    sha256: hash(ref.sha256 ?? ref.source_sha256, 'truth.sha256'),
    bytes: ref.bytes ?? null,
    start_line: ref.start_line ?? null,
    end_line: ref.end_line ?? null,
  };
}

function truthDigest(refs) {
  return `sha256:${digest(refs.map(truthIdentity))}`;
}

function rawSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeTruthRefs(value, scope, policy, field = 'current_truth_refs') {
  if (!Array.isArray(value)) fail('INVALID_CURRENT_TRUTH_REFS', `${field} must be an array.`, field);
  return value.map((entry, index) => normalizeReference(entry, scope, policy, `${field}[${index}]`, { currentTruth: true }));
}

function assertTruthRefs(value, expected, scope, policy, field) {
  const refs = normalizeTruthRefs(value, scope, policy, field);
  if (JSON.stringify(refs.map(truthIdentity)) !== JSON.stringify(expected.map(truthIdentity))) fail('CURRENT_TRUTH_MISMATCH', `${field} does not match the requested references.`, field);
  return refs;
}

function normalizeMemoryScope(value, expected, field) {
  const input = plain(value, field);
  exactFields(input, new Set(['scope_id', 'snapshot_digest', 'paths', 'source_paths', 'evidence_paths']), field);
  if (input.scope_id !== expected.scope_id) fail('SCOPE_MISMATCH', `${field}.scope_id does not match scope.`, `${field}.scope_id`);
  if (input.snapshot_digest !== undefined && hash(input.snapshot_digest, `${field}.snapshot_digest`) !== expected.snapshot_digest) fail('STALE_SCOPE', `${field}.snapshot_digest is stale.`, `${field}.snapshot_digest`);
  for (const name of ['source_paths', 'evidence_paths', 'paths']) {
    if (input[name] === undefined) continue;
    const values = uniquePaths(input[name], `${field}.${name}`);
    const allowed = new Set([...expected.paths, ...expected.source_paths, ...expected.evidence_paths]);
    for (const item of values) if (!allowed.has(item)) fail('REFERENCE_OUT_OF_SCOPE', `${field}.${name} contains an out-of-scope path.`, `${field}.${name}`);
  }
  return clone(input);
}

function validateMemoryRecord(entry, scope, policy, field) {
  const item = plain(entry, field);
  const record = plain(item.record ?? item, `${field}.record`);
  if (typeof record.id !== 'string' || !ID.test(record.id)) fail('MEMORY_RECORD_INVALID', `${field}.record.id is invalid.`, `${field}.record.id`);
  if (policy.allowed_memory_ids.length && !policy.allowed_memory_ids.includes(record.id)) fail('ROLE_ALLOWLIST_REFUSED', `${field}.record.id is not allowed.`, `${field}.record.id`);
  if (typeof record.kind !== 'string' || !policy.allowed_memory_kinds.includes(record.kind)) fail('ROLE_ALLOWLIST_REFUSED', `${field}.record.kind is not allowed.`, `${field}.record.kind`);
  if (record.scope_id !== scope.scope_id) fail('SCOPE_MISMATCH', `${field}.record.scope_id does not match scope.`, `${field}.record.scope_id`);
  if (record.authority !== 'none' || record.current_truth !== false) fail('CURRENT_TRUTH_SEPARATION_FAILED', `${field}.record must remain authority=none/current_truth=false.`, `${field}.record`);
  if (!['verified', 'candidate'].includes(record.status) || (record.status === 'candidate' && !policy.allow_candidates)) fail('MEMORY_CANDIDATE_REFUSED', `${field}.record.status is not allowed.`, `${field}.record.status`);
  if (item.current_truth !== undefined && item.current_truth !== false) fail('CURRENT_TRUTH_SEPARATION_FAILED', `${field}.current_truth must remain false.`, `${field}.current_truth`);
  if (Array.isArray(record.references)) {
    for (const [index, ref] of record.references.entries()) normalizeReference(ref, scope, policy, `${field}.record.references[${index}]`, { evidence: ref.kind === 'evidence' });
  }
  return clone(item);
}

function validateMemoryResult(raw, request, requestDigest) {
  const value = plain(raw, 'memory');
  exactFields(value, MEMORY_FIELDS, 'memory');
  if (value.schema !== HISTOS_MEMORY_RECALL_SCHEMA || (value.version !== undefined && ![0, 1].includes(value.version))) fail('HISTOS_MEMORY_SCHEMA_MISMATCH', 'HISTOS memory output is not histos.memory-recall/v0.', 'memory.schema');
  if (value.authority !== undefined && value.authority !== 'none') fail('AUTHORITY_MUTATION', 'memory.authority must remain none.', 'memory.authority');
  if (value.current_truth !== undefined && value.current_truth !== false) fail('CURRENT_TRUTH_SEPARATION_FAILED', 'memory.current_truth must remain false.', 'memory.current_truth');
  if (value.stale === true || value.fresh === false || value.status === 'stale' || value.incomplete === true || value.complete === false) fail('HISTOS_OUTPUT_STALE', 'HISTOS memory output is stale or incomplete.', 'memory');
  const memoryScope = normalizeMemoryScope(value.scope, request.scope, 'memory.scope');
  assertTruthRefs(value.current_truth_refs, request.current_truth_refs, request.scope, request.role_policy, 'memory.current_truth_refs');
  if (value.query !== undefined && typeof value.query !== 'string') fail('INVALID_MEMORY_QUERY', 'memory.query must be text.', 'memory.query');
  if (!Array.isArray(value.records) || value.records.length > request.role_policy.max_memory_records) fail('MEMORY_BUDGET_EXCEEDED', 'memory.records exceeds the role budget.', 'memory.records');
  if (Array.isArray(value.refusals) && value.refusals.length) fail('HISTOS_OUTPUT_INCOMPLETE', 'memory.refusals is not empty.', 'memory.refusals');
  if (value.refusals !== undefined && !Array.isArray(value.refusals)) fail('INVALID_MEMORY_REFUSALS', 'memory.refusals must be an array.', 'memory.refusals');
  if (Array.isArray(value.supersessions) && value.supersessions.some((entry) => entry?.state === 'stale' || entry?.state === 'unresolved')) fail('HISTOS_OUTPUT_STALE', 'memory.supersessions contains stale state.', 'memory.supersessions');
  const records = value.records.map((entry, index) => validateMemoryRecord(entry, request.scope, request.role_policy, `memory.records[${index}]`));
  if (value.request_digest !== undefined && value.request_digest !== requestDigest) fail('REQUEST_DIGEST_MISMATCH', 'memory.request_digest does not match the detached request.', 'memory.request_digest');
  return { ...clone(value), scope: memoryScope, records };
}

function validateFragment(fragment, request, field) {
  const value = plain(fragment, field);
  const pathValue = relativePath(value.path, `${field}.path`);
  if (!request.role_policy.allowed_paths.includes(pathValue)) fail('ROLE_ALLOWLIST_REFUSED', `${field}.path is not allowed.`, `${field}.path`);
  const sourceSha = hash(value.source_sha256 ?? value.sha256, `${field}.source_sha256`);
  if (typeof value.text !== 'string' || value.text.length === 0) fail('FORGED_CONTEXT_REFUSED', `${field}.text is required.`, `${field}.text`);
  if (!Number.isSafeInteger(value.start_line) || !Number.isSafeInteger(value.end_line) || value.start_line < 1 || value.end_line < value.start_line) fail('INVALID_REFERENCE_RANGE', `${field} line range is invalid.`, field);
  if (!(typeof value.why_included === 'string' || Array.isArray(value.why_included))) fail('FORGED_CONTEXT_REFUSED', `${field}.why_included is required.`, `${field}.why_included`);
  if (value.reopen !== undefined) {
    const reopen = plain(value.reopen, `${field}.reopen`);
    if (reopen.operation !== 'context.read_source' || reopen.scope_id !== request.scope.scope_id || hash(reopen.snapshot_digest, `${field}.reopen.snapshot_digest`) !== request.scope.snapshot_digest || reopen.path !== pathValue || reopen.start_line !== value.start_line || reopen.end_line !== value.end_line) fail('FORGED_CONTEXT_REFUSED', `${field}.reopen is not bound to the requested snapshot.`, `${field}.reopen`);
  }
  return { ...clone(value), source_sha256: sourceSha };
}

function validateContextResult(raw, request, memory, requestDigest) {
  const value = plain(raw, 'context');
  exactFields(value, CONTEXT_FIELDS, 'context');
  if (value.schema !== HISTOS_CONTEXT_CAPSULE_SCHEMA || (value.version !== undefined && value.version !== 1)) fail('HISTOS_CONTEXT_SCHEMA_MISMATCH', 'HISTOS context output is not histos.context-capsule/v1.', 'context.schema');
  if (value.goal !== request.goal) fail('CONTEXT_GOAL_MISMATCH', 'context.goal does not match the requested goal.', 'context.goal');
  if (value.authority !== undefined && value.authority !== 'none') fail('AUTHORITY_MUTATION', 'context.authority must remain none.', 'context.authority');
  if (value.current_truth !== undefined && value.current_truth !== false) fail('CURRENT_TRUTH_SEPARATION_FAILED', 'context.current_truth must remain false.', 'context.current_truth');
  if (value.stale === true || value.fresh === false || value.status === 'stale' || value.incomplete === true || value.complete === false) fail('HISTOS_OUTPUT_STALE', 'HISTOS context output is stale or incomplete.', 'context');
  const contextScope = normalizeScope(value.scope, 'context.scope');
  if (JSON.stringify(contextScope) !== JSON.stringify(request.scope)) fail('SCOPE_MISMATCH', 'context.scope does not match the request.', 'context.scope');
  assertTruthRefs(value.current_truth_refs, request.current_truth_refs, request.scope, request.role_policy, 'context.current_truth_refs');
  if (!Array.isArray(value.source_fragments)) fail('INVALID_CONTEXT_FRAGMENTS', 'context.source_fragments must be an array.', 'context.source_fragments');
  const fragments = value.source_fragments.map((entry, index) => validateFragment(entry, request, `context.source_fragments[${index}]`));
  if (value.source_map !== undefined) {
    if (!Array.isArray(value.source_map)) fail('INVALID_CONTEXT_SOURCE_MAP', 'context.source_map must be an array.', 'context.source_map');
    for (const [index, entry] of value.source_map.entries()) {
      const item = plain(entry, `context.source_map[${index}]`);
      exactFields(item, new Set(['path', 'sha256', 'source_sha256', 'bytes', 'scope_id', 'snapshot_digest']), `context.source_map[${index}]`);
      const pathValue = relativePath(item.path, `context.source_map[${index}].path`);
      if (!request.role_policy.allowed_paths.includes(pathValue)) fail('ROLE_ALLOWLIST_REFUSED', `context.source_map[${index}].path is not allowed.`, `context.source_map[${index}].path`);
      hash(item.sha256 ?? item.source_sha256, `context.source_map[${index}].sha256`);
      if (item.scope_id !== undefined && item.scope_id !== request.scope.scope_id) fail('SCOPE_MISMATCH', `context.source_map[${index}].scope_id is stale.`, `context.source_map[${index}].scope_id`);
      if (item.snapshot_digest !== undefined && hash(item.snapshot_digest, `context.source_map[${index}].snapshot_digest`) !== request.scope.snapshot_digest) fail('STALE_SCOPE', `context.source_map[${index}].snapshot_digest is stale.`, `context.source_map[${index}].snapshot_digest`);
    }
  }
  if (!Array.isArray(value.evidence_refs)) fail('MISSING_EVIDENCE', 'context.evidence_refs must be an array.', 'context.evidence_refs');
  const evidenceRefs = value.evidence_refs.map((entry, index) => normalizeReference(entry, request.scope, request.role_policy, `context.evidence_refs[${index}]`, { evidence: true }));
  if (!Array.isArray(value.memory)) fail('INVALID_CONTEXT_MEMORY', 'context.memory must be an array.', 'context.memory');
  const memoryIds = new Set(memory.records.map((entry) => (entry.record ?? entry).id));
  const contextMemory = value.memory.map((entry, index) => {
    const checked = validateMemoryRecord(entry, request.scope, request.role_policy, `context.memory[${index}]`);
    if (!memoryIds.has((checked.record ?? checked).id)) fail('CONTEXT_MEMORY_MISMATCH', 'context.memory contains a record not returned by read_memory.', `context.memory[${index}]`);
    return checked;
  });
  if (typeof value.rendered_context !== 'string' || value.rendered_context.length === 0) fail('INCOMPLETE_CONTEXT', 'context.rendered_context is required.', 'context.rendered_context');
  const budget = plain(value.budget, 'context.budget');
  if (!Number.isSafeInteger(budget.max_tokens) || budget.max_tokens !== request.role_policy.max_tokens) fail('BUDGET_MISMATCH', 'context.budget.max_tokens does not match role policy.', 'context.budget.max_tokens');
  if (!Number.isSafeInteger(budget.rendered_tokens) || budget.rendered_tokens < 0 || budget.rendered_tokens > request.role_policy.max_tokens) fail('BUDGET_EXCEEDED', 'context.budget.rendered_tokens exceeds role policy.', 'context.budget.rendered_tokens');
  if (budget.rendered_bytes !== undefined && budget.rendered_bytes !== Buffer.byteLength(value.rendered_context, 'utf8')) fail('FORGED_CONTEXT_REFUSED', 'context.budget.rendered_bytes does not match rendered_context.', 'context.budget.rendered_bytes');
  const receipt = plain(value.selection_receipt, 'context.selection_receipt');
  if (typeof receipt.rendered_sha256 !== 'string' || hash(receipt.rendered_sha256, 'context.selection_receipt.rendered_sha256') !== rawSha256(value.rendered_context)) fail('FORGED_CONTEXT_REFUSED', 'context.selection_receipt does not match rendered_context.', 'context.selection_receipt.rendered_sha256');
  if (value.request_digest !== undefined && value.request_digest !== requestDigest) fail('REQUEST_DIGEST_MISMATCH', 'context.request_digest does not match the detached request.', 'context.request_digest');
  return { ...clone(value), scope: contextScope, source_fragments: fragments, evidence_refs: evidenceRefs, memory: contextMemory };
}

function requestDigest(value) {
  return `sha256:${digest(value)}`;
}

function normalizeRequest(input) {
  const value = plain(input, 'h05_request');
  exactFields(value, REQUEST_FIELDS, 'h05_request');
  const scope = normalizeScope(value.scope);
  const role_policy = normalizeRolePolicy(value.role_policy, scope);
  const current_truth_refs = normalizeTruthRefs(value.current_truth_refs, scope, role_policy);
  if (!role_policy.allow_current_truth && current_truth_refs.length) fail('CURRENT_TRUTH_NOT_ALLOWED', 'role_policy does not allow current-truth refs.', 'current_truth_refs');
  const goal = text(value.goal, 'goal');
  const query = value.query === undefined ? goal : text(value.query, 'query');
  return { scope, current_truth_refs, role_policy, goal, query };
}

function memoryScopeFor(request) {
  return {
    scope_id: request.scope.scope_id,
    source_paths: [...request.scope.source_paths],
    evidence_paths: [...request.scope.evidence_paths],
  };
}

function memoryRefsFor(request) {
  return request.current_truth_refs.map((ref) => ({
    kind: ref.kind === 'evidence' ? 'evidence' : 'source',
    path: ref.path,
    sha256: hash(ref.sha256 ?? ref.source_sha256, 'current_truth_refs.sha256'),
    ...(ref.bytes === undefined ? {} : { bytes: ref.bytes }),
    ...(ref.start_line === undefined ? {} : { start_line: ref.start_line, end_line: ref.end_line }),
  }));
}

function assertEventRefs(event, scope, currentTruthRefs, evidenceRefs) {
  const expectedScope = { scope_id: scope.scope_id, source_snapshot_sha256: scope.snapshot_digest };
  if (event.scope.scope_id !== expectedScope.scope_id || event.scope.source_snapshot_sha256 !== expectedScope.source_snapshot_sha256) fail('EVENT_SCOPE_MISMATCH', 'Evidence event scope is not exact.');
  const expectedTruth = currentTruthRefs.map((ref) => ({ kind: 'snapshot', path: ref.path, sha256: hash(ref.sha256 ?? ref.source_sha256, 'event.source.sha256'), bytes: ref.bytes }));
  if (JSON.stringify(event.source_snapshot_refs) !== JSON.stringify(expectedTruth.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))) fail('EVENT_REFERENCE_MISMATCH', 'Evidence event source references do not match current truth.');
  const expectedEvidence = evidenceRefs.map((ref) => ({ kind: ref.kind === 'evidence' ? 'evidence' : 'source', path: ref.path, sha256: hash(ref.sha256 ?? ref.source_sha256, 'event.output.sha256'), bytes: ref.bytes }));
  const actual = event.output_artifact_refs.map(({ kind, path, sha256, bytes }) => ({ kind, path, sha256, bytes }));
  if (JSON.stringify(actual) !== JSON.stringify(expectedEvidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))) fail('EVENT_REFERENCE_MISMATCH', 'Evidence event output references do not match context evidence.');
}

/**
 * Build the event returned to EPHEMERA from one validated H05 materialization.
 * The event is an observation only (`authority=none`, `current_truth=false` in
 * downstream projections); it cannot carry a Mission transition or activation.
 */
export function buildEphemeraObservationEvent({ scope, current_truth_refs, evidence_refs, event = {} } = {}) {
  const normalizedScope = normalizeScope(scope);
  const rolePolicy = {
    allowed_paths: [...new Set([...normalizedScope.paths, ...normalizedScope.source_paths])],
    allowed_evidence_paths: [...normalizedScope.evidence_paths],
  };
  const truth = normalizeTruthRefs(current_truth_refs, normalizedScope, { ...rolePolicy, allowed_paths: rolePolicy.allowed_paths, allowed_evidence_paths: rolePolicy.allowed_evidence_paths });
  if (!Array.isArray(evidence_refs) || evidence_refs.length === 0) fail('MISSING_EVIDENCE', 'An EPHEMERA observation requires at least one evidence reference.');
  const evidence = evidence_refs.map((entry, index) => normalizeReference(entry, normalizedScope, { ...rolePolicy }, `evidence_refs[${index}]`, { evidence: true }));
  for (const [index, ref] of [...truth, ...evidence].entries()) if (!Number.isSafeInteger(ref.bytes)) fail('EVIDENCE_BYTES_REQUIRED', `event reference ${index} requires bytes.`, `event.references[${index}]`);
  const sourceSnapshotRefs = truth.map((ref) => ({ kind: 'snapshot', path: ref.path, sha256: hash(ref.sha256 ?? ref.source_sha256, 'event.source.sha256'), bytes: ref.bytes, scope_id: normalizedScope.scope_id, source_snapshot_sha256: normalizedScope.snapshot_digest }));
  const outputRefs = evidence.map((ref) => ({ kind: ref.kind === 'evidence' ? 'evidence' : 'source', path: ref.path, sha256: hash(ref.sha256 ?? ref.source_sha256, 'event.output.sha256'), bytes: ref.bytes, scope_id: normalizedScope.scope_id, source_snapshot_sha256: normalizedScope.snapshot_digest }));
  const input = plain(event, 'event');
  if (input.scope !== undefined && JSON.stringify(input.scope) !== JSON.stringify({ scope_id: normalizedScope.scope_id, source_snapshot_sha256: normalizedScope.snapshot_digest })) fail('EVENT_SCOPE_MISMATCH', 'event.scope cannot override the H05 scope.');
  if (input.source_snapshot_refs !== undefined) fail('EVENT_REFERENCE_MISMATCH', 'event.source_snapshot_refs are derived from current truth.');
  if (input.output_artifact_refs !== undefined) fail('EVENT_REFERENCE_MISMATCH', 'event.output_artifact_refs are derived from evidence refs.');
  if (input.event_kind !== undefined && input.event_kind !== 'operation_observation') fail('EVENT_KIND_MISMATCH', 'H05 return events are operation observations.');
  if (input.authority !== undefined || input.current_truth !== undefined || input.activation !== undefined) fail('EVENT_AUTHORITY_MUTATION', 'Observation events cannot carry authority or activation.');
  const producer = input.producer ?? { id: 'histos-ephemera-h05-bridge', kind: 'ephemera', version: '1' };
  if (producer.kind !== undefined && producer.kind !== 'ephemera') fail('EVENT_PRODUCER_MISMATCH', 'H05 bridge events must be produced as ephemera observations.');
  const operation = input.operation_signature ?? {
    operation_id: 'histos-ephemera-h05-compatibility',
    name: 'histos.ephemera-h05-compatibility',
    version: '1',
    semantic_steps: ['read_memory', 'compile_context'],
    scope_id: normalizedScope.scope_id,
    source_snapshot_sha256: normalizedScope.snapshot_digest,
  };
  const normalized = normalizeEphemeraEvent({
    ...input,
    producer,
    event_kind: 'operation_observation',
    scope: { scope_id: normalizedScope.scope_id, source_snapshot_sha256: normalizedScope.snapshot_digest },
    source_snapshot_refs: sourceSnapshotRefs,
    output_artifact_refs: outputRefs,
    operation_signature: operation,
  });
  assertEventRefs(normalized, normalizedScope, truth, evidence);
  return deepFreeze(clone(normalized));
}

/**
 * Inject the public HISTOS callbacks expected by EPHEMERA H05.  Requests and
 * callback results are detached snapshots.  `mission_transition` is accepted
 * only as a test probe and is intentionally never called.
 */
export function createEphemeraH05CompatibilityBridge({ compile_context, read_memory, mission_transition = null } = {}) {
  if (typeof compile_context !== 'function') fail('HISTOS_CONTRACT_REQUIRED', 'compile_context callback is required.', 'compile_context');
  if (typeof read_memory !== 'function') fail('HISTOS_CONTRACT_REQUIRED', 'read_memory callback is required.', 'read_memory');
  if (mission_transition !== null && typeof mission_transition !== 'function') fail('INVALID_TRANSITION_PROBE', 'mission_transition probe must be a function or null.');

  async function materialize(input = {}, { event = null } = {}) {
    const request = normalizeRequest(input);
    const memoryRequest = {
      scope: memoryScopeFor(request),
      current_truth_refs: memoryRefsFor(request),
      role: request.role_policy.role,
      role_policy: request.role_policy,
      query: request.query,
      max_records: request.role_policy.max_memory_records,
      allowed_memory_kinds: request.role_policy.allowed_memory_kinds,
      allowed_memory_ids: request.role_policy.allowed_memory_ids,
      include_candidates: request.role_policy.allow_candidates,
    };
    const memoryRequestHash = requestDigest(memoryRequest);
    let rawMemory;
    try { rawMemory = await read_memory(clone(memoryRequest)); }
    catch (error) { fail('HISTOS_MEMORY_CALL_FAILED', 'Injected read_memory callback failed.', 'read_memory', error); }
    const memory = validateMemoryResult(clone(rawMemory), request, memoryRequestHash);
    const contextRequest = {
      scope: request.scope,
      current_truth_refs: request.current_truth_refs,
      role: request.role_policy.role,
      role_policy: request.role_policy,
      goal: request.goal,
      query: request.query,
      max_tokens: request.role_policy.max_tokens,
      memory: memory.records,
    };
    const contextRequestHash = requestDigest(contextRequest);
    let rawContext;
    try { rawContext = await compile_context(clone(contextRequest)); }
    catch (error) { fail('HISTOS_CONTEXT_CALL_FAILED', 'Injected compile_context callback failed.', 'compile_context', error); }
    const context = validateContextResult(clone(rawContext), request, memory, contextRequestHash);
    const evidenceRefs = [...context.evidence_refs];
    const result = {
      schema: EPHEMERA_H05_COMPATIBILITY_SCHEMA,
      version: H05_COMPATIBILITY_VERSION,
      scope: request.scope,
      current_truth_refs: request.current_truth_refs,
      current_truth_digest: truthDigest(request.current_truth_refs),
      context,
      memory: memory.records,
      evidence_refs: evidenceRefs,
      authority: 'none',
      current_truth: false,
      mission_transition: 'NOT_REQUESTED',
      callbacks: { compile_context: 'injected-detached', read_memory: 'injected-detached' },
    };
    if (event !== null) result.event = buildEphemeraObservationEvent({ scope: request.scope, current_truth_refs: request.current_truth_refs, evidence_refs: evidenceRefs, event });
    // `mission_transition` is a sentinel only: no production callback is ever
    // called, and retaining the optional probe makes that invariant testable.
    void mission_transition;
    return deepFreeze(clone(result));
  }

  return Object.freeze({ materialize, requestRoleContext: materialize, mission_transition: 'NOT_REQUESTED' });
}

export { createEvidenceEventJournal };

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Provider-neutral Evidence Event boundary.
 *
 * The journal is intentionally an ingest/read model.  It does not promote a
 * claim, approve provenance, activate an operation, or replace H03/H04/A00.
 * Producers submit bounded observations and exact references; a host-owned
 * verifier remains responsible for deciding what evidence is admissible.
 */

export const EVIDENCE_EVENT_SCHEMA = 'histos.evidence-event/v1';
export const EVIDENCE_TELEMETRY_SCHEMA = 'histos.evidence-telemetry/v1';
export const EVENT_KINDS = Object.freeze([
  'user_instruction_or_correction',
  'tool_call',
  'tool_result',
  'command_or_test_result',
  'verifier_result',
  'authority_denial',
  'retry_or_repair',
  'checkpoint_or_handoff',
  'explicit_memory_request',
  'explicit_operator_review',
  'successful_procedure',
  'repeated_operation',
  'operation_observation',
]);
export const OUTCOMES = Object.freeze(['success', 'failure', 'blocked', 'cancelled', 'unknown']);
export const EVIDENCE_CLASSES = Object.freeze(['USER', 'TOOL', 'ACT', 'SELF', 'RECALL']);
export const PRIVACY_CLASSES = Object.freeze(['public', 'internal', 'project', 'private', 'restricted', 'sensitive']);
export const PRODUCER_KINDS = Object.freeze(['codex', 'opencode', 'ephemera', 'verifier', 'operator', 'test', 'adapter', 'histos']);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_REFS = 128;
const MAX_LINEAGE = 16;
const MAX_EVENTS = 10_000;
const expandSafetyKeys = keys => new Set([...keys, ...keys.map(key => key.replaceAll('_', ''))]);
const CONTROL_KEYS = expandSafetyKeys([
  'authority', 'current_truth', 'verified', 'active', 'activation', 'permission',
  'retention', 'mission_state', 'completion', 'safety', 'budget', 'proof', 'support',
]);
const SECRET_KEYS = expandSafetyKeys([
  'secret', 'secrets', 'password', 'passwd', 'token', 'access_token', 'refresh_token',
  'api_key', 'apikey', 'credential', 'credentials', 'authorization', 'cookie', 'private_key',
]);
const TRANSCRIPT_KEYS = expandSafetyKeys([
  'transcript', 'raw_transcript', 'messages', 'conversation', 'chat_history', 'session_text',
  'raw_session', 'prompt', 'completion', 'assistant_message', 'user_message', 'chat_log',
  'payload', 'raw_input', 'raw_output', 'raw_text',
]);
const INDEPENDENT_REFERENCE_KINDS = new Set(['source', 'evidence', 'runtime', 'test', 'artifact', 'snapshot']);
const VERIFICATION_KINDS = new Set(['source', 'runtime_observation', 'independent_test', 'immutable_receipt', 'verifier_receipt']);

const fail = code => { throw new Error(code); };
const clone = value => structuredClone(value);

export function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('EVENT_NON_FINITE_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  fail('EVENT_NON_JSON_VALUE');
}

export function digest(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function assertId(value, code = 'EVENT_ID_INVALID') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code);
  return value;
}

function assertHash(value, code = 'EVENT_SHA256_INVALID') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function boundedString(value, max, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function integer(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function timestamp(value, code) {
  if (typeof value !== 'string' || !ISO.test(value) || Number.isNaN(Date.parse(value))) fail(code);
  return value;
}

function checkSafeObject(value, depth = 0) {
  if (depth > 8) fail('EVENT_METADATA_TOO_DEEP');
  if (Array.isArray(value)) {
    if (value.length > 256) fail('EVENT_METADATA_TOO_LARGE');
    value.forEach(item => checkSafeObject(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    // Normalize separators and camelCase before checking.  Qualification
    // adapters used both snake_case and JavaScript-style metadata names; a
    // spelling variant must not bypass the same fail-closed boundary.
    const normalizedKey = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    const safetyKeys = new Set([normalizedKey, normalizedKey.replaceAll('_', ''), key.toLowerCase().replace(/[\s_-]+/g, '')]);
    if ([...safetyKeys].some(candidate => CONTROL_KEYS.has(candidate))) fail('EVENT_AUTHORITY_MUTATION');
    if ([...safetyKeys].some(candidate => SECRET_KEYS.has(candidate))) fail('EVENT_SECRET_PAYLOAD');
    if ([...safetyKeys].some(candidate => TRANSCRIPT_KEYS.has(candidate))) fail('EVENT_TRANSCRIPT_PAYLOAD');
    if (typeof item === 'string' && item.length > 16 * 1024) fail('EVENT_FIELD_OVERSIZED');
    checkSafeObject(item, depth + 1);
  }
}

function relativePath(value, code = 'EVENT_REFERENCE_PATH_INVALID') {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0') || value.includes('\\') ||
      value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..')) fail(code);
  return value;
}

function normalizeScope(input) {
  const scope = input?.scope && typeof input.scope === 'object' && !Array.isArray(input.scope) ? input.scope : input;
  const directScopeId = input?.scope_id ?? input?.scopeId;
  const nestedScopeId = scope?.scope_id ?? scope?.scopeId;
  if (directScopeId !== undefined && nestedScopeId !== undefined && directScopeId !== nestedScopeId) fail('EVENT_SCOPE_MISMATCH');
  const scope_id = directScopeId ?? nestedScopeId;
  assertId(scope_id, 'EVENT_SCOPE_REQUIRED');
  const directSnapshot = input?.source_snapshot_sha256 ?? input?.snapshot_sha256 ?? input?.snapshot_digest;
  const nestedSnapshot = scope?.source_snapshot_sha256 ?? scope?.snapshot_sha256 ?? scope?.snapshot_digest;
  if (directSnapshot !== undefined && nestedSnapshot !== undefined && directSnapshot !== nestedSnapshot) fail('EVENT_SNAPSHOT_MISMATCH');
  const source_snapshot_sha256 = directSnapshot ?? nestedSnapshot ?? null;
  if (source_snapshot_sha256 !== null) assertHash(source_snapshot_sha256, 'EVENT_SNAPSHOT_INVALID');
  return { scope_id, ...(source_snapshot_sha256 ? { source_snapshot_sha256 } : {}) };
}

function normalizeRef(ref, scope, { requiredKind = null } = {}) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) fail('EVENT_REFERENCE_INVALID');
  const kind = ref.kind ?? requiredKind;
  if (typeof kind !== 'string' || !INDEPENDENT_REFERENCE_KINDS.has(kind)) fail('EVENT_REFERENCE_KIND_INVALID');
  if (requiredKind && kind !== requiredKind) fail('EVENT_REFERENCE_KIND_INVALID');
  const path = ref.path === undefined ? null : relativePath(ref.path);
  const ref_id = ref.ref_id ?? ref.artifact_id ?? ref.snapshot_id ?? ref.id ?? null;
  if (!path && !ref_id) fail('EVENT_REFERENCE_ID_REQUIRED');
  if (ref_id !== null) assertId(ref_id, 'EVENT_REFERENCE_ID_INVALID');
  const sha256 = ref.sha256 ?? ref.artifact_sha256 ?? ref.snapshot_sha256;
  assertHash(sha256, 'EVENT_REFERENCE_SHA256_REQUIRED');
  const bytes = integer(ref.bytes, 0, MAX_ARTIFACT_BYTES, 'EVENT_REFERENCE_BYTES_INVALID');
  if (ref.scope_id !== undefined && ref.scope_id !== scope.scope_id) fail('EVENT_REFERENCE_OUT_OF_SCOPE');
  if (ref.source_snapshot_sha256 !== undefined && scope.source_snapshot_sha256 && ref.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('EVENT_REFERENCE_STALE');
  const result = { kind, ...(path ? { path } : {}), ...(ref_id ? { ref_id } : {}), sha256, bytes };
  if (ref.start_line !== undefined) result.start_line = integer(ref.start_line, 1, 1_000_000, 'EVENT_REFERENCE_RANGE_INVALID');
  if (ref.end_line !== undefined) result.end_line = integer(ref.end_line, 1, 1_000_000, 'EVENT_REFERENCE_RANGE_INVALID');
  if (result.start_line !== undefined && result.end_line !== undefined && result.end_line < result.start_line) fail('EVENT_REFERENCE_RANGE_INVALID');
  return result;
}

function normalizeRefs(refs, scope, requiredKind = null) {
  if (refs === undefined || refs === null) return [];
  if (!Array.isArray(refs) || refs.length > MAX_REFS) fail('EVENT_REFERENCES_INVALID');
  const normalized = refs.map(ref => normalizeRef(ref, scope, { requiredKind }));
  const identities = normalized.map(ref => digest(ref));
  if (new Set(identities).size !== identities.length) fail('EVENT_REFERENCE_DUPLICATE');
  return normalized.sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

function normalizeProducer(input) {
  const producer = input?.producer && typeof input.producer === 'object' && !Array.isArray(input.producer) ? input.producer : {};
  const producer_id = producer.id ?? producer.producer_id ?? input?.producer_id ?? input?.origin_id ?? input?.adapter_id;
  const producer_version = producer.version ?? producer.producer_version ?? input?.producer_version ?? '1';
  let producer_kind = String(producer.kind ?? input?.producer_kind ?? input?.harness ?? 'adapter').toLowerCase();
  producer_kind = ({ open_code: 'opencode', 'open-code': 'opencode', 'ephemera-system': 'ephemera', harness: 'adapter', model: 'adapter' })[producer_kind] ?? producer_kind;
  assertId(producer_id ?? producer_kind, 'EVENT_PRODUCER_ID_REQUIRED');
  boundedString(producer_version, 128, 'EVENT_PRODUCER_VERSION_INVALID');
  if (!PRODUCER_KINDS.includes(producer_kind)) fail('EVENT_PRODUCER_KIND_INVALID');
  return { id: producer_id ?? producer_kind, kind: producer_kind, version: producer_version };
}

function normalizeOperationSignature(input, scope) {
  if (input === undefined || input === null) return null;
  if (typeof input === 'string') return { signature_sha256: assertHash(input, 'EVENT_OPERATION_SIGNATURE_INVALID') };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('EVENT_OPERATION_SIGNATURE_INVALID');
  const operation_id = input.operation_id ?? input.id ?? null;
  const name = input.name ?? operation_id;
  const version = input.version ?? '1';
  if (operation_id !== null) assertId(operation_id, 'EVENT_OPERATION_ID_INVALID');
  if (name !== null) assertId(name, 'EVENT_OPERATION_NAME_INVALID');
  boundedString(String(version), 128, 'EVENT_OPERATION_VERSION_INVALID');
  if (input.scope_id !== undefined && input.scope_id !== scope.scope_id) fail('EVENT_OPERATION_OUT_OF_SCOPE');
  if (input.source_snapshot_sha256 !== undefined && scope.source_snapshot_sha256 && input.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('EVENT_OPERATION_STALE');
  const semantic_steps = input.semantic_steps === undefined ? [] : input.semantic_steps;
  if (!Array.isArray(semantic_steps) || semantic_steps.length > 256 || semantic_steps.some(step => typeof step !== 'string' || !ID.test(step))) fail('EVENT_OPERATION_STEPS_INVALID');
  const normalized = {
    ...(operation_id ? { operation_id } : {}), ...(name ? { name } : {}), version: String(version),
    semantic_steps: [...semantic_steps], scope_id: scope.scope_id,
    ...(scope.source_snapshot_sha256 ? { source_snapshot_sha256: scope.source_snapshot_sha256 } : {}),
  };
  if (input.input_contract !== undefined) {
    checkSafeObject(input.input_contract);
    normalized.input_contract = clone(input.input_contract);
  }
  if (input.output_contract !== undefined) {
    checkSafeObject(input.output_contract);
    normalized.output_contract = clone(input.output_contract);
  }
  const expected = digest(normalized);
  if (input.signature_sha256 !== undefined && input.signature_sha256 !== expected) fail('EVENT_OPERATION_SIGNATURE_FORGED');
  return { ...normalized, signature_sha256: expected };
}

function normalizeVerificationRefs(refs, scope) {
  if (refs === undefined || refs === null) return [];
  if (!Array.isArray(refs) || refs.length > MAX_REFS) fail('EVENT_VERIFICATION_REFS_INVALID');
  return refs.map(ref => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) fail('EVENT_VERIFICATION_REF_INVALID');
    const kind = ref.kind ?? ref.provenance_kind;
    if (typeof kind !== 'string' || !VERIFICATION_KINDS.has(kind)) fail('EVENT_VERIFICATION_KIND_UNSUPPORTED');
    const ref_id = ref.ref_id ?? ref.evidence_id ?? ref.id;
    assertId(ref_id, 'EVENT_VERIFICATION_ID_INVALID');
    const sha256 = ref.sha256 ?? ref.evidence_sha256 ?? ref.claim_sha256;
    assertHash(sha256, 'EVENT_VERIFICATION_SHA256_INVALID');
    if (ref.scope_id !== undefined && ref.scope_id !== scope.scope_id) fail('EVENT_VERIFICATION_OUT_OF_SCOPE');
    if (ref.current_truth !== undefined || ref.authority !== undefined || ref.verified !== undefined) fail('EVENT_AUTHORITY_MUTATION');
    return { kind, ref_id, sha256, ...(ref.bytes === undefined ? {} : { bytes: integer(ref.bytes, 0, MAX_ARTIFACT_BYTES, 'EVENT_VERIFICATION_BYTES_INVALID') }) };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

function normalizeLineage(input) {
  const lineage = input?.lineage && typeof input.lineage === 'object' && !Array.isArray(input.lineage) ? input.lineage : {};
  const result = {};
  for (const key of ['replay_of', 'derived_from', 'parent']) {
    const value = lineage[key] ?? input?.[key];
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    if (values.length > MAX_LINEAGE) fail('EVENT_LINEAGE_TOO_LARGE');
    const ids = values.map(item => assertId(item, 'EVENT_LINEAGE_ID_INVALID'));
    if (ids.some(id => input?.event_id === id)) fail('EVENT_LINEAGE_SELF_REFERENCE');
    result[key] = [...new Set(ids)].sort();
  }
  return result;
}

function normalizeFriction(input) {
  const source = input?.friction && typeof input.friction === 'object' && !Array.isArray(input.friction) ? input.friction : {};
  const fields = ['user_interrupt_count', 'user_correction_count', 'tool_denial_count', 'tool_error_retry_count', 'repair_iteration_count', 'verifier_failure_count'];
  const friction = Object.fromEntries(fields.map(key => [key, integer(source[key] ?? input?.[key] ?? 0, 0, 1_000_000, `EVENT_${key.toUpperCase()}_INVALID`)]));
  const gap = source.knowledge_gap_signal ?? input?.knowledge_gap_signal ?? 0;
  if (typeof gap !== 'number' && typeof gap !== 'boolean') fail('EVENT_KNOWLEDGE_GAP_INVALID');
  friction.knowledge_gap_signal = typeof gap === 'boolean' ? (gap ? 1 : 0) : Math.max(0, Math.min(1, gap));
  friction.friction_score = friction.user_interrupt_count * 3 + friction.user_correction_count * 3 + friction.tool_denial_count * 2 + friction.tool_error_retry_count * 2 + friction.repair_iteration_count + friction.verifier_failure_count * 2 + friction.knowledge_gap_signal;
  return friction;
}

function normalizePrivacy(value) {
  const privacy_class = String(value ?? 'project').toLowerCase();
  if (privacy_class === 'secret' || privacy_class === 'credential' || privacy_class === 'top_secret') fail('EVENT_SECRET_PRIVACY_CLASS');
  if (!PRIVACY_CLASSES.includes(privacy_class) && !['local', 'local_only', 'no_egress', 'provider_allowed', 'ephemeral', 'confidential'].includes(privacy_class)) fail('EVENT_PRIVACY_CLASS_INVALID');
  return privacy_class;
}

function normalizeEventKind(value) {
  const raw = String(value ?? '').toLowerCase().replaceAll('-', '_');
  const event_kind = ({ user_correction: 'user_instruction_or_correction', instruction: 'user_instruction_or_correction', test_result: 'command_or_test_result', verification_result: 'verifier_result', tool_error: 'tool_result', operation: 'operation_observation' })[raw] ?? raw;
  if (!EVENT_KINDS.includes(event_kind)) fail('EVENT_KIND_INVALID');
  return event_kind;
}

function normalizeEvidenceClass(value, eventKind) {
  const evidence_class = String(value ?? ({
    user_instruction_or_correction: 'USER', tool_call: 'TOOL', tool_result: 'TOOL', command_or_test_result: 'ACT',
    verifier_result: 'ACT', authority_denial: 'ACT', retry_or_repair: 'ACT', checkpoint_or_handoff: 'ACT',
    explicit_memory_request: 'USER', explicit_operator_review: 'USER', successful_procedure: 'ACT', repeated_operation: 'ACT', operation_observation: 'ACT',
  }[eventKind] ?? 'TOOL')).toUpperCase();
  if (!EVIDENCE_CLASSES.includes(evidence_class)) fail('EVENT_EVIDENCE_CLASS_INVALID');
  return evidence_class;
}

function normalizeOutputRefs(input, scope) {
  const output = input.output_artifact_refs ?? input.output_refs ?? input.artifact_refs;
  return normalizeRefs(output, scope);
}

/** Normalize one bounded source event. */
export function normalizeEvidenceEvent(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('EVENT_INVALID');
  checkSafeObject(input);
  const scope = normalizeScope({ ...input, ...(options.scope ? { scope: options.scope } : {}) });
  const producer = normalizeProducer(input);
  const event_kind = normalizeEventKind(input.event_kind ?? input.type ?? input.kind);
  const occurred_at = timestamp(input.occurred_at ?? input.timestamp ?? input.created_at, 'EVENT_OCCURRED_AT_INVALID');
  const observed_at = timestamp(input.observed_at ?? options.observed_at ?? occurred_at, 'EVENT_OBSERVED_AT_INVALID');
  const session_or_run_ref = input.session_or_run_ref ?? input.session_id ?? input.run_id;
  assertId(session_or_run_ref, 'EVENT_SESSION_REF_REQUIRED');
  const source_snapshot_refs = normalizeRefs(input.source_snapshot_refs ?? input.snapshot_refs ?? input.source_refs ?? (input.source_snapshot ? [input.source_snapshot] : null), scope, null);
  const input_artifact_refs = normalizeRefs(input.input_artifact_refs ?? input.input_refs ?? (input.input_artifact ? [input.input_artifact] : null), scope);
  const output_artifact_refs = normalizeRefs(input.output_artifact_refs ?? input.output_refs ?? input.artifact_refs ?? (input.output_artifact ? [input.output_artifact] : null), scope);
  const verification_refs = normalizeVerificationRefs(input.verification_refs ?? input.verifications, scope);
  const lineage = normalizeLineage(input);
  const outcome = String(input.outcome ?? (input.success === false ? 'failure' : input.success === true ? 'success' : 'unknown')).toLowerCase();
  if (!OUTCOMES.includes(outcome)) fail('EVENT_OUTCOME_INVALID');
  const evidence_class = normalizeEvidenceClass(input.evidence_class ?? input.claim_origin ?? input.origin_class, event_kind);
  const friction = normalizeFriction(input);
  const smooth_positive = input.smooth_positive === true || input.utility_signal === 'smooth_positive' ||
    (outcome === 'success' && ['successful_procedure', 'repeated_operation'].includes(event_kind));
  if (input.smooth_positive !== undefined && typeof input.smooth_positive !== 'boolean') fail('EVENT_SMOOTH_SIGNAL_INVALID');
  if (input.independent === true || input.independent_support === true || input.can_verify === true) fail('EVENT_AUTHORITY_MUTATION');
  const privacy_class = normalizePrivacy(input.privacy_class ?? input.privacy ?? options.privacy_class);
  const operation_signature = normalizeOperationSignature(input.operation_signature ?? input.operation, scope);
  const producer_event_id = input.producer_event_id ?? input.source_event_id ?? input.event_id ?? input.id ?? null;
  if (producer_event_id !== null) assertId(producer_event_id, 'EVENT_SOURCE_ID_INVALID');
  const replayCore = {
    producer, producer_event_id, scope, session_or_run_ref, event_kind, operation_signature,
    source_snapshot_refs, input_artifact_refs, output_artifact_refs, verification_refs, lineage,
  };
  const replay_key = input.replay_identity?.replay_key ?? input.replay_key ?? digest(replayCore);
  assertHash(replay_key, 'EVENT_REPLAY_KEY_INVALID');
  const event_id = input.event_id ?? `event-${replay_key.slice(0, 32)}`;
  assertId(event_id, 'EVENT_ID_INVALID');
  const normalized = {
    schema: EVIDENCE_EVENT_SCHEMA,
    event_id,
    replay_identity: { replay_key, ...(producer_event_id ? { producer_event_id } : {}) },
    scope,
    producer,
    session_or_run_ref,
    occurred_at,
    observed_at,
    event_kind,
    evidence_class,
    operation_signature,
    source_snapshot_refs,
    input_artifact_refs,
    output_artifact_refs,
    outcome,
    verification_refs,
    lineage,
    privacy_class,
    routing: { ...friction, smooth_positive, friction_only: friction.friction_score > 0 && !smooth_positive },
    // This marker is descriptive, never an authorization or evidence claim.
    independence: evidence_class === 'SELF' || evidence_class === 'RECALL' ? 'non_independent' : 'unclassified',
  };
  const size = Buffer.byteLength(canonical(normalized), 'utf8');
  if (size > MAX_EVENT_BYTES) fail('EVENT_OVERSIZED');
  const event_sha256 = digest(normalized);
  if (input.event_sha256 !== undefined && input.event_sha256 !== event_sha256) fail('EVENT_FORGED');
  return { ...normalized, event_sha256, byte_size: size };
}

function adapt(input, producerKind, defaultKind) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('EVENT_INVALID');
  const producer = input.producer && typeof input.producer === 'object' ? input.producer : {};
  return normalizeEvidenceEvent({
    ...input,
    event_kind: input.event_kind ?? input.type ?? input.kind ?? defaultKind,
    session_or_run_ref: input.session_or_run_ref ?? input.session_id ?? input.run_id,
    producer: { ...producer, id: producer.id ?? input.producer_id ?? producerKind, kind: producer.kind ?? producerKind, version: producer.version ?? input.producer_version ?? '1' },
  });
}

export const normalizeCodexEvent = input => adapt(input, 'codex', 'tool_result');
export const normalizeOpenCodeEvent = input => adapt(input, 'opencode', 'tool_result');
export const normalizeEphemeraEvent = input => adapt(input, 'ephemera', 'operation_observation');
export const normalizeVerifierEvent = input => adapt(input, 'verifier', 'verifier_result');
export const adaptCodexEvent = normalizeCodexEvent;
export const adaptOpenCodeEvent = normalizeOpenCodeEvent;
export const adaptEphemeraEvent = normalizeEphemeraEvent;
export const adaptVerifierEvent = normalizeVerifierEvent;

/**
 * Build a bounded in-memory journal.  Persistence, if desired, belongs to a
 * host-owned store; this API only gives that store an idempotent ingest shape.
 */
export function createEvidenceEventJournal({ scope, maxEvents = MAX_EVENTS, maxBytes = 16 * 1024 * 1024, observed_at } = {}) {
  const journalScope = scope ? normalizeScope({ scope }) : null;
  integer(maxEvents, 1, MAX_EVENTS, 'EVENT_JOURNAL_CAPACITY_INVALID');
  integer(maxBytes, 1024, MAX_EVENT_BYTES * MAX_EVENTS, 'EVENT_JOURNAL_BYTES_INVALID');
  const byId = new Map();
  const byReplay = new Map();
  let bytes = 0;
  const ingest = input => {
    const event = normalizeEvidenceEvent(input, { scope: journalScope ?? undefined, observed_at });
    if (journalScope && event.scope.scope_id !== journalScope.scope_id) fail('EVENT_SCOPE_MISMATCH');
    if (journalScope?.source_snapshot_sha256 && event.scope.source_snapshot_sha256 !== journalScope.source_snapshot_sha256) fail('EVENT_SNAPSHOT_MISMATCH');
    const existingById = byId.get(event.event_id);
    const existingByReplay = byReplay.get(event.replay_identity.replay_key);
    const existing = existingById ?? existingByReplay;
    if (existing) {
      if (existing.event_sha256 !== event.event_sha256 && existing.event_id === event.event_id) fail('EVENT_ID_CONFLICT');
      return { accepted: false, duplicate: true, replayed: existing.event_id !== event.event_id, event: clone(existing) };
    }
    if (byId.size >= maxEvents || bytes + event.byte_size > maxBytes) fail('EVENT_JOURNAL_CAPACITY_EXCEEDED');
    byId.set(event.event_id, event);
    byReplay.set(event.replay_identity.replay_key, event);
    bytes += event.byte_size;
    return { accepted: true, duplicate: false, replayed: false, event: clone(event) };
  };
  const list = ({ scope_id = journalScope?.scope_id, includeNonIndependent = true } = {}) => [...byId.values()]
    .filter(event => (scope_id ? event.scope.scope_id === scope_id : true) && (includeNonIndependent || event.independence !== 'non_independent'))
    .sort((a, b) => a.event_id.localeCompare(b.event_id)).map(clone);
  return {
    ingest,
    append: ingest,
    get: eventId => clone(byId.get(eventId) ?? null),
    list,
    size: () => byId.size,
    bytes: () => bytes,
    clear: () => { byId.clear(); byReplay.clear(); bytes = 0; },
    inspect: () => ({ schema: 'histos.evidence-event-journal/v1', scope: journalScope ? clone(journalScope) : null, count: byId.size, bytes }),
  };
}

const PERSISTENT_EVENT_FILE = /^[a-f0-9]{64}\.json$/u;

// The in-memory journal above is deliberately useful for adapters and unit
// tests, but a live host needs a restart-safe owner for the same ingest
// contract.  This small file-native journal is intentionally not a Mission
// store: it persists only normalized Evidence Events, revalidates every read,
// and exposes no transition, activation, verification or authority method.
// The root is caller-owned and must remain outside a task worktree.
function privateJournalRoot(inputRoot) {
  if (typeof inputRoot !== 'string' || !inputRoot.trim()) fail('EVENT_JOURNAL_ROOT_REQUIRED');
  const target = path.resolve(inputRoot);
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      fs.mkdirSync(current, { mode: 0o700 });
      stat = fs.lstatSync(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink?.() || stat.isReparsePoint?.() || (Number.isInteger(stat.nlink) && stat.nlink > 1)) {
      fail('EVENT_JOURNAL_ROOT_UNSAFE');
    }
  }
  return target;
}

function persistentEventBytes(event) {
  return `${JSON.stringify(event, null, 2)}\n`;
}

/**
 * Create a restart-safe Evidence Event journal.
 *
 * Each normalized event is addressed by its content digest.  Re-opening the
 * journal rechecks schema, scope, digest and byte size, so a malformed or
 * replaced file fails closed.  Exact event/replay duplicates remain
 * idempotent; a conflicting event id is rejected without silently deleting
 * the existing evidence.  The journal never accepts raw transcripts,
 * secrets, Mission state or verifier authority because normalization is the
 * single ingest boundary.
 */
export function createPersistentEvidenceEventJournal({ root, scope, maxEvents = MAX_EVENTS, maxBytes = 16 * 1024 * 1024, observed_at } = {}) {
  const journalRoot = privateJournalRoot(root);
  const journalScope = scope ? normalizeScope({ scope }) : null;
  integer(maxEvents, 1, MAX_EVENTS, 'EVENT_JOURNAL_CAPACITY_INVALID');
  integer(maxBytes, 1024, MAX_EVENT_BYTES * MAX_EVENTS, 'EVENT_JOURNAL_BYTES_INVALID');

  function readAll() {
    const byId = new Map();
    const byReplay = new Map();
    let bytes = 0;
    let names;
    try { names = fs.readdirSync(journalRoot, { withFileTypes: true }); }
    catch { fail('EVENT_JOURNAL_UNAVAILABLE'); }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!PERSISTENT_EVENT_FILE.test(entry.name) || !entry.isFile() || entry.isSymbolicLink?.()) fail('EVENT_JOURNAL_CORRUPT');
      const filePath = path.join(journalRoot, entry.name);
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
      catch { fail('EVENT_JOURNAL_CORRUPT'); }
      let event;
      try {
        // The normalized wire shape nests producer_event_id and replay_key
        // under replay_identity. Restore those aliases before re-normalizing;
        // otherwise the normalizer would (incorrectly) use event_id as the
        // producer identity and report a valid persisted event as forged.
        const candidate = {
          ...parsed,
          ...(parsed.replay_identity?.producer_event_id ? { producer_event_id: parsed.replay_identity.producer_event_id } : {}),
          ...(parsed.replay_identity?.replay_key ? { replay_key: parsed.replay_identity.replay_key } : {}),
          ...(parsed.routing ? {
            friction: {
              user_interrupt_count: parsed.routing.user_interrupt_count,
              user_correction_count: parsed.routing.user_correction_count,
              tool_denial_count: parsed.routing.tool_denial_count,
              tool_error_retry_count: parsed.routing.tool_error_retry_count,
              repair_iteration_count: parsed.routing.repair_iteration_count,
              verifier_failure_count: parsed.routing.verifier_failure_count,
              knowledge_gap_signal: parsed.routing.knowledge_gap_signal,
            },
            smooth_positive: parsed.routing.smooth_positive,
          } : {}),
        };
        event = normalizeEvidenceEvent(candidate, { scope: journalScope ?? undefined, observed_at });
      }
      catch { fail('EVENT_JOURNAL_CORRUPT'); }
      if (entry.name !== `${event.event_sha256}.json` || event.byte_size !== parsed.byte_size || event.event_sha256 !== parsed.event_sha256) fail('EVENT_JOURNAL_CORRUPT');
      const existingById = byId.get(event.event_id);
      if (existingById && existingById.event_sha256 !== event.event_sha256) fail('EVENT_ID_CONFLICT');
      const existingByReplay = byReplay.get(event.replay_identity.replay_key);
      if (existingByReplay && existingByReplay.event_sha256 !== event.event_sha256) fail('EVENT_REPLAY_CONFLICT');
      if (!existingById && !existingByReplay) {
        if (byId.size >= maxEvents || bytes + event.byte_size > maxBytes) fail('EVENT_JOURNAL_CAPACITY_EXCEEDED');
        byId.set(event.event_id, event);
        byReplay.set(event.replay_identity.replay_key, event);
        bytes += event.byte_size;
      }
    }
    return { byId, byReplay, bytes };
  }

  const ingest = input => {
    const event = normalizeEvidenceEvent(input, { scope: journalScope ?? undefined, observed_at });
    const current = readAll();
    const existingById = current.byId.get(event.event_id);
    const existingByReplay = current.byReplay.get(event.replay_identity.replay_key);
    const existing = existingById ?? existingByReplay;
    if (existing) {
      if (existingById && existingById.event_sha256 !== event.event_sha256) fail('EVENT_ID_CONFLICT');
      return { accepted: false, duplicate: true, replayed: existing.event_id !== event.event_id, event: clone(existing) };
    }
    if (current.byId.size >= maxEvents || current.bytes + event.byte_size > maxBytes) fail('EVENT_JOURNAL_CAPACITY_EXCEEDED');
    const destination = path.join(journalRoot, `${event.event_sha256}.json`);
    const encoded = persistentEventBytes(event);
    let fd;
    try {
      fd = fs.openSync(destination, 'wx', 0o600);
      fs.writeFileSync(fd, encoded, 'utf8');
      fs.fsyncSync(fd);
    } catch (error) {
      if (error?.code !== 'EEXIST') fail('EVENT_JOURNAL_WRITE_FAILED');
      const after = readAll();
      const existingAfter = after.byId.get(event.event_id) ?? after.byReplay.get(event.replay_identity.replay_key);
      if (existingAfter) {
        if (after.byId.get(event.event_id)?.event_sha256 && after.byId.get(event.event_id).event_sha256 !== event.event_sha256) fail('EVENT_ID_CONFLICT');
        return { accepted: false, duplicate: true, replayed: existingAfter.event_id !== event.event_id, event: clone(existingAfter) };
      }
      fail('EVENT_JOURNAL_WRITE_RACE');
    } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* preserve durable bytes */ } }
    return { accepted: true, duplicate: false, replayed: false, event: clone(event) };
  };

  return {
    ingest,
    append: ingest,
    get: eventId => readAll().byId.has(eventId) ? clone(readAll().byId.get(eventId)) : null,
    list: ({ scope_id = journalScope?.scope_id, includeNonIndependent = true } = {}) => [...readAll().byId.values()]
      .filter(event => (scope_id ? event.scope.scope_id === scope_id : true) && (includeNonIndependent || event.independence !== 'non_independent'))
      .sort((a, b) => a.event_id.localeCompare(b.event_id)).map(clone),
    size: () => readAll().byId.size,
    bytes: () => readAll().bytes,
    inspect: () => ({ schema: 'histos.evidence-event-journal/v1', scope: journalScope ? clone(journalScope) : null, count: readAll().byId.size, bytes: readAll().bytes, durable: true }),
  };
}

/** Select routing candidates; selection has no epistemic or activation weight. */
export function selectEvidenceEvents(events, { includeFriction = true, includeSmoothPositive = true, scope_id = null, limit = 128 } = {}) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) fail('EVENT_SELECTION_INVALID');
  integer(limit, 1, MAX_EVENTS, 'EVENT_SELECTION_LIMIT_INVALID');
  const selected = [];
  for (const input of events) {
    const event = input?.schema === EVIDENCE_EVENT_SCHEMA ? input : normalizeEvidenceEvent(input);
    if (scope_id && event.scope.scope_id !== scope_id) continue;
    const friction = event.routing.friction_score > 0;
    const smooth = event.routing.smooth_positive === true;
    if (!(includeFriction && friction) && !(includeSmoothPositive && smooth)) continue;
    selected.push({ event_id: event.event_id, replay_key: event.replay_identity.replay_key, route: friction ? 'friction' : 'smooth_positive', event_kind: event.event_kind, scope_id: event.scope.scope_id, evidence_class: event.evidence_class, outcome: event.outcome, routing: clone(event.routing), authority: 'none', current_truth: false });
    if (selected.length >= limit) break;
  }
  return selected;
}

function refsForTelemetry(event) {
  return [...event.source_snapshot_refs, ...event.input_artifact_refs, ...event.output_artifact_refs].map(ref => ({ ...ref }));
}

export function toH03Telemetry(eventInput) {
  const event = eventInput?.schema === EVIDENCE_EVENT_SCHEMA ? eventInput : normalizeEvidenceEvent(eventInput);
  return { schema: `${EVIDENCE_TELEMETRY_SCHEMA}/h03`, event_id: event.event_id, scope: clone(event.scope), event_kind: event.event_kind, outcome: event.outcome, evidence_class: event.evidence_class, references: refsForTelemetry(event), lineage: clone(event.lineage), routing: clone(event.routing), authority: 'none', current_truth: false };
}

export function toH04Telemetry(eventInput) {
  const event = eventInput?.schema === EVIDENCE_EVENT_SCHEMA ? eventInput : normalizeEvidenceEvent(eventInput);
  const refs = refsForTelemetry(event);
  return { schema: `${EVIDENCE_TELEMETRY_SCHEMA}/h04`, id: event.event_id, scope_id: event.scope.scope_id, kind: 'memory', resource_id: event.operation_signature?.operation_id ?? event.event_id, fingerprint: event.event_sha256, declared_bytes: refs.reduce((total, ref) => total + ref.bytes, 0), references: refs, authority: 'none', current_truth: false, routing: clone(event.routing) };
}

export function toA00Telemetry(eventInput) {
  const event = eventInput?.schema === EVIDENCE_EVENT_SCHEMA ? eventInput : normalizeEvidenceEvent(eventInput);
  return { schema: `${EVIDENCE_TELEMETRY_SCHEMA}/a00`, observation_id: event.event_id, evidence_event_id: event.event_id, scope_id: event.scope.scope_id, source_snapshot_sha256: event.scope.source_snapshot_sha256 ?? null, signature_sha256: event.operation_signature?.signature_sha256 ?? null, sequence: event.operation_signature?.semantic_steps ?? [event.event_kind], outcome: event.outcome === 'success' ? 'success' : event.outcome === 'failure' ? 'failure' : 'abstain', evidence: refsForTelemetry(event), routing: clone(event.routing), authority: 'none', current_truth: false, activation: { authorized: false } };
}

export function projectEventTelemetry(eventInput, target) {
  if (target === 'h03') return toH03Telemetry(eventInput);
  if (target === 'h04') return toH04Telemetry(eventInput);
  if (target === 'a00') return toA00Telemetry(eventInput);
  fail('EVENT_TELEMETRY_TARGET_UNSUPPORTED');
}

export const ingestEvidenceEvent = normalizeEvidenceEvent;
export const normalizeEvent = normalizeEvidenceEvent;
export const normalizeEventEnvelope = normalizeEvidenceEvent;
export const buildEvidenceEvent = normalizeEvidenceEvent;
export const ingestEvent = normalizeEvidenceEvent;
export const createEventJournal = createEvidenceEventJournal;
export const selectRoutableEvents = selectEvidenceEvents;

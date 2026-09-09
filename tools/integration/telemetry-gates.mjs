import {
  normalizeEvidenceEvent,
  selectEvidenceEvents,
  toA00Telemetry,
} from '../events/evidence-events.mjs';
import {
  buildAutomationCandidate,
  createOperationSignature,
  digest as candidateDigest,
  validateAutomationCandidate,
} from '../intelligence/operation-candidates.mjs';
import {
  canonical as policyCanonical,
  evaluatePolicyExperiment,
} from '../policy/retrieval-policy-experiment.mjs';

/**
 * Bounded, non-authoritative integration for Evidence Events.
 *
 * R8 deliberately composes the existing A00/A01 contracts rather than
 * creating another learner.  Evidence Events are normalized again at this
 * boundary, routing fields are telemetry only, and A00/A01 retain their own
 * provenance and held-out gates.
 */
export const TELEMETRY_GATES_SCHEMA = 'histos.telemetry-gates/v1';
export const A00_PROJECTION_SCHEMA = 'histos.telemetry-gates/a00/v1';
export const A01_PROJECTION_SCHEMA = 'histos.telemetry-gates/a01/v1';

const fail = code => { throw new Error(code); };
const clone = value => structuredClone(value);
const HASH = /^[a-f0-9]{64}$/u;

function same(value, expected) {
  return policyCanonical(value) === policyCanonical(expected);
}

function normalizeEvent(input, scope = undefined) {
  // Always re-normalize an envelope supplied by a caller.  This prevents a
  // caller from bypassing the Evidence Event authority/secret/scope checks by
  // adding a forged field to an otherwise valid normalized object.
  // The normalized shape stores producer_event_id under replay_identity, while
  // the input shape accepts it at the top level.  Restore that alias before
  // re-normalization so an unchanged envelope remains byte-identical.
  const suppliedEventSha = input?.schema === 'histos.evidence-event/v1' ? input.event_sha256 : undefined;
  const suppliedByteSize = input?.schema === 'histos.evidence-event/v1' ? input.byte_size : undefined;
  const candidate = input?.schema === 'histos.evidence-event/v1'
    ? (() => {
      const { event_sha256: _eventSha, byte_size: _byteSize, ...envelope } = input;
      return {
      ...envelope,
      ...(input.replay_identity?.producer_event_id ? { producer_event_id: input.replay_identity.producer_event_id } : {}),
      ...(input.replay_identity?.replay_key ? { replay_key: input.replay_identity.replay_key } : {}),
      ...(input.routing ? {
        friction: {
          user_interrupt_count: input.routing.user_interrupt_count,
          user_correction_count: input.routing.user_correction_count,
          tool_denial_count: input.routing.tool_denial_count,
          tool_error_retry_count: input.routing.tool_error_retry_count,
          repair_iteration_count: input.routing.repair_iteration_count,
          verifier_failure_count: input.routing.verifier_failure_count,
          knowledge_gap_signal: input.routing.knowledge_gap_signal,
        },
        smooth_positive: input.routing.smooth_positive,
      } : {}),
      };
    })()
    : input;
  // Normalize against the event's declared scope first.  The caller-owned
  // scope is compared below; replacing it before normalization would hide a
  // stale or out-of-scope declaration.
  const normalized = normalizeEvidenceEvent(candidate);
  if (suppliedEventSha !== undefined && suppliedEventSha !== normalized.event_sha256) fail('EVENT_FORGED');
  if (suppliedByteSize !== undefined && suppliedByteSize !== normalized.byte_size) fail('EVENT_SIZE_FORGED');
  return normalized;
}

function eventScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) fail('R8_SCOPE_REQUIRED');
  const scope_id = scope.scope_id ?? scope.scopeId;
  if (typeof scope_id !== 'string' || !scope_id) fail('R8_SCOPE_REQUIRED');
  const source_snapshot_sha256 = scope.source_snapshot_sha256 ?? scope.source_snapshot_digest ?? scope.snapshot_sha256;
  if (typeof source_snapshot_sha256 !== 'string' || !HASH.test(source_snapshot_sha256)) fail('R8_SNAPSHOT_REQUIRED');
  return { scope_id, source_snapshot_sha256 };
}

function sameOperationSignature(eventSignature, candidateSignature) {
  if (!eventSignature || typeof eventSignature !== 'object' || Array.isArray(eventSignature)) return false;
  const fields = ['operation_id', 'name', 'version', 'scope_id', 'source_snapshot_sha256', 'semantic_steps'];
  if (fields.some(field => !same(eventSignature[field], candidateSignature[field]))) return false;
  if (eventSignature.signature_sha256 === undefined) return false;
  // The two contracts use distinct envelopes (the Evidence Event signature
  // does not carry A00's schema field).  Compare semantic contracts exactly,
  // then bind the event to the caller-owned A00 signature hash.
  return same(eventSignature.input_contract ?? null, candidateSignature.input_contract) &&
    same(eventSignature.output_contract ?? null, candidateSignature.output_contract);
}

function referenceForA00(ref, scope) {
  if (!ref || !['source', 'evidence'].includes(ref.kind) || typeof ref.path !== 'string') return null;
  return {
    kind: ref.kind,
    path: ref.path,
    sha256: ref.sha256,
    bytes: ref.bytes,
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
  };
}

function eventEvidence(event, scope) {
  const refs = [
    ...event.source_snapshot_refs,
    ...event.input_artifact_refs,
    ...event.output_artifact_refs,
  ].map(ref => referenceForA00(ref, scope)).filter(Boolean);
  if (refs.length === 0) fail('R8_OPERATION_EVIDENCE_REQUIRED');
  const unique = new Map(refs.map(ref => [`${ref.kind}:${ref.path}:${ref.sha256}:${ref.bytes}`, ref]));
  return {
    evidence_id: `event-evidence-${event.event_id}`,
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    state: 'fresh',
    kind: 'independent_test',
    references: [...unique.values()],
    authority: 'none',
    current_truth: false,
  };
}

function observationFromEvent(event, signature, scope) {
  const inputRefs = [...event.input_artifact_refs];
  const outputRefs = [...event.output_artifact_refs];
  const outcome = event.outcome === 'success' ? 'success' : event.outcome === 'failure' ? 'failure' : 'abstain';
  return {
    observation_id: event.event_id,
    signature_sha256: signature.signature_sha256,
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    sequence: [...event.operation_signature.semantic_steps],
    // Evidence Events intentionally do not contain raw input/output payloads.
    // Hashing the bounded reference identities is an honest observation of
    // what was seen and does not mint a value or verification claim.
    input_sha256: candidateDigest(inputRefs),
    output_sha256: candidateDigest(outputRefs.length ? outputRefs : { event_sha256: event.event_sha256 }),
    outcome,
    // Friction/smooth-positive routing is intentionally not an A00 quality
    // or repeat-work metric.  Keep this observation field neutral; callers
    // can inspect the separate telemetry projection for routing counts.
    repair_iterations: 0,
    cost: { model_calls: 0, tool_calls: 0, tokens: 0, elapsed_ms: 0 },
    evidence: [eventEvidence(event, scope)],
  };
}

function uniqueEvents(inputs, scope, { requireOperation = false } = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 128) fail('R8_EVENTS_INVALID');
  const byReplay = new Map();
  const byId = new Map();
  for (const input of inputs) {
    const event = normalizeEvent(input, scope);
    if (scope && event.scope.scope_id !== scope.scope_id) fail('EVENT_SCOPE_MISMATCH');
    if (scope && event.scope.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('EVENT_SNAPSHOT_MISMATCH');
    if (requireOperation && event.event_kind !== 'operation_observation') fail('R8_OPERATION_KIND_REQUIRED');
    const priorReplay = byReplay.get(event.replay_identity.replay_key);
    if (priorReplay) {
      if (priorReplay.event_sha256 !== event.event_sha256) fail('R8_REPLAY_CONFLICT');
      continue;
    }
    const priorId = byId.get(event.event_id);
    if (priorId) {
      if (priorId.event_sha256 !== event.event_sha256) fail('R8_EVENT_ID_CONFLICT');
      continue;
    }
    byReplay.set(event.replay_identity.replay_key, event);
    byId.set(event.event_id, event);
  }
  return [...byReplay.values()].sort((a, b) => a.event_id.localeCompare(b.event_id));
}

/**
 * Project operation_observation Events into A00's OBSERVED read model.
 *
 * The caller supplies the A00 operation signature; every event must bind to
 * the same operation, scope and source snapshot.  No lifecycle transition,
 * verifier receipt, or activation is performed here.
 */
export function projectOperationObservationEvents({ signature, events, producer_id = 'histos-r8-a00', counterexamples = [] }) {
  if (!signature || typeof signature !== 'object') fail('R8_OPERATION_SIGNATURE_REQUIRED');
  const scope = eventScope(signature);
  if (signature.scope_id !== scope.scope_id || signature.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('R8_SIGNATURE_SCOPE_MISMATCH');
  const normalizedSignature = createOperationSignature(signature);
  if (normalizedSignature.signature_sha256 !== signature.signature_sha256) fail('R8_SIGNATURE_FORGED');
  const unique = uniqueEvents(events, scope, { requireOperation: true });
  for (const event of unique) {
    if (!event.operation_signature || !sameOperationSignature(event.operation_signature, normalizedSignature)) fail('R8_OPERATION_SIGNATURE_MISMATCH');
    if (event.scope.scope_id !== scope.scope_id || event.scope.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('R8_OPERATION_SCOPE_MISMATCH');
    if (event.operation_signature.signature_sha256 !== candidateDigest({
      operation_id: event.operation_signature.operation_id,
      name: event.operation_signature.name,
      version: event.operation_signature.version,
      scope_id: event.operation_signature.scope_id,
      source_snapshot_sha256: event.operation_signature.source_snapshot_sha256,
      semantic_steps: event.operation_signature.semantic_steps,
      ...(event.operation_signature.input_contract === undefined ? {} : { input_contract: event.operation_signature.input_contract }),
      ...(event.operation_signature.output_contract === undefined ? {} : { output_contract: event.operation_signature.output_contract }),
    })) fail('R8_OPERATION_SIGNATURE_FORGED');
  }
  const observations = unique.map(event => observationFromEvent(event, normalizedSignature, scope));
  const candidate = buildAutomationCandidate({ signature: normalizedSignature, observations, producer_id, counterexamples });
  const checked = validateAutomationCandidate(candidate);
  if (checked.state !== 'OBSERVED' || checked.authority !== 'none' || checked.current_truth !== false || checked.activation?.authorized !== false) fail('R8_A00_AUTHORITY_BOUNDARY');
  const telemetry = unique.map(event => toA00Telemetry(event));
  return {
    schema: A00_PROJECTION_SCHEMA,
    candidate: checked,
    telemetry,
    accepted_event_ids: unique.map(event => event.event_id),
    replay_keys: unique.map(event => event.replay_identity.replay_key),
    authority: 'none',
    current_truth: false,
    activation: { authorized: false },
  };
}

function telemetryForA01(events, scope) {
  const routed = selectEvidenceEvents(events, { scope_id: scope.scope_id, includeFriction: true, includeSmoothPositive: true, limit: 128 });
  const byId = new Map(routed.map(item => [item.event_id, item]));
  const rows = events.map(event => {
    const selected = byId.get(event.event_id);
    const route = selected?.route ?? 'neutral';
    return {
      event_id: event.event_id,
      replay_key: event.replay_identity.replay_key,
      event_kind: event.event_kind,
      scope_id: event.scope.scope_id,
      outcome: event.outcome,
      route,
      routing: clone(event.routing),
      authority: 'none',
      current_truth: false,
    };
  });
  const routeCounts = rows.reduce((counts, row) => {
    counts[row.route] = (counts[row.route] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schema: A01_PROJECTION_SCHEMA,
    event_count: rows.length,
    routed_event_count: routed.length,
    route_counts: routeCounts,
    events: rows,
    authority: 'none',
    current_truth: false,
  };
}

/**
 * Evaluate A01 exactly as supplied, then attach bounded routing telemetry.
 * Telemetry is not an input to policy evaluation and cannot alter selection or
 * rollback.  The fixed A01 report remains the source of candidate decisions.
 */
export function evaluatePolicyWithTelemetry({ baseline, candidates = [], cases, evidence, events = [] }) {
  const scope = eventScope(baseline?.policy?.scope);
  const unique = events.length === 0 ? [] : uniqueEvents(events, scope);
  const report = evaluatePolicyExperiment({ baseline, candidates, cases, evidence });
  return {
    ...report,
    telemetry: telemetryForA01(unique, scope),
  };
}

export function stripTelemetry(report) {
  if (!report || typeof report !== 'object') fail('R8_REPORT_REQUIRED');
  const { telemetry: _telemetry, ...withoutTelemetry } = report;
  return withoutTelemetry;
}

export const projectA00Events = projectOperationObservationEvents;
export const evaluateA01WithTelemetry = evaluatePolicyWithTelemetry;

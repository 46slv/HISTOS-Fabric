import assert from 'node:assert/strict';
import test from 'node:test';

import {
  A00_PROJECTION_SCHEMA,
  A01_PROJECTION_SCHEMA,
  evaluatePolicyWithTelemetry,
  projectOperationObservationEvents,
  stripTelemetry,
} from './telemetry-gates.mjs';
import {
  POLICY_SCHEMA,
  canonical as policyCanonical,
  evaluatePolicyExperiment,
  sealPolicy,
  sha256,
} from '../policy/retrieval-policy-experiment.mjs';
import { createOperationSignature } from '../intelligence/operation-candidates.mjs';
import { normalizeEvidenceEvent } from '../events/evidence-events.mjs';

const source = { kind: 'source', path: 'fixtures/operation.md', sha256: 'b'.repeat(64), bytes: 24 };
const operationScope = { scope_id: 'r8-project', source_snapshot_sha256: 'a'.repeat(64) };
const operationSignature = createOperationSignature({
  operation_id: 'repair-index', name: 'repair-index', version: '1', scope: operationScope,
  semantic_steps: ['read', 'repair', 'verify'],
  input_contract: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false },
  output_contract: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { enum: ['repaired'] } }, additionalProperties: false },
});

// Evidence Event operation signatures intentionally omit A00's schema field;
// the R8 adapter binds all semantic fields to the caller-owned A00 signature.
const eventOperation = {
  operation_id: operationSignature.operation_id,
  name: operationSignature.name,
  version: operationSignature.version,
  scope_id: operationScope.scope_id,
  source_snapshot_sha256: operationScope.source_snapshot_sha256,
  semantic_steps: [...operationSignature.semantic_steps],
  input_contract: structuredClone(operationSignature.input_contract),
  output_contract: structuredClone(operationSignature.output_contract),
};

const eventBase = overrides => ({
  scope: operationScope,
  producer: { id: 'codex', kind: 'codex', version: '1' },
  producer_event_id: 'r8-event-1',
  session_or_run_ref: 'r8-session',
  occurred_at: '2026-09-09T01:02:03.000Z',
  observed_at: '2026-09-09T01:02:04.000Z',
  event_kind: 'operation_observation',
  operation_signature: eventOperation,
  source_snapshot_refs: [source],
  outcome: 'success',
  privacy_class: 'project',
  ...overrides,
});

const operationEvent = overrides => normalizeEvidenceEvent(eventBase(overrides));

test('R8 projects Codex/OpenCode operation observations into one OBSERVED A00 candidate', () => {
  const codex = operationEvent({ event_id: 'codex-operation', producer: { id: 'codex', kind: 'codex', version: '1' }, producer_event_id: 'codex-operation' });
  const openCode = operationEvent({ event_id: 'opencode-operation', producer: { id: 'opencode', kind: 'opencode', version: '1' }, producer_event_id: 'opencode-operation', friction: { tool_error_retry_count: 1 } });
  const projection = projectOperationObservationEvents({ signature: operationSignature, events: [codex, openCode] });
  assert.equal(projection.schema, A00_PROJECTION_SCHEMA);
  assert.equal(projection.candidate.state, 'OBSERVED');
  assert.equal(projection.candidate.metrics.occurrence_count, 2);
  assert.equal(projection.candidate.authority, 'none');
  assert.equal(projection.candidate.current_truth, false);
  assert.equal(projection.candidate.activation.authorized, false);
  assert.deepEqual(projection.telemetry.map(item => item.authority), ['none', 'none']);
  assert.deepEqual(projection.telemetry.map(item => item.current_truth), [false, false]);
  assert.deepEqual(projection.accepted_event_ids, ['codex-operation', 'opencode-operation']);
});

test('R8 duplicate/replay identity never adds A00 support', () => {
  const event = operationEvent({ event_id: 'duplicate-operation' });
  const projection = projectOperationObservationEvents({ signature: operationSignature, events: [event, structuredClone(event)] });
  assert.equal(projection.candidate.metrics.occurrence_count, 1);
  assert.deepEqual(projection.accepted_event_ids, ['duplicate-operation']);
});

test('R8 A00 projection rejects missing/stale/out-of-scope/authority-mutating evidence', () => {
  assert.throws(() => projectOperationObservationEvents({ signature: operationSignature, events: [eventBase({ event_id: 'missing-signature', operation_signature: undefined })] }), /R8_OPERATION_SIGNATURE_MISMATCH/);
  assert.throws(() => projectOperationObservationEvents({ signature: operationSignature, events: [eventBase({ event_id: 'missing-evidence', source_snapshot_refs: undefined })] }), /R8_OPERATION_EVIDENCE_REQUIRED/);
  assert.throws(() => projectOperationObservationEvents({ signature: operationSignature, events: [eventBase({ event_id: 'stale-snapshot', scope: { ...operationScope, source_snapshot_sha256: 'c'.repeat(64) } })] }), /EVENT_SNAPSHOT_MISMATCH|EVENT_OPERATION_STALE/);
  assert.throws(() => projectOperationObservationEvents({ signature: operationSignature, events: [eventBase({ event_id: 'outside-scope', source_snapshot_refs: [{ ...source, scope_id: 'other-project' }] })] }), /EVENT_REFERENCE_OUT_OF_SCOPE/);
  assert.throws(() => projectOperationObservationEvents({ signature: operationSignature, events: [eventBase({ event_id: 'authority-mutation', current_truth: true })] }), /EVENT_AUTHORITY_MUTATION/);
});

const a01Scope = {
  scope_id: 'r8-a01',
  source_snapshot_digest: 'd'.repeat(64),
  source_paths: ['alpha.md', 'beta.md'],
  evidence_paths: ['evidence/alpha.json', 'evidence/beta.json'],
};
const a01Source = (path, text) => ({ kind: 'source', path, sha256: sha256(text), bytes: Buffer.byteLength(text) });
const a01Evidence = (path, text) => ({ kind: 'evidence', path, sha256: sha256(text), bytes: Buffer.byteLength(text) });
const a01Refs = {
  alpha: a01Source('alpha.md', 'alpha source'),
  beta: a01Source('beta.md', 'beta source'),
  alphaEvidence: a01Evidence('evidence/alpha.json', 'alpha evidence'),
  betaEvidence: a01Evidence('evidence/beta.json', 'beta evidence'),
};
const a01Cases = [
  {
    id: 'dev-alpha', split: 'development', query: 'alpha', expected_ids: ['alpha'],
    documents: [{ id: 'alpha', text: 'Alpha procedure', related_ids: [], source_ref: a01Refs.alpha }, { id: 'beta', text: 'Beta correction', related_ids: [], source_ref: a01Refs.beta }],
    evidence_refs: [{ document_id: 'alpha', ref: a01Refs.alphaEvidence }],
  },
  {
    id: 'held-alpha-beta', split: 'held_out', query: 'alpha', expected_ids: ['alpha', 'beta'],
    documents: [{ id: 'alpha', text: 'Alpha incident', related_ids: ['beta'], source_ref: a01Refs.alpha }, { id: 'beta', text: 'Beta correction', related_ids: [], source_ref: a01Refs.beta }],
    evidence_refs: [{ document_id: 'alpha', ref: a01Refs.alphaEvidence }, { document_id: 'beta', ref: a01Refs.betaEvidence }],
  },
];
const a01EvidenceCatalog = Object.values(a01Refs);
const a01Baseline = sealPolicy({
  schema: POLICY_SCHEMA, policy_id: 'r8-baseline', version: 1, kind: 'baseline', label: 'R8 fixed baseline', scope: a01Scope,
  provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true }, authority: 'none', current_truth: false,
  safety: { authority: 'none', current_truth: false, max_results: 3, max_tokens: 512, max_depth: 2, max_cache_age_ms: 60_000, budget_unit: 'result-count-and-rendered-tokens' },
  parameters: { retrieval: { lexical_weight: 1, relationship_weight: 0, expansion_depth: 0 }, budget: { result_limit: 3, token_share: 1 }, cache: { enabled: false, max_age_ms: 0 } },
});
const a01Candidate = sealPolicy({
  schema: POLICY_SCHEMA, policy_id: 'r8-candidate', version: 1, kind: 'candidate', label: 'R8 candidate', parent_policy_sha256: a01Baseline.policy_sha256,
  scope: structuredClone(a01Scope), provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true }, authority: 'none', current_truth: false,
  safety: structuredClone(a01Baseline.policy.safety), parameters: { retrieval: { lexical_weight: 1, relationship_weight: 1, expansion_depth: 1 }, budget: { result_limit: 3, token_share: 1 }, cache: { enabled: false, max_age_ms: 0 } },
});

const a01Event = overrides => normalizeEvidenceEvent({
  scope: { scope_id: a01Scope.scope_id, source_snapshot_sha256: a01Scope.source_snapshot_digest },
  producer: { id: 'codex', kind: 'codex', version: '1' }, producer_event_id: 'a01-event-1', session_or_run_ref: 'a01-session',
  occurred_at: '2026-09-09T01:02:03.000Z', observed_at: '2026-09-09T01:02:04.000Z', event_kind: 'successful_procedure',
  source_snapshot_refs: [{ ...a01Refs.alpha, scope_id: a01Scope.scope_id }], outcome: 'success', smooth_positive: true, privacy_class: 'project', ...overrides,
});

test('R8 A01 telemetry is routing-only and held-out selection remains byte-equivalent', () => {
  const direct = evaluatePolicyExperiment({ baseline: a01Baseline, candidates: [a01Candidate], cases: a01Cases, evidence: a01EvidenceCatalog });
  const withTelemetry = evaluatePolicyWithTelemetry({ baseline: a01Baseline, candidates: [a01Candidate], cases: a01Cases, evidence: a01EvidenceCatalog, events: [a01Event(), a01Event({ event_id: 'a01-friction', producer_event_id: 'a01-friction', event_kind: 'retry_or_repair', outcome: 'failure', smooth_positive: false, friction: { tool_error_retry_count: 1 } })] });
  assert.equal(withTelemetry.schema, 'histos.retrieval-policy-experiment/v1');
  assert.equal(withTelemetry.telemetry.schema, A01_PROJECTION_SCHEMA);
  assert.deepEqual(stripTelemetry(withTelemetry), direct);
  assert.equal(withTelemetry.selection.policy_sha256, direct.selection.policy_sha256);
  assert.equal(withTelemetry.telemetry.authority, 'none');
  assert.equal(withTelemetry.telemetry.current_truth, false);
  assert.equal(withTelemetry.telemetry.route_counts.smooth_positive, 1);
  assert.equal(withTelemetry.telemetry.route_counts.friction, 1);
  assert.equal(withTelemetry.telemetry.events.every(item => item.authority === 'none' && item.current_truth === false), true);
});

test('R8 A01 telemetry rejects stale, out-of-scope and authority-mutating events', () => {
  assert.throws(() => evaluatePolicyWithTelemetry({ baseline: a01Baseline, cases: a01Cases, evidence: a01EvidenceCatalog, events: [a01Event({ scope: { scope_id: a01Scope.scope_id, source_snapshot_sha256: 'e'.repeat(64) } })] }), /EVENT_SNAPSHOT_MISMATCH/);
  assert.throws(() => evaluatePolicyWithTelemetry({ baseline: a01Baseline, cases: a01Cases, evidence: a01EvidenceCatalog, events: [a01Event({ source_snapshot_refs: [{ ...a01Refs.alpha, scope_id: 'other-project' }] })] }), /EVENT_REFERENCE_OUT_OF_SCOPE/);
  assert.throws(() => evaluatePolicyWithTelemetry({ baseline: a01Baseline, cases: a01Cases, evidence: a01EvidenceCatalog, events: [a01Event({ authority: 'system' })] }), /EVENT_AUTHORITY_MUTATION/);
});

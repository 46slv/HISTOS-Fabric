import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  installProfile,
  refreshProfile,
  startContextService,
} from '../service/context-service.mjs';
import { requestService } from '../service/service-client.mjs';
import {
  createEvidenceEventJournal,
  normalizeEvidenceEvent,
} from '../events/evidence-events.mjs';
import {
  createDistillationProvider,
  distillationDigest,
  runBoundedDistillation,
} from '../providers/distillation-provider.mjs';
import {
  KURA_READONLY_STORE_SCHEMA,
  KURA_UPSTREAM,
  createKuraReadOnlyProvider,
} from '../providers/kura-readonly-provider.mjs';
import {
  inspectSkillProjection,
  projectSkill,
  uninstallSkillProjection,
} from '../projection/skill-projection.mjs';
import {
  A01_PROJECTION_SCHEMA,
  evaluatePolicyWithTelemetry,
  projectOperationObservationEvents,
  stripTelemetry,
} from './telemetry-gates.mjs';
import {
  POLICY_SCHEMA,
  evaluatePolicyExperiment,
  sealPolicy,
} from '../policy/retrieval-policy-experiment.mjs';
import { createOperationSignature } from '../intelligence/operation-candidates.mjs';
import { buildSourceIndex, searchSourceIndex } from '../index/source-index.mjs';
import { compileContextCapsule } from '../context/context-compiler.mjs';
import {
  buildEphemeraObservationEvent,
  createEphemeraH05CompatibilityBridge,
  EPHEMERA_H05_COMPATIBILITY_SCHEMA,
  HISTOS_CONTEXT_CAPSULE_SCHEMA,
  HISTOS_MEMORY_RECALL_SCHEMA,
} from './ephemera-compatibility.mjs';

export const RECOVERY_SECURITY_SCHEMA = 'histos.recovery-security-regression/v1';

const AT = '2026-09-09T09:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function fail(code, detail = '') {
  throw new Error(`${code}${detail ? `:${detail}` : ''}`);
}

async function refusal(action, pattern, label) {
  try {
    await action();
  } catch (error) {
    if (!pattern.test(error?.message ?? '')) fail('EXPECTED_REFUSAL_MISMATCH', `${label}:${error?.message}`);
    return error.message;
  }
  fail('EXPECTED_REFUSAL_MISSING', label);
}

function refusalSync(action, pattern, label) {
  try {
    action();
  } catch (error) {
    if (!pattern.test(error?.message ?? '')) fail('EXPECTED_REFUSAL_MISMATCH', `${label}:${error?.message}`);
    return error.message;
  }
  fail('EXPECTED_REFUSAL_MISSING', label);
}

function expect(condition, code, detail = '') {
  if (!condition) fail(code, detail);
}

function eventFixture(overrides = {}) {
  return {
    scope: { scope_id: 'r10-events', source_snapshot_sha256: DIGEST_A },
    producer: { id: 'codex-r10', kind: 'codex', version: '1' },
    producer_event_id: 'r10-event-1',
    session_or_run_ref: 'r10-session',
    occurred_at: AT,
    observed_at: AT,
    event_kind: 'operation_observation',
    source_snapshot_refs: [{ kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 12 }],
    outcome: 'success',
    privacy_class: 'project',
    ...overrides,
  };
}

export async function probeServiceRecovery() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-r10-service-'));
  let service = null;
  try {
    const sourceRoot = path.join(root, 'source');
    const profileRoot = path.join(root, 'profile');
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, 'a.mjs'), 'export const alpha = 1;\n');
    const installed = await installProfile({ profileRoot, sourceRoot, scopeId: 'r10-service', paths: ['a.mjs'] });
    service = await startContextService({ profileRoot });
    const initial = await requestService({ profileRoot, operation: 'call', name: 'context_search', arguments: { ...installed.scope, query: 'alpha' }, client: 'r10-codex' });
    expect(initial.service.instance_id === service.instance_id, 'SERVICE_INITIAL_INSTANCE_MISMATCH');
    await writeFile(path.join(sourceRoot, 'a.mjs'), 'export const alpha = 2;\n');
    const stale = [];
    stale.push(await refusal(
      () => requestService({ profileRoot, operation: 'call', name: 'context_search', arguments: { ...installed.scope, query: 'alpha' } }),
      /SOURCE_STALE/u, 'context_search_source_drift',
    ));
    stale.push(await refusal(() => requestService({ profileRoot }), /SOURCE_STALE/u, 'health_source_drift'));
    const refreshed = await refreshProfile(profileRoot);
    const recovered = await requestService({ profileRoot, operation: 'call', name: 'context_search', arguments: { ...refreshed.scope, query: 'alpha' } });
    expect(recovered.scope.snapshot_digest === refreshed.scope.snapshot_digest, 'SERVICE_REFRESH_SCOPE_MISMATCH');
    await service.close();
    service = await startContextService({ profileRoot });
    const restarted = await requestService({ profileRoot });
    expect(restarted.status === 'healthy', 'SERVICE_RESTART_UNHEALTHY');
    expect(restarted.instance_id !== initial.service.instance_id, 'SERVICE_RESTART_INSTANCE_REUSED');
    return {
      status: 'PASS',
      initial_instance_id: initial.service.instance_id,
      restarted_instance_id: restarted.instance_id,
      stale_refusals: stale,
      refreshed_snapshot: refreshed.scope.snapshot_digest,
      recovered: true,
    };
  } finally {
    if (service) await service.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

export function probeEvidenceEventSecurity() {
  const scope = { scope_id: 'r10-events', source_snapshot_sha256: DIGEST_A };
  const journal = createEvidenceEventJournal({ scope });
  const raw = eventFixture();
  const normalized = normalizeEvidenceEvent(raw);
  const ingestInput = ({ schema: _schema, event_sha256: _hash, byte_size: _bytes, routing: _routing, independence: _independence, ...value }) => value;
  const first = journal.ingest(ingestInput(normalized));
  const duplicate = journal.ingest(ingestInput(normalized));
  expect(first.accepted === true && duplicate.duplicate === true, 'EVENT_DUPLICATE_NOT_IDEMPOTENT');
  const sameIdConflict = refusalSync(() => journal.ingest(ingestInput({ ...normalized, outcome: 'failure' })), /EVENT_ID_CONFLICT/u, 'event_same_id_conflict');

  const operationScope = { scope_id: 'r10-r8', source_snapshot_sha256: DIGEST_A };
  const signature = createOperationSignature({
    operation_id: 'r10-operation', name: 'r10-operation', version: '1', scope: operationScope,
    semantic_steps: ['read', 'verify'],
    input_contract: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false },
    output_contract: { type: 'object', required: ['status'], properties: { status: { enum: ['ok'] } }, additionalProperties: false },
  });
  const eventOperation = {
    operation_id: signature.operation_id, name: signature.name, version: signature.version,
    scope_id: operationScope.scope_id, source_snapshot_sha256: operationScope.source_snapshot_sha256,
    semantic_steps: [...signature.semantic_steps], input_contract: structuredClone(signature.input_contract), output_contract: structuredClone(signature.output_contract),
  };
  const operationEvent = overrides => normalizeEvidenceEvent(eventFixture({
    scope: operationScope,
    producer: { id: 'codex-r10', kind: 'codex', version: '1' },
    producer_event_id: 'r10-replay-source',
    session_or_run_ref: 'r10-r8-session',
    event_kind: 'operation_observation',
    operation_signature: eventOperation,
    source_snapshot_refs: [{ kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 12 }],
    ...overrides,
  }));
  const replayA = operationEvent({ event_id: 'r10-replay-a', outcome: 'success' });
  const replayB = operationEvent({ event_id: 'r10-replay-b', outcome: 'failure' });
  const replayConflict = refusalSync(() => projectOperationObservationEvents({ signature, events: [replayA, replayB] }), /R8_REPLAY_CONFLICT/u, 'event_replay_conflict');
  const stale = refusalSync(() => projectOperationObservationEvents({ signature, events: [operationEvent({ event_id: 'r10-stale', scope: { ...operationScope, source_snapshot_sha256: DIGEST_B } })] }), /EVENT_SNAPSHOT_MISMATCH|EVENT_OPERATION_STALE/u, 'event_stale_scope');
  const scopeRefusal = refusalSync(() => normalizeEvidenceEvent(eventFixture({ scope_id: 'other-scope', source_snapshot_refs: [{ kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 12 }] })), /EVENT_SCOPE_MISMATCH/u, 'event_scope_refusal');
  const secret = refusalSync(() => normalizeEvidenceEvent(eventFixture({ password: 'do-not-ingest' })), /EVENT_SECRET_PAYLOAD/u, 'event_secret_refusal');
  const authority = refusalSync(() => normalizeEvidenceEvent(eventFixture({ authority: 'mission' })), /EVENT_AUTHORITY_MUTATION/u, 'event_authority_refusal');
  return {
    status: 'PASS', accepted: first.accepted, duplicate: duplicate.duplicate,
    refusals: { same_id_conflict: sameIdConflict, replay_conflict: replayConflict, stale, scope: scopeRefusal, secret, authority },
  };
}

function distillationScope() {
  return { scope_id: 'r10-distill', snapshot_digest: DIGEST_A, paths: ['notes.md', 'test.txt'] };
}

function distillationCandidate(scope = distillationScope()) {
  return {
    candidate_id: 'r10-distilled-restart', scope, kind: 'semantic', title: 'Restart continuity',
    summary: 'The local service resumes committed state.', details: 'Reviewed evidence says the local service resumes committed state.', confidence: 0.5,
    references: [
      { kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 1, lineage_id: 'r10-source', provenance_kind: 'source' },
      { kind: 'evidence', path: 'test.txt', sha256: DIGEST_B, bytes: 1, lineage_id: 'r10-test', provenance_kind: 'independent_test' },
    ],
    lineage: ['r10-source', 'r10-test'],
    grounding_receipts: [{ provider_id: 'r10-fixture', provider_version: 'v1', surviving_quotes: ['resumes committed state'], evidence_refs: [{ path: 'notes.md' }] }],
  };
}

export async function probeProviderRecovery() {
  const scope = distillationScope();
  const failed = await createDistillationProvider({ scope, generate: async () => { throw new Error('R10_LOCAL_PROVIDER_DOWN'); } }).distill({ scope, inputs: [{ id: 'r10-failure' }] });
  expect(failed.refusals[0]?.code === 'DISTILLATION_PROVIDER_FAILURE', 'DISTILLATION_FAILURE_NOT_BOUNDED');
  const limited = await createDistillationProvider({ scope, budget: { max_calls: 0 }, generate: async () => [distillationCandidate(scope)] }).distill({ scope, inputs: [{ id: 'r10-rate' }] });
  expect(limited.refusals[0]?.code === 'DISTILLATION_RATE_LIMIT', 'DISTILLATION_RATE_NOT_BOUNDED');
  const costly = await createDistillationProvider({ scope, budget: { max_cost_units: 1 }, generate: async () => ({ candidates: [distillationCandidate(scope)], cost_units: 2 }) }).distill({ scope, inputs: [{ id: 'r10-cost' }] });
  expect(costly.refusals[0]?.code === 'DISTILLATION_COST_EXHAUSTED', 'DISTILLATION_COST_NOT_BOUNDED');

  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-r10-sleep-'));
  try {
    const request = distillationCandidate(scope);
    const requests = new Map([['r10-distilled-restart', { inputs: [{ id: 'r10-scheduled' }] }]]);
    const event = { id: 'r10-scheduled', resource_id: 'r10-distilled-restart', fingerprint: distillationDigest({ request }), declared_bytes: 128 };
    let attempts = 0;
    const firstProvider = createDistillationProvider({ scope, generate: async () => { attempts += 1; if (attempts === 1) throw new Error('R10_TEMPORARY_FAILURE'); return [request]; } });
    const first = await runBoundedDistillation({ root, scopeId: scope.scope_id, scope, provider: firstProvider, events: [event], requests });
    expect(first.receipt.failed === 1 && first.receipt.pending === 1, 'H04_INITIAL_RETRY_STATE_INVALID');
    const second = await runBoundedDistillation({ root, scopeId: scope.scope_id, scope, provider: firstProvider, events: [event], requests });
    expect(second.enqueued.duplicates === 1 && second.receipt.processed === 1 && second.state.usable_candidates.length === 1, 'H04_RETRY_COALESCE_INVALID');
    const restartedProvider = createDistillationProvider({ scope, generate: async () => [request] });
    const restarted = await runBoundedDistillation({ root, scopeId: scope.scope_id, scope, provider: restartedProvider, events: [event], requests });
    expect(restarted.enqueued.duplicates === 1 && restarted.state.usable_candidates.length === 1, 'H04_RESTART_REPLAY_INVALID');
    return { status: 'PASS', provider_refusals: [failed.refusals[0].code, limited.refusals[0].code, costly.refusals[0].code], retry: first.receipt, coalesce: second.enqueued, restart: restarted.enqueued };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function probeKuraRecovery() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-r10-kura-'));
  try {
    const scope = { scope_id: 'r10-kura', snapshot_digest: DIGEST_A, paths: ['notes.md'] };
    const store = {
      schema: KURA_READONLY_STORE_SCHEMA, store_id: 'r10-store', scope, snapshot_digest: DIGEST_A, revision: 'r10-r1',
      memories: [{ slug: 'restart', title: 'Restart state', body: 'The service resumes committed state.', tags: ['restart'], evidence: [{ kind: 'source', path: 'notes.md', quote: 'resumes committed state', snapshot_digest: DIGEST_A }] }],
    };
    const storePath = path.join(root, 'store.json');
    await writeFile(storePath, JSON.stringify(store, null, 2));
    const before = await readFile(storePath, 'utf8');
    const provider = createKuraReadOnlyProvider({ storePath, storeId: 'r10-store', scope, upstream: KURA_UPSTREAM });
    const recall = await provider.recall({ scope, query: 'restart state' });
    expect(recall.records.length === 1 && recall.authority === 'none' && recall.current_truth === false, 'KURA_RECALL_BOUNDARY_INVALID');
    const write = await refusal(() => provider.invoke('remember', { scope, slug: 'forbidden', body: 'must not write' }), /KURA_READ_ONLY_WRITE_REJECTED/u, 'kura_write_refusal');
    const admin = await refusal(() => provider.invoke('admin', { scope }), /KURA_READ_ONLY_WRITE_REJECTED/u, 'kura_admin_refusal');
    const after = await readFile(storePath, 'utf8');
    expect(after === before, 'KURA_STORE_MUTATED');
    const refreshedStore = structuredClone(store);
    refreshedStore.snapshot_digest = DIGEST_B;
    refreshedStore.scope = { ...scope, snapshot_digest: DIGEST_B };
    refreshedStore.memories[0].evidence[0].snapshot_digest = DIGEST_B;
    await writeFile(storePath, JSON.stringify(refreshedStore, null, 2));
    const stale = await refusal(() => provider.recall({ scope, query: 'restart' }), /KURA_STALE_STORE_SNAPSHOT|KURA_SCOPE_SNAPSHOT_MISMATCH/u, 'kura_stale_refusal');
    const fresh = createKuraReadOnlyProvider({ storePath, storeId: 'r10-store', scope: { ...scope, snapshot_digest: DIGEST_B }, upstream: KURA_UPSTREAM });
    const refreshed = await fresh.recall({ scope: { ...scope, snapshot_digest: DIGEST_B }, query: 'restart' });
    expect(refreshed.snapshot_digest === DIGEST_B, 'KURA_REFRESH_FAILED');
    return { status: 'PASS', write, admin, stale, raw_store_unchanged: true, refreshed_snapshot: refreshed.snapshot_digest };
  } finally { await rm(root, { recursive: true, force: true }); }
}

function skillRevision(id = 'r10-v1', body = null) {
  return {
    name: 'r10-recovery-skill', description: 'Bounded recovery procedure.', body: body ?? '# Recovery\n\n1. Reopen exact evidence before acting.',
    source_revision: { id }, review_status: 'accepted', evidence_refs: [{ id: 'r10-review', sha256: DIGEST_A }],
  };
}

export async function probeSkillRecovery() {
  const project = await mkdtemp(path.join(os.tmpdir(), 'histos-r10-skill-'));
  try {
    const destination = path.join(project, '.agents', 'skills');
    const initial = await projectSkill({ procedure: skillRevision(), target: 'codex', projectRoot: project, destinationRoot: destination });
    const updated = await projectSkill({ procedure: skillRevision('r10-v2', `${skillRevision().body}\n\n2. Report stale evidence.`), target: 'codex', projectRoot: project, destinationRoot: destination, mode: 'update', expectedProjectionId: initial.projection_id, expectedSourceRevision: 'r10-v1' });
    const documentPath = path.join(destination, 'r10-recovery-skill', 'SKILL.md');
    await writeFile(documentPath, `${await readFile(documentPath, 'utf8')}\nuser drift\n`);
    const cas = await refusal(() => projectSkill({ procedure: skillRevision('r10-v3'), target: 'codex', projectRoot: project, destinationRoot: destination, mode: 'update', expectedProjectionId: updated.projection_id }), /PROJECTION_DRIFT_CONFLICT/u, 'skill_cas_drift');
    const outside = path.join(path.dirname(project), `${path.basename(project)}-outside`);
    const pathRefusal = await refusal(() => projectSkill({ procedure: skillRevision(), target: 'codex', projectRoot: project, destinationRoot: outside }), /PROJECTION_DESTINATION_OUT_OF_SCOPE/u, 'skill_path_scope');
    const ownershipDestination = path.join(project, '.agents', 'ownership-skills');
    const owned = await projectSkill({ procedure: skillRevision(), target: 'opencode', projectRoot: project, destinationRoot: ownershipDestination });
    await writeFile(path.join(ownershipDestination, 'r10-recovery-skill', 'user.md'), 'unowned');
    const ownership = await refusal(() => uninstallSkillProjection({ projectRoot: project, destinationRoot: ownershipDestination, skillName: 'r10-recovery-skill', expectedProjectionId: owned.projection_id }), /PROJECTION_UNOWNED_FILE/u, 'skill_ownership');
    await rm(path.join(ownershipDestination, 'r10-recovery-skill', 'user.md'));
    const removed = await uninstallSkillProjection({ projectRoot: project, destinationRoot: ownershipDestination, skillName: 'r10-recovery-skill', expectedProjectionId: owned.projection_id });
    expect(removed.removed.includes('SKILL.md'), 'SKILL_UNINSTALL_NOT_OWNED');
    const readback = await refusal(() => inspectSkillProjection({ projectRoot: project, destinationRoot: ownershipDestination, skillName: 'r10-recovery-skill' }), /PROJECTION_SKILL_NOT_FOUND|ENOENT/u, 'skill_uninstall_readback');
    return { status: 'PASS', cas, path_scope: pathRefusal, ownership, readback, updated_revision: updated.source_revision };
  } finally { await rm(project, { recursive: true, force: true }); }
}

function telemetryFixture() {
  const scope = { scope_id: 'r10-a01', source_snapshot_digest: DIGEST_A, source_paths: ['alpha.md'], evidence_paths: ['evidence/alpha.json'] };
  const source = { kind: 'source', path: 'alpha.md', sha256: sha256('alpha source'), bytes: 12 };
  const evidence = { kind: 'evidence', path: 'evidence/alpha.json', sha256: sha256('alpha evidence'), bytes: 14 };
  const baseline = sealPolicy({ schema: POLICY_SCHEMA, policy_id: 'r10-baseline', version: 1, kind: 'baseline', label: 'R10 baseline', scope,
    provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true }, authority: 'none', current_truth: false,
    safety: { authority: 'none', current_truth: false, max_results: 3, max_tokens: 512, max_depth: 2, max_cache_age_ms: 60_000, budget_unit: 'result-count-and-rendered-tokens' },
    parameters: { retrieval: { lexical_weight: 1, relationship_weight: 0, expansion_depth: 0 }, budget: { result_limit: 3, token_share: 1 }, cache: { enabled: false, max_age_ms: 0 } } });
  const candidate = sealPolicy({ schema: POLICY_SCHEMA, policy_id: 'r10-candidate', version: 1, kind: 'candidate', label: 'R10 candidate', parent_policy_sha256: baseline.policy_sha256,
    scope: structuredClone(scope), provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true }, authority: 'none', current_truth: false,
    safety: structuredClone(baseline.policy.safety), parameters: { retrieval: { lexical_weight: 1, relationship_weight: 1, expansion_depth: 1 }, budget: { result_limit: 3, token_share: 1 }, cache: { enabled: false, max_age_ms: 0 } } });
  const cases = [{ id: 'r10-held', split: 'held_out', query: 'alpha', expected_ids: ['alpha'], documents: [{ id: 'alpha', text: 'Alpha procedure', related_ids: [], source_ref: source }], evidence_refs: [{ document_id: 'alpha', ref: evidence }] }];
  const operationScope = { scope_id: 'r10-a00', source_snapshot_sha256: DIGEST_A };
  const signature = createOperationSignature({ operation_id: 'r10-recovery', name: 'r10-recovery', version: '1', scope: operationScope, semantic_steps: ['read', 'verify'], input_contract: { type: 'object' }, output_contract: { type: 'object' } });
  const eventOperation = { operation_id: signature.operation_id, name: signature.name, version: signature.version, scope_id: operationScope.scope_id, source_snapshot_sha256: operationScope.source_snapshot_sha256, semantic_steps: [...signature.semantic_steps], input_contract: structuredClone(signature.input_contract), output_contract: structuredClone(signature.output_contract) };
  const event = overrides => normalizeEvidenceEvent({ scope: operationScope, producer: { id: 'codex-r10', kind: 'codex', version: '1' }, producer_event_id: 'r10-a00-event', session_or_run_ref: 'r10-a00-session', occurred_at: AT, observed_at: AT, event_kind: 'operation_observation', operation_signature: eventOperation, source_snapshot_refs: [{ kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 12 }], outcome: 'success', privacy_class: 'project', ...overrides });
  return { scope, source, evidence, baseline, candidate, cases, event, signature, operationScope };
}

export function probeTelemetryRecovery() {
  const f = telemetryFixture();
  const first = f.event({ event_id: 'r10-a00-1' });
  const projection = projectOperationObservationEvents({ signature: f.signature, events: [first, structuredClone(first)] });
  expect(projection.candidate.metrics.occurrence_count === 1 && projection.candidate.activation.authorized === false, 'A00_REPLAY_OR_ACTIVATION_GATE_INVALID');
  const stale = refusalSync(() => projectOperationObservationEvents({ signature: f.signature, events: [f.event({ event_id: 'r10-a00-stale', scope: { ...f.operationScope, source_snapshot_sha256: DIGEST_B } })] }), /EVENT_SNAPSHOT_MISMATCH|EVENT_OPERATION_STALE/u, 'a00_stale');
  const scope = refusalSync(() => projectOperationObservationEvents({ signature: f.signature, events: [f.event({ event_id: 'r10-a00-scope', source_snapshot_refs: [{ kind: 'source', path: 'notes.md', sha256: DIGEST_A, bytes: 12, scope_id: 'other' }] })] }), /EVENT_REFERENCE_OUT_OF_SCOPE/u, 'a00_scope');
  const authority = refusalSync(() => projectOperationObservationEvents({ signature: f.signature, events: [f.event({ event_id: 'r10-a00-authority', authority: 'system' })] }), /EVENT_AUTHORITY_MUTATION/u, 'a00_authority');
  const direct = evaluatePolicyExperiment({ baseline: f.baseline, candidates: [f.candidate], cases: f.cases, evidence: [f.source, f.evidence] });
  const withTelemetry = evaluatePolicyWithTelemetry({ baseline: f.baseline, candidates: [f.candidate], cases: f.cases, evidence: [f.source, f.evidence], events: [normalizeEvidenceEvent({ scope: { scope_id: f.scope.scope_id, source_snapshot_sha256: f.scope.source_snapshot_digest }, producer: { id: 'codex-r10', kind: 'codex', version: '1' }, producer_event_id: 'r10-a01-event', session_or_run_ref: 'r10-a01-session', occurred_at: AT, observed_at: AT, event_kind: 'successful_procedure', source_snapshot_refs: [f.source], outcome: 'success', smooth_positive: true, privacy_class: 'project' })] });
  expect(JSON.stringify(stripTelemetry(withTelemetry)) === JSON.stringify(direct), 'A01_TELEMETRY_CHANGED_POLICY_BYTES');
  expect(withTelemetry.telemetry.schema === A01_PROJECTION_SCHEMA && withTelemetry.telemetry.authority === 'none' && withTelemetry.telemetry.current_truth === false, 'A01_TELEMETRY_BOUNDARY_INVALID');
  return { status: 'PASS', a00: { duplicate_collapsed: true, stale, scope, authority }, a01: { byte_equivalent: true, schema: withTelemetry.telemetry.schema, route_counts: withTelemetry.telemetry.route_counts } };
}

export async function probeEphemeraRecovery() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-r10-h05-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const indexRoot = path.join(root, 'index');
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(path.join(sourceRoot, 'a.mjs'), 'export const alpha = 1;\n');
    const { index } = await buildSourceIndex({ root: sourceRoot, indexRoot, scopeId: 'r10-h05', paths: ['a.mjs'] });
    const source = index.sources[0];
    const evidenceBytes = Buffer.from('r10 evidence\n');
    const evidence = { kind: 'evidence', path: 'evidence.json', sha256: sha256(evidenceBytes), bytes: evidenceBytes.length, scope_id: 'r10-h05', snapshot_digest: index.scope.snapshot_digest };
    const scope = { scope_id: 'r10-h05', snapshot_digest: index.scope.snapshot_digest, paths: ['a.mjs'], source_paths: ['a.mjs'], evidence_paths: ['evidence.json'] };
    const truth = [{ kind: 'fresh-source-bytes', path: 'a.mjs', sha256: source.sha256, bytes: source.bytes, scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest }];
    const search = searchSourceIndex({ index, query: 'alpha', scope: { scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest, paths: ['a.mjs'] } });
    const candidate = search.candidates[0];
    const memory = { schema: HISTOS_MEMORY_RECALL_SCHEMA, version: 0, scope: { scope_id: scope.scope_id, source_paths: ['a.mjs'], evidence_paths: ['evidence.json'] }, query: 'alpha', current_truth_refs: truth, authority_boundary: 'Memory is historical scoped data.', records: [], refusals: [], supersessions: [] };
    const rolePolicy = { role: 'r10-implementer', allowed_paths: ['a.mjs'], allowed_evidence_paths: ['evidence.json'], allowed_memory_kinds: ['procedure'], allowed_memory_ids: [], max_tokens: 2_000, max_memory_records: 4, allow_candidates: false, allow_current_truth: true };
    const calls = { transition: 0 };
    const bridge = createEphemeraH05CompatibilityBridge({
      read_memory: async () => structuredClone(memory),
      compile_context: async request => compileContextCapsule({ sourceRoot, index, goal: request.goal, scope: request.scope, sourceMap: [{ path: source.path, sha256: source.sha256, bytes: source.bytes }], candidates: [candidate], maxTokens: request.max_tokens, currentTruthRefs: request.current_truth_refs, evidenceRefs: [evidence], memory: request.memory }),
      mission_transition: async () => { calls.transition += 1; },
    });
    const result = await bridge.materialize({ scope, current_truth_refs: truth, role_policy: rolePolicy, goal: 'find alpha', query: 'alpha' }, { event: { session_or_run_ref: 'r10-h05-run', occurred_at: AT, observed_at: AT } });
    expect(result.schema === EPHEMERA_H05_COMPATIBILITY_SCHEMA && result.context.schema === HISTOS_CONTEXT_CAPSULE_SCHEMA && result.memory.length === 0, 'H05_RESULT_CONTRACT_INVALID');
    expect(result.authority === 'none' && result.current_truth === false && result.mission_transition === 'NOT_REQUESTED' && calls.transition === 0, 'H05_MISSION_BOUNDARY_INVALID');
    const stale = await refusal(() => bridge.materialize({ scope: { ...scope, snapshot_digest: DIGEST_B }, current_truth_refs: truth, role_policy: rolePolicy, goal: 'find alpha', query: 'alpha' }), /STALE_SCOPE|SCOPE_MISMATCH/u, 'h05_stale_scope');
    const authority = await refusal(() => bridge.materialize({ scope, current_truth_refs: truth, role_policy: rolePolicy, goal: 'find alpha', query: 'alpha' }, { event: { session_or_run_ref: 'r10-h05-authority', occurred_at: AT, observed_at: AT, authority: 'mission' } }), /EVENT_AUTHORITY_MUTATION/u, 'h05_authority');
    const transition = await refusal(() => buildEphemeraObservationEvent({ scope, current_truth_refs: truth, evidence_refs: result.evidence_refs, event: { session_or_run_ref: 'r10-h05-transition', occurred_at: AT, observed_at: AT, event_kind: 'mission_transition' } }), /EVENT_KIND_MISMATCH/u, 'h05_transition');
    return { status: 'PASS', schema: result.schema, stale, authority, transition, transition_calls: calls.transition };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function runRecoverySecurityRegression() {
  const probes = {
    service: await probeServiceRecovery(),
    events: probeEvidenceEventSecurity(),
    providers: await probeProviderRecovery(),
    kura: await probeKuraRecovery(),
    skill: await probeSkillRecovery(),
    telemetry: probeTelemetryRecovery(),
    ephemera: await probeEphemeraRecovery(),
  };
  expect(Object.values(probes).every(probe => probe.status === 'PASS'), 'R10_PROBE_NOT_PASS');
  return { schema: RECOVERY_SECURITY_SCHEMA, status: 'PASS', probes };
}

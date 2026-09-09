import { createHash } from 'node:crypto';

/**
 * Phase 10's generic repeated-work boundary.
 *
 * This module is deliberately a pure, file-free evidence transformer.  It
 * produces a candidate read model; it does not persist memory, change a
 * Mission, spend a provider budget, or activate a Tool/Skill/Automation.
 */

export const OPERATION_SIGNATURE_SCHEMA = 'histos.operation-signature/v1';
export const OPERATION_CANDIDATE_SCHEMA = 'histos.operation-candidate/v1';
export const SHADOW_RESULT_SCHEMA = 'histos.operation-shadow/v1';
export const SELECTION_SCHEMA = 'histos.operation-selection/v1';
export const ROLLBACK_SCHEMA = 'histos.operation-rollback/v1';
export const LIFECYCLE = Object.freeze(['OBSERVED', 'REPEATED', 'CANDIDATE', 'SHADOW', 'VERIFIED']);

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSITIONS = Object.freeze({
  OBSERVED: 'REPEATED',
  REPEATED: 'CANDIDATE',
  CANDIDATE: 'SHADOW',
  SHADOW: 'VERIFIED',
});
const INDEPENDENT_PROVENANCE = new Set(['independent_test', 'source', 'runtime_observation', 'immutable_receipt']);
const RESERVED_CONTROL_KEYS = new Set(['authority', 'current_truth', 'activation', 'budget', 'safety', 'completion', 'mission_state']);

const fail = code => { throw new Error(code); };

// Canonical JSON is intentionally small and deterministic.  Candidate hashes
// never include wall-clock timestamps, PIDs, random IDs, or executable code.
export function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_FINITE_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  fail('NON_JSON_VALUE');
}

export function digest(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function assertId(value, code = 'INVALID_ID') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code);
  return value;
}

function assertHash(value, code = 'INVALID_SHA256') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function assertInteger(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function scopeFrom(input = {}) {
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : input;
  const scope_id = scope.scope_id ?? scope.scopeId;
  const source_snapshot_sha256 = scope.source_snapshot_sha256 ?? scope.snapshot_sha256 ?? scope.snapshot_digest;
  assertId(scope_id, 'SCOPE_ID_REQUIRED');
  assertHash(source_snapshot_sha256, 'SOURCE_SNAPSHOT_REQUIRED');
  return { scope_id, source_snapshot_sha256 };
}

function stableContract(contract, code = 'IO_CONTRACT_REQUIRED') {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) fail(code);
  // Make sure the contract is JSON-safe and bounded before it is hashed.
  const text = canonical(contract);
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) fail('IO_CONTRACT_OVERSIZED');
  return clone(contract);
}

function normalizeAbstention(abstention) {
  if (!abstention || typeof abstention !== 'object' || Array.isArray(abstention)) fail('ABSTENTION_CONTRACT_REQUIRED');
  if (abstention.allowed !== true || abstention.on_unknown !== 'ABSTAIN') fail('ABSTENTION_CONTRACT_UNSAFE');
  const reasons = abstention.reason_codes;
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.length > 64 ||
      reasons.some(reason => typeof reason !== 'string' || !ID.test(reason))) fail('ABSTENTION_REASON_CODES_INVALID');
  return { allowed: true, on_unknown: 'ABSTAIN', reason_codes: [...new Set(reasons)].sort(),
    output_schema: stableContract(abstention.output_schema ?? { type: 'object', required: ['kind', 'reason_code'] }) };
}

function normalizeSignature(signature) {
  if (!signature || signature.schema !== OPERATION_SIGNATURE_SCHEMA) fail('OPERATION_SIGNATURE_INVALID');
  const scope = scopeFrom(signature);
  assertId(signature.operation_id, 'OPERATION_ID_REQUIRED');
  assertId(signature.name, 'OPERATION_NAME_REQUIRED');
  assertId(signature.version, 'OPERATION_VERSION_REQUIRED');
  const input_contract = stableContract(signature.input_contract);
  const output_contract = stableContract(signature.output_contract);
  const normalized = {
    schema: OPERATION_SIGNATURE_SCHEMA,
    operation_id: signature.operation_id,
    name: signature.name,
    version: signature.version,
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    semantic_steps: Array.isArray(signature.semantic_steps) && signature.semantic_steps.length
      ? signature.semantic_steps.map(step => assertId(step, 'SEMANTIC_STEP_INVALID'))
      : ['operation'],
    input_contract,
    output_contract,
  };
  const expected = digest(normalized);
  if (signature.signature_sha256 !== undefined && signature.signature_sha256 !== expected) fail('OPERATION_SIGNATURE_FORGED');
  return { ...normalized, signature_sha256: expected };
}

/** Build a stable semantic operation signature from source-owned labels. */
export function createOperationSignature({
  operation_id,
  name,
  version = '1',
  scope,
  scope_id,
  source_snapshot_sha256,
  semantic_steps = ['operation'],
  input_contract,
  output_contract,
}) {
  const resolvedScope = scopeFrom({ scope, scope_id, source_snapshot_sha256 });
  assertId(name, 'OPERATION_NAME_REQUIRED');
  assertId(version, 'OPERATION_VERSION_REQUIRED');
  const normalized = {
    schema: OPERATION_SIGNATURE_SCHEMA,
    operation_id: assertId(operation_id ?? `${name}@${version}`, 'OPERATION_ID_REQUIRED'),
    name,
    version,
    scope_id: resolvedScope.scope_id,
    source_snapshot_sha256: resolvedScope.source_snapshot_sha256,
    semantic_steps: Array.isArray(semantic_steps) && semantic_steps.length
      ? semantic_steps.map(step => assertId(step, 'SEMANTIC_STEP_INVALID'))
      : ['operation'],
    input_contract: stableContract(input_contract),
    output_contract: stableContract(output_contract),
  };
  return { ...normalized, signature_sha256: digest(normalized) };
}

function normalizeEvidence(evidence, scope, { required = true } = {}) {
  if (evidence === undefined || evidence === null) {
    if (required) fail('EVIDENCE_REQUIRED');
    return null;
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('EVIDENCE_INVALID');
  const evidenceScope = scopeFrom({ scope_id: evidence.scope_id, source_snapshot_sha256: evidence.source_snapshot_sha256 ?? evidence.snapshot_sha256 });
  if (evidenceScope.scope_id !== scope.scope_id) fail('EVIDENCE_OUT_OF_SCOPE');
  if (evidenceScope.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('EVIDENCE_STALE');
  if (evidence.state !== undefined && evidence.state !== 'fresh') fail('EVIDENCE_STALE');
  if (evidence.authority !== undefined && evidence.authority !== 'none') fail('EVIDENCE_AUTHORITY_UNSAFE');
  if (evidence.current_truth !== undefined && evidence.current_truth !== false) fail('EVIDENCE_CURRENT_TRUTH_UNSAFE');
  const refs = evidence.references ?? evidence.refs ?? [];
  if (!Array.isArray(refs) || refs.length > 128) fail('EVIDENCE_REFERENCES_INVALID');
  const normalizedRefs = refs.map(ref => {
    if (!ref || !['source', 'evidence'].includes(ref.kind) || typeof ref.path !== 'string' || !ref.path ||
        ref.path.startsWith('/') || ref.path.includes('\\') || /^[A-Za-z]:[\\/]/.test(ref.path) || ref.path.startsWith('\\\\') ||
        ref.path.includes('..') || !HASH.test(ref.sha256 ?? '') ||
        !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > 16 * 1024 * 1024) fail('EVIDENCE_REFERENCE_INVALID');
    if (ref.scope_id !== undefined && ref.scope_id !== scope.scope_id) fail('EVIDENCE_OUT_OF_SCOPE');
    if (ref.source_snapshot_sha256 !== undefined && ref.source_snapshot_sha256 !== scope.source_snapshot_sha256) fail('EVIDENCE_STALE');
    return { kind: ref.kind, path: ref.path, sha256: ref.sha256, bytes: ref.bytes,
      ...(ref.start_line === undefined ? {} : { start_line: assertInteger(ref.start_line, 1, 1_000_000, 'EVIDENCE_RANGE_INVALID') }),
      ...(ref.end_line === undefined ? {} : { end_line: assertInteger(ref.end_line, 1, 1_000_000, 'EVIDENCE_RANGE_INVALID') }) };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const kind = evidence.kind ?? 'independent_test';
  if (!INDEPENDENT_PROVENANCE.has(kind)) fail('EVIDENCE_PROVENANCE_UNSUPPORTED');
  const result = {
    evidence_id: assertId(evidence.evidence_id ?? `evidence-${digest({ scope, refs: normalizedRefs, kind }).slice(0, 24)}`, 'EVIDENCE_ID_INVALID'),
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    state: 'fresh',
    kind,
    references: normalizedRefs,
  };
  const suppliedDigest = evidence.evidence_sha256 ?? evidence.digest;
  const expectedDigest = digest(result);
  if (suppliedDigest !== undefined && suppliedDigest !== expectedDigest) fail('EVIDENCE_FORGED');
  return { ...result, evidence_sha256: expectedDigest };
}

function normalizeSequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0 || sequence.length > 256 ||
      sequence.some(step => typeof step !== 'string' || !ID.test(step))) fail('OBSERVATION_SEQUENCE_INVALID');
  return [...sequence];
}

function normalizeCost(cost = {}) {
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) fail('OBSERVATION_COST_INVALID');
  return {
    model_calls: assertInteger(cost.model_calls ?? 0, 0, 1_000_000, 'MODEL_CALL_COST_INVALID'),
    tool_calls: assertInteger(cost.tool_calls ?? 0, 0, 1_000_000, 'TOOL_CALL_COST_INVALID'),
    tokens: assertInteger(cost.tokens ?? 0, 0, 1_000_000_000, 'TOKEN_COST_INVALID'),
    elapsed_ms: assertInteger(cost.elapsed_ms ?? 0, 0, 86_400_000, 'ELAPSED_COST_INVALID'),
  };
}

function normalizeObservation(observation, signature, index) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) fail('OBSERVATION_INVALID');
  if (observation.signature_sha256 !== undefined && observation.signature_sha256 !== signature.signature_sha256) fail('OBSERVATION_SIGNATURE_MISMATCH');
  const scope = scopeFrom({ scope_id: observation.scope_id ?? signature.scope_id, source_snapshot_sha256: observation.source_snapshot_sha256 ?? signature.source_snapshot_sha256 });
  if (scope.scope_id !== signature.scope_id) fail('OBSERVATION_OUT_OF_SCOPE');
  if (scope.source_snapshot_sha256 !== signature.source_snapshot_sha256) fail('OBSERVATION_STALE');
  const sequence = normalizeSequence(observation.sequence ?? signature.semantic_steps);
  const outcome = observation.outcome ?? observation.result ?? (observation.success === false ? 'failure' : 'success');
  if (!['success', 'failure', 'abstain'].includes(outcome)) fail('OBSERVATION_OUTCOME_INVALID');
  const input_contract_sha256 = observation.input_contract_sha256 ?? digest(signature.input_contract);
  const output_contract_sha256 = observation.output_contract_sha256 ?? digest(signature.output_contract);
  assertHash(input_contract_sha256, 'OBSERVATION_INPUT_CONTRACT_INVALID');
  assertHash(output_contract_sha256, 'OBSERVATION_OUTPUT_CONTRACT_INVALID');
  const input_sha256 = observation.input_sha256 ?? digest(observation.input === undefined ? null : observation.input);
  const output_sha256 = observation.output_sha256 ?? digest(observation.output === undefined ? null : observation.output);
  assertHash(input_sha256, 'OBSERVATION_INPUT_INVALID');
  assertHash(output_sha256, 'OBSERVATION_OUTPUT_INVALID');
  const evidence = observation.evidence === undefined ? [] : (Array.isArray(observation.evidence) ? observation.evidence : [observation.evidence]);
  const normalizedEvidence = evidence.map(item => normalizeEvidence(item, signature, { required: true }));
  const repair_iterations = assertInteger(observation.repair_iterations ?? 0, 0, 1_000_000, 'REPAIR_ITERATIONS_INVALID');
  const normalized = {
    observation_id: assertId(observation.observation_id ?? `observation-${index + 1}`, 'OBSERVATION_ID_INVALID'),
    signature_sha256: signature.signature_sha256,
    scope_id: signature.scope_id,
    source_snapshot_sha256: signature.source_snapshot_sha256,
    sequence,
    sequence_sha256: digest(sequence),
    input_contract_sha256,
    output_contract_sha256,
    input_sha256,
    output_sha256,
    outcome,
    repair_iterations,
    failure_code: observation.failure_code === undefined || observation.failure_code === null ? null : assertId(observation.failure_code, 'FAILURE_CODE_INVALID'),
    cost: normalizeCost(observation.cost),
    evidence: normalizedEvidence.sort((a, b) => a.evidence_sha256.localeCompare(b.evidence_sha256)),
  };
  return normalized;
}

function deriveMetrics(observations, signature) {
  const counts = (values) => {
    const map = new Map();
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
    return [...map.values()].sort((a, b) => b - a)[0] ?? 0;
  };
  const n = observations.length;
  const model_calls = observations.reduce((sum, item) => sum + item.cost.model_calls, 0);
  const tool_calls = observations.reduce((sum, item) => sum + item.cost.tool_calls, 0);
  const tokens = observations.reduce((sum, item) => sum + item.cost.tokens, 0);
  const elapsed_ms = observations.reduce((sum, item) => sum + item.cost.elapsed_ms, 0);
  const stable_io_contract = observations.every(item => item.input_contract_sha256 === digest(signature.input_contract) && item.output_contract_sha256 === digest(signature.output_contract));
  return {
    occurrence_count: n,
    stable_sequence_ratio: counts(observations.map(item => item.sequence_sha256)) / n,
    repair_iterations: observations.reduce((sum, item) => sum + item.repair_iterations, 0),
    failure_frequency: observations.filter(item => item.outcome === 'failure').length / n,
    repeated_model_tool_cost: {
      model_calls,
      tool_calls,
      tokens,
      elapsed_ms,
      per_occurrence: { model_calls: model_calls / n, tool_calls: tool_calls / n, tokens: tokens / n, elapsed_ms: elapsed_ms / n },
    },
    stable_io_ratio: counts(observations.map(item => digest({ input: item.input_contract_sha256, output: item.output_contract_sha256 }))) / n,
    stable_io_contract,
    deterministic_verifier_available: false,
  };
}

function normalizeCounterexample(item, scope, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('COUNTEREXAMPLE_INVALID');
  const evidence = normalizeEvidence(item.evidence, scope, { required: true });
  const input_sha256 = item.input_sha256 ?? digest(item.input === undefined ? null : item.input);
  assertHash(input_sha256, 'COUNTEREXAMPLE_INPUT_INVALID');
  const expected = item.expected;
  if (!expected || typeof expected !== 'object' || !['output', 'abstain'].includes(expected.kind)) fail('COUNTEREXAMPLE_EXPECTATION_INVALID');
  if (expected.kind === 'abstain') {
    if (typeof expected.reason_code !== 'string' || !ID.test(expected.reason_code)) fail('COUNTEREXAMPLE_REASON_INVALID');
  } else assertHash(expected.output_sha256 ?? digest(expected.output === undefined ? null : expected.output), 'COUNTEREXAMPLE_OUTPUT_INVALID');
  return {
    counterexample_id: assertId(item.counterexample_id ?? `counterexample-${index + 1}`, 'COUNTEREXAMPLE_ID_INVALID'),
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    input_sha256,
    expected: expected.kind === 'abstain'
      ? { kind: 'abstain', reason_code: expected.reason_code }
      : { kind: 'output', output_sha256: expected.output_sha256 ?? digest(expected.output === undefined ? null : expected.output) },
    evidence,
  };
}

function candidateBody(candidate) {
  const { candidate_sha256: _ignored, ...body } = candidate;
  return body;
}

function sealCandidate(candidate) {
  return { ...candidateBody(candidate), candidate_sha256: digest(candidateBody(candidate)) };
}

function normalizeActivation() {
  return { owner: 'external-authority', authorized: false, state: 'NOT_ACTIVE', note: 'HISTOS cannot activate candidates.' };
}

/**
 * Build an OBSERVED candidate and deterministic metrics.  Even with many
 * observations the lifecycle remains OBSERVED until the host records the
 * explicit OBSERVED -> REPEATED transition.
 */
export function buildAutomationCandidate({ signature, observations, producer_id = 'histos', counterexamples = [] }) {
  const normalizedSignature = normalizeSignature(signature);
  assertId(producer_id, 'PRODUCER_ID_INVALID');
  if (!Array.isArray(observations) || observations.length === 0 || observations.length > 10_000) fail('OBSERVATIONS_REQUIRED');
  const normalizedObservations = observations.map((item, index) => normalizeObservation(item, normalizedSignature, index));
  const IDs = new Set();
  for (const item of normalizedObservations) {
    if (IDs.has(item.observation_id)) fail('OBSERVATION_ID_DUPLICATE');
    IDs.add(item.observation_id);
  }
  normalizedObservations.sort((a, b) => a.observation_id.localeCompare(b.observation_id));
  const scope = { scope_id: normalizedSignature.scope_id, source_snapshot_sha256: normalizedSignature.source_snapshot_sha256 };
  const normalizedCounterexamples = counterexamples.map((item, index) => normalizeCounterexample(item, scope, index));
  const candidate = {
    schema: OPERATION_CANDIDATE_SCHEMA,
    candidate_id: `candidate-${normalizedSignature.signature_sha256.slice(0, 24)}`,
    producer_id,
    signature: normalizedSignature,
    signature_sha256: normalizedSignature.signature_sha256,
    scope_id: scope.scope_id,
    source_snapshot_sha256: scope.source_snapshot_sha256,
    state: 'OBSERVED',
    io_contract: {
      input: clone(normalizedSignature.input_contract),
      output: clone(normalizedSignature.output_contract),
      input_sha256: digest(normalizedSignature.input_contract),
      output_sha256: digest(normalizedSignature.output_contract),
      abstention: normalizeAbstention({ allowed: true, on_unknown: 'ABSTAIN', reason_codes: ['UNKNOWN_INPUT', 'COUNTEREXAMPLE', 'SAFETY_BOUNDARY'] }),
    },
    observations: normalizedObservations,
    metrics: deriveMetrics(normalizedObservations, normalizedSignature),
    counterexamples: normalizedCounterexamples,
    shadow: { status: 'NOT_RUN', result_sha256: null },
    verification: { status: 'NOT_RUN', verifier_id: null, receipt_sha256: null },
    history: [{ ordinal: 0, from: null, to: 'OBSERVED', evidence_sha256: digest({ signature_sha256: normalizedSignature.signature_sha256, observations: normalizedObservations.map(item => item.observation_id) }) }],
    authority: 'none',
    current_truth: false,
    activation: normalizeActivation(),
  };
  return sealCandidate(candidate);
}

function validateMetrics(candidate) {
  const expected = deriveMetrics(candidate.observations, candidate.signature);
  if (canonical(candidate.metrics) !== canonical(expected) &&
      !(candidate.state === 'VERIFIED' && candidate.metrics.deterministic_verifier_available === true &&
        canonical({ ...candidate.metrics, deterministic_verifier_available: false }) === canonical(expected))) fail('CANDIDATE_METRICS_MISMATCH');
}

function validateHistory(candidate) {
  if (!Array.isArray(candidate.history) || candidate.history.length === 0 || candidate.history[0].to !== 'OBSERVED') fail('CANDIDATE_HISTORY_INVALID');
  let state = 'OBSERVED';
  for (const [index, item] of candidate.history.entries()) {
    if (!item || item.ordinal !== index || item.from !== (index === 0 ? null : state) || !LIFECYCLE.includes(item.to) ||
        (index > 0 && TRANSITIONS[state] !== item.to) || !HASH.test(item.evidence_sha256 ?? '')) fail('CANDIDATE_HISTORY_INVALID');
    state = item.to;
  }
  if (state !== candidate.state) fail('CANDIDATE_HISTORY_STATE_MISMATCH');
}

/** Validate all candidate invariants, including authority and lineage boundaries. */
export function validateAutomationCandidate(candidate) {
  if (!candidate || candidate.schema !== OPERATION_CANDIDATE_SCHEMA) fail('CANDIDATE_INVALID');
  const signature = normalizeSignature(candidate.signature);
  if (candidate.signature_sha256 !== signature.signature_sha256 || candidate.scope_id !== signature.scope_id ||
      candidate.source_snapshot_sha256 !== signature.source_snapshot_sha256) fail('CANDIDATE_SIGNATURE_MISMATCH');
  assertId(candidate.candidate_id, 'CANDIDATE_ID_INVALID');
  assertId(candidate.producer_id, 'PRODUCER_ID_INVALID');
  if (!LIFECYCLE.includes(candidate.state)) fail('CANDIDATE_STATE_INVALID');
  if (candidate.authority !== 'none' || candidate.current_truth !== false || candidate.activation?.owner !== 'external-authority' ||
      candidate.activation?.authorized !== false || candidate.activation?.state !== 'NOT_ACTIVE') fail('CANDIDATE_AUTHORITY_UNSAFE');
  if (!candidate.io_contract || candidate.io_contract.input_sha256 !== digest(signature.input_contract) ||
      candidate.io_contract.output_sha256 !== digest(signature.output_contract)) fail('CANDIDATE_IO_CONTRACT_MISMATCH');
  normalizeAbstention(candidate.io_contract.abstention);
  if (!Array.isArray(candidate.observations) || candidate.observations.length === 0) fail('CANDIDATE_OBSERVATIONS_MISSING');
  const observations = candidate.observations.map((item, index) => normalizeObservation(item, signature, index));
  if (canonical(observations.sort((a, b) => a.observation_id.localeCompare(b.observation_id))) !== canonical(candidate.observations)) fail('CANDIDATE_OBSERVATIONS_MISMATCH');
  validateMetrics(candidate);
  if (!Array.isArray(candidate.counterexamples)) fail('CANDIDATE_COUNTEREXAMPLES_INVALID');
  candidate.counterexamples.map((item, index) => normalizeCounterexample(item, { scope_id: signature.scope_id, source_snapshot_sha256: signature.source_snapshot_sha256 }, index));
  validateHistory(candidate);
  if (!candidate.shadow || !['NOT_RUN', 'PLANNED', 'PASSED'].includes(candidate.shadow.status)) fail('CANDIDATE_SHADOW_INVALID');
  if (!candidate.verification || !['NOT_RUN', 'PASSED'].includes(candidate.verification.status)) fail('CANDIDATE_VERIFICATION_INVALID');
  if (candidate.state === 'VERIFIED') {
    if (candidate.shadow.status !== 'PASSED' || candidate.verification.status !== 'PASSED' || candidate.metrics.deterministic_verifier_available !== true) fail('CANDIDATE_VERIFIED_GATE_FAILED');
  }
  if (candidate.candidate_sha256 !== undefined && candidate.candidate_sha256 !== digest(candidateBody(candidate))) fail('CANDIDATE_FORGED');
  return clone(candidate);
}

function transitionEvidence(candidate, evidence) {
  return normalizeEvidence(evidence, { scope_id: candidate.scope_id, source_snapshot_sha256: candidate.source_snapshot_sha256 }, { required: true });
}

/** Advance exactly one lifecycle edge. VERIFIED is only reachable via verifyAutomationCandidate. */
export function advanceCandidate(candidate, nextState, evidence) {
  const current = validateAutomationCandidate(candidate);
  if (!LIFECYCLE.includes(nextState)) fail('CANDIDATE_STATE_INVALID');
  if (TRANSITIONS[current.state] !== nextState) fail('LIFECYCLE_TRANSITION_REJECTED');
  if (nextState === 'VERIFIED') fail('VERIFIED_REQUIRES_INDEPENDENT_VERIFIER');
  const receipt = transitionEvidence(current, evidence);
  if (nextState === 'REPEATED' && current.metrics.occurrence_count < 2) fail('REPEAT_THRESHOLD_NOT_MET');
  if (nextState === 'CANDIDATE' && (!current.metrics.stable_io_contract || current.counterexamples.length < 1)) fail('CANDIDATE_EVIDENCE_GATE_FAILED');
  if (nextState === 'SHADOW' && current.counterexamples.length < 1) fail('SHADOW_COUNTEREXAMPLES_REQUIRED');
  const next = {
    ...current,
    state: nextState,
    history: [...current.history, { ordinal: current.history.length, from: current.state, to: nextState, evidence_sha256: receipt.evidence_sha256 }],
    ...(nextState === 'SHADOW' ? { shadow: { status: 'PLANNED', plan_sha256: digest({ candidate_sha256: current.candidate_sha256, counterexamples: current.counterexamples }), result_sha256: null } } : {}),
  };
  return sealCandidate(next);
}

function validateTypedValue(value, schema, pathName = '$') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.some(item => canonical(item) === canonical(value)))) fail(`IO_ENUM_MISMATCH:${pathName}`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`IO_TYPE_MISMATCH:${pathName}`);
    for (const key of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`IO_REQUIRED_MISSING:${pathName}.${key}`);
    if (schema.additionalProperties === false && schema.properties) for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) fail(`IO_ADDITIONAL_PROPERTY:${pathName}.${key}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (Object.prototype.hasOwnProperty.call(value, key)) validateTypedValue(value[key], child, `${pathName}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`IO_TYPE_MISMATCH:${pathName}`);
    for (const [index, item] of value.entries()) validateTypedValue(item, schema.items, `${pathName}[${index}]`);
  } else if (schema.type === 'string' && typeof value !== 'string') fail(`IO_TYPE_MISMATCH:${pathName}`);
  else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail(`IO_TYPE_MISMATCH:${pathName}`);
  else if (schema.type === 'integer' && (!Number.isSafeInteger(value))) fail(`IO_TYPE_MISMATCH:${pathName}`);
  else if (schema.type === 'boolean' && typeof value !== 'boolean') fail(`IO_TYPE_MISMATCH:${pathName}`);
}

function normalizeExecutionResult(result, candidate) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('EXECUTION_RESULT_INVALID');
  // Executor output is data only.  A candidate cannot smuggle policy or
  // Mission-control fields through either the output or abstention branch.
  for (const key of RESERVED_CONTROL_KEYS) if (Object.prototype.hasOwnProperty.call(result, key)) fail('EXECUTION_CONTROL_MUTATION');
  if (result.kind === 'abstain') {
    if (!candidate.io_contract.abstention.reason_codes.includes(result.reason_code)) fail('ABSTENTION_REASON_UNDECLARED');
    return { kind: 'abstain', reason_code: result.reason_code };
  }
  if (result.kind !== 'output') fail('EXECUTION_RESULT_INVALID');
  validateTypedValue(result.value, candidate.io_contract.output);
  if (result.authority !== undefined || result.current_truth !== undefined || result.activation !== undefined || result.budget !== undefined || result.safety !== undefined || result.completion !== undefined) fail('EXECUTION_CONTROL_MUTATION');
  return { kind: 'output', value: clone(result.value), output_sha256: digest(result.value) };
}

/** Execute only a VERIFIED candidate; the caller still owns all authority. */
export async function executeQualifiedCandidate({ candidate, input, execute }) {
  const checked = validateAutomationCandidate(candidate);
  if (checked.state !== 'VERIFIED') fail('CANDIDATE_NOT_VERIFIED');
  if (typeof execute !== 'function') fail('EXECUTOR_REQUIRED');
  validateTypedValue(input, checked.io_contract.input);
  const output = await execute(clone(input), { mode: 'selected', candidate_sha256: checked.candidate_sha256 });
  return normalizeExecutionResult(output, checked);
}

function normalizeShadowCase(item, candidate, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('SHADOW_CASE_INVALID');
  const input_sha256 = item.input_sha256 ?? digest(item.input === undefined ? null : item.input);
  assertHash(input_sha256, 'SHADOW_INPUT_INVALID');
  const expected = item.expected;
  if (!expected || typeof expected !== 'object' || !['output', 'abstain'].includes(expected.kind)) fail('SHADOW_EXPECTATION_INVALID');
  if (expected.kind === 'abstain') {
    if (!checkedReason(expected.reason_code, candidate)) fail('SHADOW_REASON_INVALID');
  } else assertHash(expected.output_sha256 ?? digest(expected.output === undefined ? null : expected.output), 'SHADOW_OUTPUT_INVALID');
  validateTypedValue(item.input === undefined ? null : item.input, candidate.io_contract.input);
  return { case_id: assertId(item.case_id ?? `shadow-${index + 1}`, 'SHADOW_CASE_ID_INVALID'), input: clone(item.input), input_sha256,
    expected: expected.kind === 'abstain' ? { kind: 'abstain', reason_code: expected.reason_code } : { kind: 'output', output_sha256: expected.output_sha256 ?? digest(expected.output === undefined ? null : expected.output) } };
}

function checkedReason(reason, candidate) {
  return typeof reason === 'string' && candidate.io_contract.abstention.reason_codes.includes(reason);
}

/** Execute bounded shadow cases twice to detect nondeterministic outputs. */
export async function runShadowEvaluation({ candidate, cases, execute }) {
  const checked = validateAutomationCandidate(candidate);
  if (checked.state !== 'SHADOW') fail('SHADOW_STATE_REQUIRED');
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 128 || typeof execute !== 'function') fail('SHADOW_INPUT_INVALID');
  const normalizedCases = cases.map((item, index) => normalizeShadowCase(item, checked, index));
  const seen = new Set();
  const reports = [];
  normalizedCases.sort((a, b) => a.case_id.localeCompare(b.case_id));
  for (const item of normalizedCases) {
    if (seen.has(item.case_id)) fail('SHADOW_CASE_DUPLICATE');
    seen.add(item.case_id);
    const runs = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await execute(clone(item.input), { mode: 'shadow', attempt: attempt + 1, candidate_sha256: checked.candidate_sha256 });
      runs.push(normalizeExecutionResult(raw, checked));
    }
    if (canonical(runs[0]) !== canonical(runs[1])) reports.push({ case_id: item.case_id, input: clone(item.input), expected: clone(item.expected), disposition: 'NONDETERMINISTIC', runs });
    else {
      const actual = runs[0];
      const matches = item.expected.kind === actual.kind && (actual.kind === 'abstain'
        ? actual.reason_code === item.expected.reason_code
        : actual.output_sha256 === item.expected.output_sha256);
      reports.push({ case_id: item.case_id, input: clone(item.input), disposition: matches ? 'PASS' : 'COUNTEREXAMPLE', actual, expected: clone(item.expected) });
    }
  }
  const failed = reports.filter(item => item.disposition !== 'PASS');
  const case_digests = normalizedCases.map(item => {
    const report = reports.find(entry => entry.case_id === item.case_id);
    return { case_id: item.case_id, input_sha256: item.input_sha256, expected_sha256: digest(item.expected), report_sha256: digest(report) };
  });
  return {
    schema: SHADOW_RESULT_SCHEMA,
    candidate_sha256: checked.candidate_sha256,
    status: failed.length ? 'FAILED' : 'PASSED',
    case_count: reports.length,
    passed_count: reports.length - failed.length,
    failed_count: failed.length,
    counterexamples_checked: normalizedCases.length,
    case_digests,
    reports,
    shadow_digest: digest({ candidate_sha256: checked.candidate_sha256, case_digests, reports }),
  };
}

function validateShadowResult(shadowResult, candidate) {
  if (!shadowResult || shadowResult.schema !== SHADOW_RESULT_SCHEMA || shadowResult.candidate_sha256 !== candidate.candidate_sha256 ||
      !Array.isArray(shadowResult.reports) || shadowResult.reports.length === 0 ||
      !Array.isArray(shadowResult.case_digests) || shadowResult.case_digests.length !== shadowResult.reports.length ||
      !Number.isSafeInteger(shadowResult.case_count) || shadowResult.case_count !== shadowResult.reports.length ||
      !Number.isSafeInteger(shadowResult.counterexamples_checked) || shadowResult.counterexamples_checked !== shadowResult.case_count ||
      !Number.isSafeInteger(shadowResult.passed_count) || !Number.isSafeInteger(shadowResult.failed_count) ||
      shadowResult.passed_count < 0 || shadowResult.failed_count < 0 ||
      shadowResult.passed_count + shadowResult.failed_count !== shadowResult.case_count || !HASH.test(shadowResult.shadow_digest ?? '')) fail('SHADOW_RESULT_INVALID');
  const ids = new Set();
  let passed = 0;
  const validateShadowInput = input => {
    try { validateTypedValue(input, candidate.io_contract.input); }
    catch { fail('SHADOW_RESULT_INVALID'); }
  };
  for (const report of shadowResult.reports) {
    if (!report || typeof report !== 'object' || !ID.test(report.case_id ?? '') || ids.has(report.case_id) ||
        !['PASS', 'COUNTEREXAMPLE', 'NONDETERMINISTIC'].includes(report.disposition)) fail('SHADOW_RESULT_INVALID');
    ids.add(report.case_id);
    if (report.disposition === 'NONDETERMINISTIC') {
      validateShadowInput(report.input);
      if (!report.expected || typeof report.expected !== 'object' || !['output', 'abstain'].includes(report.expected.kind)) fail('SHADOW_RESULT_INVALID');
      if (report.expected.kind === 'abstain') {
        if (!checkedReason(report.expected.reason_code, candidate)) fail('SHADOW_RESULT_INVALID');
      } else if (!HASH.test(report.expected.output_sha256 ?? '')) fail('SHADOW_RESULT_INVALID');
      if (!Array.isArray(report.runs) || report.runs.length !== 2 || canonical(report.runs[0]) === canonical(report.runs[1])) fail('SHADOW_RESULT_INVALID');
      for (const run of report.runs) {
        let normalized;
        try { normalized = normalizeExecutionResult(run, candidate); }
        catch { fail('SHADOW_RESULT_INVALID'); }
        if (canonical(normalized) !== canonical(run)) fail('SHADOW_RESULT_INVALID');
      }
    } else {
      validateShadowInput(report.input);
      if (!report.actual || !report.expected || typeof report.actual !== 'object' || typeof report.expected !== 'object') fail('SHADOW_RESULT_INVALID');
      let actual;
      try { actual = normalizeExecutionResult(report.actual, candidate); }
      catch { fail('SHADOW_RESULT_INVALID'); }
      if (canonical(actual) !== canonical(report.actual)) fail('SHADOW_RESULT_INVALID');
      const expected = report.expected;
      if (!['output', 'abstain'].includes(expected.kind)) fail('SHADOW_RESULT_INVALID');
      if (expected.kind === 'abstain') {
        if (!checkedReason(expected.reason_code, candidate)) fail('SHADOW_RESULT_INVALID');
      } else if (!HASH.test(expected.output_sha256 ?? '')) fail('SHADOW_RESULT_INVALID');
      const matches = expected.kind === actual.kind && (actual.kind === 'abstain'
        ? expected.reason_code === actual.reason_code
        : expected.output_sha256 === actual.output_sha256);
      if ((report.disposition === 'PASS') !== matches) fail('SHADOW_RESULT_INVALID');
      if (report.disposition === 'PASS') passed++;
    }
    for (const key of RESERVED_CONTROL_KEYS) if (Object.prototype.hasOwnProperty.call(report, key)) fail('SHADOW_RESULT_INVALID');
  }
  const caseDigests = shadowResult.case_digests.map(item => {
    if (!item || typeof item !== 'object' || !ID.test(item.case_id ?? '') || !ids.has(item.case_id) ||
        !HASH.test(item.input_sha256 ?? '') || !HASH.test(item.expected_sha256 ?? '') || !HASH.test(item.report_sha256 ?? '')) fail('SHADOW_RESULT_INVALID');
    const report = shadowResult.reports.find(entry => entry.case_id === item.case_id);
    if (!report || digest(report.input) !== item.input_sha256 || digest(report.expected) !== item.expected_sha256 || digest(report) !== item.report_sha256) fail('SHADOW_RESULT_INVALID');
    return { case_id: item.case_id, input_sha256: item.input_sha256, expected_sha256: item.expected_sha256, report_sha256: item.report_sha256 };
  }).sort((a, b) => a.case_id.localeCompare(b.case_id));
  if (new Set(caseDigests.map(item => item.case_id)).size !== caseDigests.length ||
      canonical(caseDigests) !== canonical(shadowResult.case_digests.slice().sort((a, b) => a.case_id.localeCompare(b.case_id)))) fail('SHADOW_RESULT_INVALID');
  const expectedStatus = shadowResult.failed_count === 0 && passed === shadowResult.case_count ? 'PASSED' : 'FAILED';
  if (shadowResult.status !== expectedStatus || shadowResult.passed_count !== passed ||
      shadowResult.shadow_digest !== digest({ candidate_sha256: candidate.candidate_sha256, case_digests: caseDigests, reports: shadowResult.reports })) fail('SHADOW_RESULT_INVALID');
  return clone(shadowResult);
}

/** Independently verify a passed shadow result and append the SHADOW -> VERIFIED edge. */
export async function verifyAutomationCandidate({ candidate, shadowResult, verifier, evidence }) {
  const checked = validateAutomationCandidate(candidate);
  if (checked.state !== 'SHADOW') fail('VERIFICATION_STATE_REQUIRED');
  const normalizedShadow = validateShadowResult(shadowResult, checked);
  if (normalizedShadow.status !== 'PASSED') fail('SHADOW_NOT_PASSED');
  if (!verifier || typeof verifier !== 'object' || typeof verifier.verify !== 'function') fail('VERIFIER_REQUIRED');
  assertId(verifier.verifier_id, 'VERIFIER_ID_REQUIRED');
  assertHash(verifier.implementation_sha256, 'VERIFIER_IMPLEMENTATION_INVALID');
  if (verifier.verifier_id === checked.producer_id || verifier.independent !== true || verifier.deterministic !== true) fail('VERIFIER_NOT_INDEPENDENT');
  const receiptEvidence = transitionEvidence(checked, evidence);
  let result;
  try { result = await verifier.verify({ candidate: clone(checked), shadow: clone(normalizedShadow) }); }
  catch { fail('VERIFIER_FAILED'); }
  if (!result || result.pass !== true || result.verifier_id !== verifier.verifier_id || result.deterministic !== true ||
      result.checked_candidate_sha256 !== checked.candidate_sha256 || result.checked_shadow_digest !== normalizedShadow.shadow_digest ||
      result.authority !== undefined || result.current_truth !== undefined) fail('VERIFIER_RECEIPT_INVALID');
  const receipt = {
    schema: 'histos.operation-verification/v1', verifier_id: verifier.verifier_id, implementation_sha256: verifier.implementation_sha256,
    deterministic: true, independent: true, checked_candidate_sha256: checked.candidate_sha256, checked_shadow_digest: normalizedShadow.shadow_digest,
    evidence_sha256: receiptEvidence.evidence_sha256,
  };
  const next = {
    ...checked,
    state: 'VERIFIED',
    metrics: { ...checked.metrics, deterministic_verifier_available: true },
    shadow: { status: 'PASSED', result_sha256: normalizedShadow.shadow_digest, case_count: normalizedShadow.case_count, counterexamples_checked: normalizedShadow.counterexamples_checked },
    verification: { status: 'PASSED', verifier_id: verifier.verifier_id, receipt_sha256: digest(receipt), receipt },
    history: [...checked.history, { ordinal: checked.history.length, from: 'SHADOW', to: 'VERIFIED', evidence_sha256: digest(receipt) }],
  };
  return sealCandidate(next);
}

/** Select a verified candidate without granting activation or Mission authority. */
export function selectQualifiedCandidate({ candidates, signature_sha256, scope_id }) {
  assertHash(signature_sha256, 'SELECTION_SIGNATURE_INVALID');
  assertId(scope_id, 'SELECTION_SCOPE_INVALID');
  if (!Array.isArray(candidates) || candidates.length === 0) fail('SELECTION_CANDIDATES_REQUIRED');
  const checked = candidates.map(validateAutomationCandidate).filter(candidate => candidate.state === 'VERIFIED' && candidate.signature_sha256 === signature_sha256 && candidate.scope_id === scope_id);
  if (!checked.length) fail('NO_QUALIFIED_CANDIDATE');
  checked.sort((a, b) => a.candidate_sha256.localeCompare(b.candidate_sha256));
  const chosen = checked[0];
  return {
    schema: SELECTION_SCHEMA,
    selected_candidate_sha256: chosen.candidate_sha256,
    signature_sha256,
    scope_id,
    candidates_considered: checked.map(item => item.candidate_sha256),
    authority: 'none',
    activation: normalizeActivation(),
    selection_sha256: digest({ selected_candidate_sha256: chosen.candidate_sha256, signature_sha256, scope_id }),
  };
}

/** Explicitly refuse an in-HISTOS activation request. */
export function activateCandidate() {
  fail('EXTERNAL_AUTHORITY_REQUIRED');
}

/** Produce a fail-closed rollback receipt to a previously qualified path. */
export function rollbackCandidate({ candidate, priorCandidate, reason, evidence }) {
  const current = validateAutomationCandidate(candidate);
  const prior = validateAutomationCandidate(priorCandidate);
  if (prior.state !== 'VERIFIED') fail('ROLLBACK_PRIOR_NOT_QUALIFIED');
  if (prior.signature_sha256 !== current.signature_sha256 || prior.scope_id !== current.scope_id) fail('ROLLBACK_SCOPE_OR_SIGNATURE_MISMATCH');
  if (typeof reason !== 'string' || reason.length < 1 || reason.length > 512) fail('ROLLBACK_REASON_INVALID');
  const receiptEvidence = transitionEvidence(current, evidence);
  const receipt = {
    schema: ROLLBACK_SCHEMA,
    failed_candidate_sha256: current.candidate_sha256,
    prior_candidate_sha256: prior.candidate_sha256,
    reason,
    evidence_sha256: receiptEvidence.evidence_sha256,
    authority: 'none',
    activation: normalizeActivation(),
    rollback_integrity: digest({ signature_sha256: current.signature_sha256, prior_candidate_sha256: prior.candidate_sha256 }) === digest({ signature_sha256: prior.signature_sha256, prior_candidate_sha256: prior.candidate_sha256 }),
  };
  if (!receipt.rollback_integrity) fail('ROLLBACK_INTEGRITY_FAILED');
  return { ...receipt, rollback_sha256: digest(receipt) };
}

export const buildOperationCandidate = buildAutomationCandidate;
export const validateCandidate = validateAutomationCandidate;
export const transitionCandidate = advanceCandidate;
export const runShadow = runShadowEvaluation;
export const verifyCandidate = verifyAutomationCandidate;
export const selectCandidate = selectQualifiedCandidate;

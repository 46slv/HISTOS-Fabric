import { createHash } from 'node:crypto';

import { canonical, normalizeEvidenceEvent } from '../events/evidence-events.mjs';

/**
 * Deterministic, read-only replay for Evidence Event routing.
 *
 * This module deliberately keeps scoring labels outside the event envelope:
 * labels describe an independently reviewed reusable outcome and are consumed
 * only after a policy has selected an event.  A friction count, recall, or
 * route can therefore affect utility/inspection work without becoming proof,
 * current truth, or activation authority.
 */

export const FRICTION_REPLAY_FIXTURE_SCHEMA = 'histos.friction-replay-fixture/v1';
export const FRICTION_REPLAY_REPORT_SCHEMA = 'histos.friction-replay-report/v1';
export const FRICTION_REPLAY_ALGORITHM = 'friction-replay/v1';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SPLITS = new Set(['development', 'held_out']);
const MAX_ENTRIES = 10_000;
const MAX_FIXTURE_BYTES = 8 * 1024 * 1024;
const MAX_SELECTED_EVENTS = 10_000;
const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_COST_UNITS = 1_000_000;

const fail = code => { throw new Error(code); };
const clone = value => structuredClone(value);

function assertId(value, code = 'REPLAY_ID_INVALID') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code);
  return value;
}

function assertHash(value, code = 'REPLAY_HASH_INVALID') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function finiteNumber(value, min, max, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code);
  return value;
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function digest(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function normalizeScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('REPLAY_SCOPE_INVALID');
  const scope_id = input.scope_id ?? input.scopeId;
  assertId(scope_id, 'REPLAY_SCOPE_REQUIRED');
  const source_snapshot_sha256 = input.source_snapshot_sha256 ?? input.snapshot_sha256 ?? input.snapshot_digest;
  if (source_snapshot_sha256 !== undefined && source_snapshot_sha256 !== null) {
    assertHash(source_snapshot_sha256, 'REPLAY_SNAPSHOT_INVALID');
    return { scope_id, source_snapshot_sha256 };
  }
  return { scope_id };
}

function rejectLabelAuthority(label) {
  if (!label || typeof label !== 'object' || Array.isArray(label)) fail('REPLAY_LABEL_INVALID');
  const forbidden = new Set([
    'authority', 'current_truth', 'verified', 'active', 'activation', 'permission', 'proof',
    'support', 'mission_state', 'status', 'retention', 'credential', 'secret', 'transcript',
  ]);
  for (const key of Object.keys(label)) {
    if (forbidden.has(key.toLowerCase())) fail('REPLAY_LABEL_AUTHORITY_MUTATION');
  }
}

function normalizeLabel(input) {
  rejectLabelAuthority(input);
  const reusable = input.reusable;
  if (typeof reusable !== 'boolean') fail('REPLAY_LABEL_REUSABLE_REQUIRED');
  const candidate_quality = finiteNumber(input.candidate_quality ?? input.quality_score ?? 0, 0, 1, 'REPLAY_LABEL_QUALITY_INVALID');
  const distill_cost_units = positiveInteger(input.distill_cost_units ?? input.cost_units ?? 1, 'REPLAY_LABEL_COST_INVALID');
  if (distill_cost_units > MAX_COST_UNITS) fail('REPLAY_LABEL_COST_INVALID');
  if (input.reviewer_ref === undefined) fail('REPLAY_LABEL_REVIEWER_REQUIRED');
  const reviewer_ref = assertId(input.reviewer_ref, 'REPLAY_LABEL_REVIEWER_INVALID');
  return {
    reusable,
    candidate_quality,
    distill_cost_units,
    ...(reviewer_ref ? { reviewer_ref } : {}),
  };
}

function assertNoGoldLabelLeak(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) fail('REPLAY_EVENT_INVALID');
  const leakKeys = new Set([
    'reusable', 'reusable_outcome', 'candidate_quality', 'quality_score', 'distill_cost_units',
    'cost_units', 'gold', 'label', 'expected_route', 'held_out_label',
  ]);
  for (const key of Object.keys(event)) {
    if (leakKeys.has(key.toLowerCase())) fail('REPLAY_EVENT_GOLD_LABEL_LEAK');
  }
}

function normalizeRecord(record, fixtureScope, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('REPLAY_RECORD_INVALID');
  const split = record.split ?? record.partition;
  if (!SPLITS.has(split)) fail('REPLAY_SPLIT_INVALID');
  if (record.label === undefined) fail('REPLAY_LABEL_REQUIRED');
  assertNoGoldLabelLeak(record.event);
  // A previously normalized event keeps its producer identity under
  // replay_identity.  Re-expose that value to the normalizer so validation is
  // idempotent instead of accidentally deriving a new producer ID from the
  // delivery event_id.
  const eventInput = record.event.replay_identity?.producer_event_id !== undefined && record.event.producer_event_id === undefined
    ? { ...record.event, producer_event_id: record.event.replay_identity.producer_event_id }
    : record.event;
  const event = normalizeEvidenceEvent(eventInput);
  if (event.scope.scope_id !== fixtureScope.scope_id) fail('REPLAY_SCOPE_MISMATCH');
  if (fixtureScope.source_snapshot_sha256 && event.scope.source_snapshot_sha256 !== fixtureScope.source_snapshot_sha256) {
    fail('REPLAY_SNAPSHOT_MISMATCH');
  }
  if (!event.event_id) fail('REPLAY_EVENT_ID_REQUIRED');
  return {
    event,
    label: normalizeLabel(record.label),
    split,
    ordinal: index,
  };
}

function sortedRecords(records) {
  return [...records].sort((a, b) => a.event.event_id.localeCompare(b.event.event_id) || a.ordinal - b.ordinal);
}

/**
 * Validate and freeze a replay fixture.  The returned value is detached from
 * the caller and sorted by stable event identity for reproducibility.
 */
export function normalizeFrictionReplayFixture(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('REPLAY_FIXTURE_INVALID');
  if (input.schema !== FRICTION_REPLAY_FIXTURE_SCHEMA) fail('REPLAY_FIXTURE_SCHEMA_INVALID');
  const scope = normalizeScope(input.scope);
  const recordsInput = input.records ?? input.entries;
  if (!Array.isArray(recordsInput) || recordsInput.length === 0 || recordsInput.length > MAX_ENTRIES) fail('REPLAY_RECORDS_INVALID');
  const records = recordsInput.map((record, index) => normalizeRecord(record, scope, index));
  const ids = new Set();
  const replayKeys = new Set();
  for (const record of records) {
    if (ids.has(record.event.event_id)) fail('REPLAY_EVENT_DUPLICATE');
    if (replayKeys.has(record.event.replay_identity.replay_key)) fail('REPLAY_REPLAY_KEY_DUPLICATE');
    ids.add(record.event.event_id);
    replayKeys.add(record.event.replay_identity.replay_key);
  }
  const sorted = sortedRecords(records).map(({ event, label, split }) => ({ event, label, split }));
  const fixture = {
    schema: FRICTION_REPLAY_FIXTURE_SCHEMA,
    fixture_id: assertId(input.fixture_id ?? `fixture-${digest({ scope, records: sorted }).slice(0, 24)}`, 'REPLAY_FIXTURE_ID_INVALID'),
    scope,
    records: sorted,
    ...(input.description === undefined ? {} : { description: String(input.description).slice(0, 256) }),
  };
  const serializedBytes = Buffer.byteLength(canonical(fixture), 'utf8');
  const maxFixtureBytes = options.max_fixture_bytes ?? MAX_FIXTURE_BYTES;
  positiveInteger(maxFixtureBytes, 'REPLAY_FIXTURE_BUDGET_INVALID');
  if (serializedBytes > maxFixtureBytes) fail('REPLAY_FIXTURE_OVERSIZED');
  return clone({ ...fixture, fixture_sha256: digest(fixture), byte_size: serializedBytes });
}

function isVerificationOrCorrection(event) {
  if (event.event_kind === 'user_instruction_or_correction') return true;
  if (event.event_kind === 'verifier_result' && event.verification_refs.length > 0) return true;
  // A successful deterministic command/test result with an independent
  // receipt is an explicit verification route, even without friction.
  if (event.event_kind === 'command_or_test_result' && event.outcome === 'success' && event.verification_refs.length > 0) return true;
  return false;
}

function hasHighValueSmoothSignal(event) {
  return event.routing.smooth_positive === true ||
    (event.event_kind === 'successful_procedure' && event.outcome === 'success') ||
    (event.event_kind === 'repeated_operation' && event.outcome === 'success' && event.verification_refs.length > 0);
}

function decisionFor(policyName, event) {
  const friction = event.routing.friction_score > 0;
  const verification_or_correction = isVerificationOrCorrection(event);
  const smooth_positive = hasHighValueSmoothSignal(event);
  if (policyName === 'distill_all') return { selected: true, reasons: ['all'] };
  if (policyName === 'friction_only') return friction ? { selected: true, reasons: ['friction'] } : { selected: false, reasons: [] };
  if (policyName === 'friction_plus_verification') {
    const reasons = [];
    if (friction) reasons.push('friction');
    if (verification_or_correction) reasons.push('verification_or_correction');
    return { selected: reasons.length > 0, reasons };
  }
  if (policyName === 'utility_smooth_positive') {
    const reasons = [];
    if (friction) reasons.push('friction');
    if (verification_or_correction) reasons.push('verification_or_correction');
    if (smooth_positive) reasons.push('smooth_positive');
    return { selected: reasons.length > 0, reasons };
  }
  fail('REPLAY_POLICY_UNSUPPORTED');
}

export const REPLAY_POLICIES = Object.freeze([
  'distill_all',
  'friction_only',
  'friction_plus_verification',
  'utility_smooth_positive',
]);

function emptyRouteCounts() {
  return {
    all: 0,
    friction: 0,
    verification_or_correction: 0,
    smooth_positive: 0,
    selected: 0,
    not_selected: 0,
    budget_skipped: 0,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function summarizePolicy(records, policyName, options) {
  const maxSelectedEvents = options.max_selected_events;
  const maxReplayBytes = options.max_replay_bytes;
  const considered = records.length;
  const totalBytes = records.reduce((sum, record) => sum + record.event.byte_size, 0);
  const usefulRecords = records.filter(record => record.label.reusable);
  const totalQuality = usefulRecords.reduce((sum, record) => sum + record.label.candidate_quality, 0);
  const totalCost = records.reduce((sum, record) => sum + record.label.distill_cost_units, 0);
  const selected = [];
  const skippedByBudget = [];
  const routeCounts = emptyRouteCounts();
  let selectedBytes = 0;

  for (const record of records) {
    const decision = decisionFor(policyName, record.event);
    if (!decision.selected) {
      routeCounts.not_selected += 1;
      continue;
    }
    for (const reason of decision.reasons) routeCounts[reason] += 1;
    const overCount = selected.length >= maxSelectedEvents;
    const overBytes = selectedBytes + record.event.byte_size > maxReplayBytes;
    if (overCount || overBytes) {
      routeCounts.budget_skipped += 1;
      skippedByBudget.push(record.event.event_id);
      continue;
    }
    selected.push({ record, decision });
    selectedBytes += record.event.byte_size;
  }

  const selectedRecords = selected.map(item => item.record);
  const selectedUseful = selectedRecords.filter(record => record.label.reusable);
  const selectedQuality = selectedUseful.reduce((sum, record) => sum + record.label.candidate_quality, 0);
  const selectedCost = selectedRecords.reduce((sum, record) => sum + record.label.distill_cost_units, 0);
  const missedUsefulEvents = usefulRecords.filter(record => !selectedRecords.includes(record)).map(record => record.event.event_id);
  routeCounts.selected = selectedRecords.length;
  const candidateQuality = {
    selected_useful_events: selectedUseful.length,
    selected_quality_sum: selectedQuality,
    selected_quality_mean: ratio(selectedQuality, selectedUseful.length),
    useful_quality_recall: ratio(selectedQuality, totalQuality),
    ...(totalQuality === 0 ? { total_useful_quality: 0 } : { total_useful_quality: totalQuality }),
  };

  const result = {
    policy: policyName,
    split: options.split,
    metrics: {
      considered_events: considered,
      useful_events: usefulRecords.length,
      selected_events: selectedRecords.length,
      selected_useful_events: selectedUseful.length,
      trigger_precision: ratio(selectedUseful.length, selectedRecords.length),
      trigger_recall: ratio(selectedUseful.length, usefulRecords.length),
      avoided_work: {
        events: considered - selectedRecords.length,
        bytes: totalBytes - selectedBytes,
        cost_units: totalCost - selectedCost,
      },
      missed_useful_events: missedUsefulEvents,
      missed_useful_count: missedUsefulEvents.length,
      downstream_candidate_quality: candidateQuality,
      downstream_candidate_cost_units: selectedCost,
    },
    route_counts: routeCounts,
    scope: {
      scope_id: options.scope.scope_id,
      ...(options.scope.source_snapshot_sha256 ? { source_snapshot_sha256: options.scope.source_snapshot_sha256 } : {}),
      records_considered: considered,
      bytes_considered: totalBytes,
    },
    budget: {
      max_selected_events: maxSelectedEvents,
      max_replay_bytes: maxReplayBytes,
      selected_bytes: selectedBytes,
      budget_skipped_events: skippedByBudget,
      exhausted: skippedByBudget.length > 0,
    },
    selected_event_ids: selectedRecords.map(record => record.event.event_id),
    authority: 'none',
    current_truth: false,
    utility_only: true,
  };
  return result;
}

function normalizeReplayOptions(fixture, options) {
  const scope = normalizeScope(options.scope ?? fixture.scope);
  if (scope.scope_id !== fixture.scope.scope_id) fail('REPLAY_SCOPE_MISMATCH');
  if (fixture.scope.source_snapshot_sha256 && scope.source_snapshot_sha256 !== fixture.scope.source_snapshot_sha256) fail('REPLAY_SNAPSHOT_MISMATCH');
  const maxSelectedEvents = options.max_selected_events ?? MAX_SELECTED_EVENTS;
  const maxReplayBytes = options.max_replay_bytes ?? MAX_REPLAY_BYTES;
  positiveInteger(maxSelectedEvents, 'REPLAY_SELECTED_BUDGET_INVALID');
  positiveInteger(maxReplayBytes, 'REPLAY_BYTES_BUDGET_INVALID');
  if (maxSelectedEvents > MAX_SELECTED_EVENTS || maxReplayBytes > MAX_REPLAY_BYTES) fail('REPLAY_BUDGET_INVALID');
  const policies = options.policies ?? REPLAY_POLICIES;
  if (!Array.isArray(policies) || policies.length === 0 || policies.some(policy => !REPLAY_POLICIES.includes(policy))) fail('REPLAY_POLICY_INVALID');
  return { scope, max_selected_events: maxSelectedEvents, max_replay_bytes: maxReplayBytes, policies: [...new Set(policies)] };
}

/**
 * Replay all requested routing policies and return an auditable, machine-readable report.
 * Gold labels are used strictly for scoring after selection; they never reach
 * `decisionFor` and cannot influence event routing.
 */
export function replayFrictionPolicies(input, options = {}) {
  const fixture = normalizeFrictionReplayFixture(input);
  if (input?.fixture_sha256 !== undefined && input.fixture_sha256 !== fixture.fixture_sha256) fail('REPLAY_FIXTURE_FORGED');
  const replayOptions = normalizeReplayOptions(fixture, options);
  const recordsBySplit = {
    development: fixture.records.filter(record => record.split === 'development'),
    held_out: fixture.records.filter(record => record.split === 'held_out'),
  };
  if (recordsBySplit.development.length === 0 || recordsBySplit.held_out.length === 0) fail('REPLAY_SPLIT_REQUIRED');

  const policies = {};
  for (const policy of replayOptions.policies) {
    policies[policy] = {};
    for (const split of ['development', 'held_out']) {
      policies[policy][split] = summarizePolicy(recordsBySplit[split], policy, {
        ...replayOptions,
        split,
      });
    }
  }
  const reportCore = {
    schema: FRICTION_REPLAY_REPORT_SCHEMA,
    algorithm: FRICTION_REPLAY_ALGORITHM,
    fixture_id: fixture.fixture_id,
    fixture_sha256: fixture.fixture_sha256,
    scope: clone(fixture.scope),
    policies,
    budget: {
      max_selected_events: replayOptions.max_selected_events,
      max_replay_bytes: replayOptions.max_replay_bytes,
      policy_count: replayOptions.policies.length,
    },
    authority: 'none',
    current_truth: false,
    utility_only: true,
    notes: [
      'Friction, recall, and route frequency are utility/routing features only.',
      'Selection never changes H03 proof, authority, current truth, A00 activation, or policy installation.',
      'Held-out labels are independent scoring annotations and are not provided to routing decisions.',
    ],
  };
  return clone({ ...reportCore, report_sha256: digest(reportCore) });
}

export const evaluateFrictionReplay = replayFrictionPolicies;
export const runFrictionReplay = replayFrictionPolicies;
export const normalizeReplayFixture = normalizeFrictionReplayFixture;

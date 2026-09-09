import { FRICTION_REPLAY_FIXTURE_SCHEMA } from './friction-replay.mjs';

/**
 * Small, local-only reference trace used by the deterministic replay tests.
 * Labels are independent review annotations, not fields in the event body.
 */

const scope = {
  scope_id: 'replay-project',
  source_snapshot_sha256: 'a'.repeat(64),
};
const source = {
  kind: 'source',
  path: 'fixtures/replay-source.md',
  sha256: 'b'.repeat(64),
  bytes: 64,
  scope_id: scope.scope_id,
};

function event(id, overrides = {}) {
  return {
    event_id: id,
    producer_event_id: `producer-${id}`,
    scope,
    producer: { id: 'replay-fixture', kind: 'test', version: '1' },
    session_or_run_ref: `run-${id}`,
    occurred_at: '2026-09-09T01:02:03.000Z',
    observed_at: '2026-09-09T01:02:04.000Z',
    event_kind: 'command_or_test_result',
    source_snapshot_refs: [source],
    outcome: 'success',
    privacy_class: 'project',
    ...overrides,
  };
}

function record(id, reusable, overrides = {}, labelOverrides = {}) {
  return {
    split: id.startsWith('hold-') ? 'held_out' : 'development',
    event: event(id, overrides),
    label: {
      reusable,
      candidate_quality: reusable ? 0.9 : 0,
      distill_cost_units: 2,
      reviewer_ref: `review-${id}`,
      ...labelOverrides,
    },
  };
}

export const REFERENCE_SCOPE = Object.freeze(scope);

export function buildFrictionReplayReferenceFixture() {
  return {
    schema: FRICTION_REPLAY_FIXTURE_SCHEMA,
    fixture_id: 'fixture-friction-replay',
    scope: { ...scope },
    records: [
      record('dev-friction-useful', true, { event_kind: 'retry_or_repair', outcome: 'failure', friction: { tool_error_retry_count: 1 } }),
      record('dev-friction-noise', false, { event_kind: 'tool_result', friction: { tool_denial_count: 1 } }),
      record('dev-smooth-useful', true, { event_kind: 'successful_procedure' }),
      record('dev-verified-useful', true, {
        event_kind: 'verifier_result',
        verification_refs: [{ kind: 'independent_test', ref_id: 'receipt-dev-verified', sha256: 'c'.repeat(64), bytes: 16 }],
      }),
      record('hold-smooth-useful', true, { event_kind: 'successful_procedure' }, { candidate_quality: 1, distill_cost_units: 3 }),
      record('hold-quiet-noise', false, { event_kind: 'tool_result', outcome: 'success' }),
      record('hold-correction-useful', true, { event_kind: 'user_instruction_or_correction', outcome: 'success' }),
      record('hold-quiet-useful', true, { event_kind: 'tool_result', outcome: 'success' }),
    ],
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRICTION_REPLAY_FIXTURE_SCHEMA,
  FRICTION_REPLAY_REPORT_SCHEMA,
  normalizeFrictionReplayFixture,
  replayFrictionPolicies,
} from './friction-replay.mjs';
import { REFERENCE_SCOPE, buildFrictionReplayReferenceFixture } from './friction-replay-reference.mjs';

const scope = REFERENCE_SCOPE;
const fixture = buildFrictionReplayReferenceFixture;

test('replay compares all required routes and keeps friction utility-only', () => {
  const report = replayFrictionPolicies(fixture());
  assert.equal(report.schema, FRICTION_REPLAY_REPORT_SCHEMA);
  assert.match(report.report_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.authority, 'none');
  assert.equal(report.current_truth, false);
  assert.equal(report.utility_only, true);
  assert.deepEqual(Object.keys(report.policies).sort(), [
    'distill_all',
    'friction_only',
    'friction_plus_verification',
    'utility_smooth_positive',
  ]);

  const all = report.policies.distill_all.held_out.metrics;
  assert.equal(all.considered_events, 4);
  assert.equal(all.selected_events, 4);
  assert.equal(all.trigger_recall, 1);
  assert.equal(all.missed_useful_count, 0);

  const friction = report.policies.friction_only.held_out.metrics;
  assert.equal(friction.selected_event_ids, undefined);
  assert.equal(friction.trigger_precision, 0);
  assert.equal(friction.trigger_recall, 0);
  assert.equal(friction.missed_useful_count, 3);
  assert.equal(report.policies.friction_only.held_out.route_counts.selected, 0);

  const verified = report.policies.friction_plus_verification.held_out.metrics;
  assert.equal(verified.selected_events, 1);
  assert.equal(verified.selected_useful_events, 1);
  assert.equal(verified.trigger_precision, 1);
  assert.equal(verified.trigger_recall, 1 / 3);

  const smooth = report.policies.utility_smooth_positive.held_out.metrics;
  assert.equal(smooth.selected_events, 2);
  assert.equal(smooth.selected_useful_events, 2);
  assert.equal(smooth.trigger_precision, 1);
  assert.equal(smooth.trigger_recall, 2 / 3);
  assert.deepEqual(report.policies.utility_smooth_positive.held_out.selected_event_ids, [
    'hold-correction-useful',
    'hold-smooth-useful',
  ]);
  assert.equal(report.policies.utility_smooth_positive.held_out.route_counts.smooth_positive, 1);
  assert.equal(report.policies.utility_smooth_positive.held_out.metrics.downstream_candidate_cost_units, 5);
  assert.ok(report.policies.utility_smooth_positive.held_out.metrics.downstream_candidate_quality.selected_quality_sum > 0);
});

test('development and held-out metrics are reported separately with scope and budgets', () => {
  const report = replayFrictionPolicies(fixture(), { max_selected_events: 1, max_replay_bytes: 10_000 });
  for (const policy of Object.values(report.policies)) {
    for (const split of ['development', 'held_out']) {
      const result = policy[split];
      assert.equal(result.scope.scope_id, scope.scope_id);
      assert.equal(result.current_truth, false);
      assert.equal(result.authority, 'none');
      assert.equal(result.utility_only, true);
      assert.equal(result.budget.max_selected_events, 1);
      assert.equal(result.budget.exhausted, result.route_counts.budget_skipped > 0);
    }
  }
  assert.equal(report.policies.distill_all.development.budget.exhausted, true);
  assert.ok(report.policies.distill_all.development.budget.budget_skipped_events.length > 0);
});

test('replay is deterministic and does not mutate fixture input', () => {
  const input = fixture();
  const before = structuredClone(input);
  const first = replayFrictionPolicies(input);
  const second = replayFrictionPolicies(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});

test('scope, stale snapshot, label authority and gold-label leakage fail closed', () => {
  assert.throws(() => replayFrictionPolicies({ ...fixture(), scope: { ...scope, scope_id: 'other-scope' } }), /REPLAY_SCOPE_MISMATCH/);
  const stale = fixture();
  stale.records[0].event.scope = { ...scope, source_snapshot_sha256: 'd'.repeat(64) };
  assert.throws(() => normalizeFrictionReplayFixture(stale), /REPLAY_SNAPSHOT_MISMATCH/);
  const authorityLabel = fixture();
  authorityLabel.records[0].label.authority = 'system';
  assert.throws(() => normalizeFrictionReplayFixture(authorityLabel), /REPLAY_LABEL_AUTHORITY_MUTATION/);
  const leaked = fixture();
  leaked.records[0].event.reusable = true;
  assert.throws(() => normalizeFrictionReplayFixture(leaked), /REPLAY_EVENT_GOLD_LABEL_LEAK/);
  const authorityEvent = fixture();
  authorityEvent.records[0].event.current_truth = true;
  assert.throws(() => normalizeFrictionReplayFixture(authorityEvent), /EVENT_AUTHORITY_MUTATION/);
});

test('labels are independent scoring annotations and cannot mint evidence', () => {
  const input = fixture();
  const baseline = replayFrictionPolicies(input, { policies: ['friction_only'] });
  input.records[0].label = { reusable: true, candidate_quality: 1, distill_cost_units: 1, reviewer_ref: 'review-independent' };
  const report = replayFrictionPolicies(input, { policies: ['friction_only'] });
  const dev = report.policies.friction_only.development;
  assert.deepEqual(report.policies.friction_only.development.selected_event_ids, baseline.policies.friction_only.development.selected_event_ids);
  assert.equal(dev.authority, 'none');
  assert.equal(dev.current_truth, false);
  assert.equal(dev.utility_only, true);
  assert.equal(dev.metrics.trigger_precision, 1 / 2);
  assert.equal(dev.metrics.downstream_candidate_quality.selected_quality_sum, 1);
});

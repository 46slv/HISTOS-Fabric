import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  adaptCodexEvent,
  adaptOpenCodeEvent,
  canonical,
  createEvidenceEventJournal,
  createPersistentEvidenceEventJournal,
  digest,
  normalizeEvidenceEvent,
  normalizeVerifierEvent,
  selectEvidenceEvents,
  toA00Telemetry,
  toH03Telemetry,
  toH04Telemetry,
} from './evidence-events.mjs';

const scope = { scope_id: 'project-alpha', source_snapshot_sha256: 'a'.repeat(64) };
const source = { kind: 'source', path: 'fixtures/source.md', sha256: 'b'.repeat(64), bytes: 42, scope_id: scope.scope_id };
const artifact = { kind: 'artifact', ref_id: 'artifact-1', sha256: 'c'.repeat(64), bytes: 18, scope_id: scope.scope_id };
const base = overrides => ({
  scope,
  producer: { id: 'codex-adapter', kind: 'codex', version: '1.0' },
  producer_event_id: 'source-event-1',
  session_or_run_ref: 'session-1',
  occurred_at: '2026-09-09T01:02:03.000Z',
  observed_at: '2026-09-09T01:02:04.000Z',
  event_kind: 'command_or_test_result',
  source_snapshot_refs: [source],
  output_artifact_refs: [artifact],
  outcome: 'success',
  privacy_class: 'project',
  ...overrides,
});

test('normalizes a bounded event with exact refs, stable identity and non-authority marker', () => {
  const event = normalizeEvidenceEvent(base({ operation_signature: { operation_id: 'test-suite', name: 'test-suite', version: '1', semantic_steps: ['run', 'assert'] } }));
  assert.equal(event.schema, 'histos.evidence-event/v1');
  assert.match(event.event_id, /^event-[a-f0-9]{32}$/);
  assert.match(event.replay_identity.replay_key, /^[a-f0-9]{64}$/);
  assert.equal(event.scope.scope_id, scope.scope_id);
  assert.deepEqual(event.source_snapshot_refs, [{ kind: source.kind, path: source.path, sha256: source.sha256, bytes: source.bytes }]);
  assert.equal(event.operation_signature.scope_id, scope.scope_id);
  assert.equal(event.independence, 'unclassified');
  assert.ok(event.event_sha256 && event.byte_size > 0);
  assert.deepEqual(normalizeEvidenceEvent(base()), normalizeEvidenceEvent(base()));
});

test('Codex and OpenCode adapters converge on the same provider-neutral shape', () => {
  const codex = adaptCodexEvent(base({ producer: undefined, producer_id: 'codex', producer_version: '2', event_kind: 'tool_result' }));
  const openCode = adaptOpenCodeEvent(base({ producer: undefined, producer_id: 'opencode', producer_version: '2', event_kind: 'tool_result' }));
  for (const event of [codex, openCode]) {
    assert.equal(event.schema, codex.schema);
    assert.equal(event.event_kind, 'tool_result');
    assert.deepEqual(Object.keys(event).sort(), Object.keys(codex).sort());
    assert.equal(event.scope.scope_id, scope.scope_id);
  }
  assert.notEqual(codex.producer.kind, openCode.producer.kind);
});

test('journal de-duplicates exact replays and rejects conflicting IDs', () => {
  const journal = createEvidenceEventJournal({ scope, observed_at: '2026-09-09T01:02:04.000Z' });
  const one = journal.ingest(base({ observed_at: undefined }));
  const replay = journal.ingest(base({ observed_at: undefined }));
  assert.equal(one.accepted, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.replayed, false);
  assert.equal(journal.size(), 1);
  assert.throws(() => journal.ingest(base({ event_id: one.event.event_id, outcome: 'failure' })), /EVENT_ID_CONFLICT/);
  const replayedWithDifferentId = journal.ingest(base({ event_id: 'different-delivery', producer_event_id: undefined }));
  assert.equal(replayedWithDifferentId.duplicate, false);
  assert.equal(journal.size(), 2);
});

test('lineage and self/recall labels remain non-independent and cannot mint authority', () => {
  const self = normalizeEvidenceEvent(base({ evidence_class: 'SELF', event_id: 'self-event', lineage: { derived_from: 'source-event-1' }, event_kind: 'tool_result' }));
  const recall = normalizeEvidenceEvent(base({ evidence_class: 'RECALL', event_id: 'recall-event', lineage: { derived_from: 'source-event-1' }, event_kind: 'tool_result' }));
  assert.equal(self.independence, 'non_independent');
  assert.equal(recall.independence, 'non_independent');
  assert.throws(() => normalizeEvidenceEvent(base({ verified: true })), /EVENT_AUTHORITY_MUTATION/);
  assert.throws(() => normalizeEvidenceEvent(base({ current_truth: true })), /EVENT_AUTHORITY_MUTATION/);
  assert.throws(() => normalizeEvidenceEvent(base({ authority: 'system' })), /EVENT_AUTHORITY_MUTATION/);
});

test('scope, secret, transcript, malformed and stale references fail closed', () => {
  assert.throws(() => normalizeEvidenceEvent(base({ scope_id: 'other' })), /EVENT_SCOPE_MISMATCH|EVENT_SCOPE_REQUIRED|EVENT_REFERENCE_OUT_OF_SCOPE/);
  assert.throws(() => normalizeEvidenceEvent(base({ source_snapshot_refs: [{ ...source, scope_id: 'other' }] })), /EVENT_REFERENCE_OUT_OF_SCOPE/);
  assert.throws(() => normalizeEvidenceEvent(base({ source_snapshot_refs: [{ ...source, path: 'C:/outside.txt' }] })), /EVENT_REFERENCE_PATH_INVALID/);
  assert.throws(() => normalizeEvidenceEvent(base({ source_snapshot_refs: [{ ...source, sha256: 'not-a-hash' }] })), /EVENT_REFERENCE_SHA256_REQUIRED/);
  assert.throws(() => normalizeEvidenceEvent(base({ password: 'do-not-store' })), /EVENT_SECRET_PAYLOAD/);
  assert.throws(() => normalizeEvidenceEvent(base({ transcript: 'whole chat' })), /EVENT_TRANSCRIPT_PAYLOAD/);
  assert.throws(() => normalizeEvidenceEvent(base({ privacy_class: 'secret' })), /EVENT_SECRET_PRIVACY_CLASS/);
  assert.throws(() => normalizeEvidenceEvent(base({ event_kind: 'unknown-kind' })), /EVENT_KIND_INVALID/);
  assert.throws(() => normalizeEvidenceEvent(base({ occurred_at: 'yesterday' })), /EVENT_OCCURRED_AT_INVALID/);
});

test('friction and smooth-positive routes coexist without evidence promotion', () => {
  const friction = normalizeEvidenceEvent(base({ event_id: 'friction-event', event_kind: 'retry_or_repair', outcome: 'failure', friction: { tool_error_retry_count: 1 } }));
  const smooth = normalizeEvidenceEvent(base({ event_id: 'smooth-event', event_kind: 'successful_procedure', smooth_positive: true }));
  const selected = selectEvidenceEvents([friction, smooth]);
  assert.deepEqual(selected.map(item => item.route).sort(), ['friction', 'smooth_positive']);
  assert.ok(selected.every(item => item.authority === 'none' && item.current_truth === false));
  assert.equal(friction.routing.friction_score > 0, true);
  assert.equal(smooth.routing.smooth_positive, true);
});

test('telemetry adapters are bounded projections, not alternate authorities', () => {
  const event = normalizeVerifierEvent(base({ producer: undefined, producer_id: 'verifier-1', event_kind: undefined, verification_refs: [{ kind: 'independent_test', ref_id: 'test-receipt', sha256: 'd'.repeat(64), bytes: 20 }] }));
  const h03 = toH03Telemetry(event), h04 = toH04Telemetry(event), a00 = toA00Telemetry(event);
  assert.equal(h03.authority, 'none'); assert.equal(h03.current_truth, false);
  assert.equal(h04.authority, 'none'); assert.equal(h04.current_truth, false);
  assert.equal(a00.authority, 'none'); assert.equal(a00.current_truth, false); assert.equal(a00.activation.authorized, false);
  assert.equal(h04.fingerprint, event.event_sha256);
  assert.equal(a00.evidence[0].sha256, source.sha256);
});

test('canonical digest is deterministic and secret/transcript fields are never canonicalized into an event', () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.match(digest({ a: 1 }), /^[a-f0-9]{64}$/);
});

test('persistent journal survives a fresh instance and keeps replay/id conflict gates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'histos-evidence-journal-'));
  try {
    const first = createPersistentEvidenceEventJournal({ root, scope, observed_at: '2026-09-09T01:02:04.000Z' });
    const event = base({ observed_at: undefined, event_kind: 'operation_observation', operation_signature: { operation_id: 'normal-context', name: 'context_compile', version: '1', semantic_steps: ['context_search', 'context_compile'] } });
    const accepted = first.ingest(event);
    const duplicate = first.ingest(event);
    assert.equal(accepted.accepted, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(first.inspect().durable, true);
    assert.equal(first.list().length, 1);

    // A separately constructed journal models a process restart and must read
    // the same content-addressed event without an in-memory handoff.
    const restarted = createPersistentEvidenceEventJournal({ root, scope, observed_at: '2026-09-09T01:02:04.000Z' });
    assert.equal(restarted.size(), 1);
    assert.deepEqual(restarted.list(), first.list());
    assert.throws(() => restarted.ingest({ ...event, event_id: accepted.event.event_id, outcome: 'failure' }), /EVENT_ID_CONFLICT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

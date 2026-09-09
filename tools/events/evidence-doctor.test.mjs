import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEvidenceEventJournal, createPersistentEvidenceEventJournal } from './evidence-events.mjs';
import { doctorEvidenceJournal, EVIDENCE_DOCTOR_SCHEMA } from './evidence-event.mjs';

const scope = { scope_id: 'doctor-scope', source_snapshot_sha256: 'a'.repeat(64) };
const event = {
  scope,
  producer: { id: 'histos-test', kind: 'test', version: '1' },
  producer_event_id: 'doctor-event-1',
  session_or_run_ref: 'doctor-run-1',
  occurred_at: '2026-09-09T01:02:03.000Z',
  observed_at: '2026-09-09T01:02:04.000Z',
  event_kind: 'operation_observation',
  source_snapshot_refs: [{ kind: 'source', path: 'docs/README.md', sha256: 'b'.repeat(64), bytes: 10, scope_id: scope.scope_id }],
  outcome: 'success',
  privacy_class: 'project',
};

test('doctor reports all supplied lifecycle stages without granting authority', () => {
  const journal = createEvidenceEventJournal({ scope });
  const accepted = journal.ingest(event);
  const report = doctorEvidenceJournal({
    journal,
    used_count: 1,
    remembered: true,
    recallable: true,
    grounded: true,
    required_event_ids: [accepted.event.event_id],
  });
  assert.equal(report.schema, EVIDENCE_DOCTOR_SCHEMA);
  assert.equal(report.status, 'PASS');
  assert.equal(report.recording_gap, false);
  assert.deepEqual(report.stages, {
    USED: true,
    OBSERVED: true,
    PERSISTED: false,
    REMEMBERED: true,
    RECALLABLE: true,
    GROUNDED: true,
  });
  assert.equal(report.authority, 'none');
  assert.equal(report.current_truth, false);
});

test('fresh persistent-journal readback reports PERSISTED and never stores raw observations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'histos-doctor-'));
  try {
    const first = createPersistentEvidenceEventJournal({ root, scope });
    const accepted = first.ingest(event);
    const restarted = createPersistentEvidenceEventJournal({ root, scope });
    const report = doctorEvidenceJournal({ journal: restarted, required_event_ids: [accepted.event.event_id] });
    assert.equal(report.status, 'PASS');
    assert.equal(report.stages.PERSISTED, true);
    assert.equal(report.counts.persisted, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(report, 'prompt'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(report, 'completion'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('doctor fails closed with a recording gap when a used operation has no event', () => {
  const report = doctorEvidenceJournal({ journal: createEvidenceEventJournal({ scope }), used_count: 1 });
  assert.equal(report.status, 'RECORDING_GAP');
  assert.equal(report.recording_gap, true);
  assert.deepEqual(report.recording_gap_reasons, ['USED_WITHOUT_OBSERVED_EVENT']);
});

test('doctor does not accept authority or transcript-shaped observations', () => {
  const journal = createEvidenceEventJournal({ scope });
  assert.throws(() => doctorEvidenceJournal({ journal, observation: { authority: 'system' } }), /EVIDENCE_DOCTOR_UNSAFE_OBSERVATION/);
  assert.throws(() => doctorEvidenceJournal({ journal, remembered: { transcript: 'raw' } }), /EVIDENCE_DOCTOR_UNSAFE_OBSERVATION/);
});

test('persistent root and logical references fail closed at the physical boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'histos-doctor-root-'));
  const file = path.join(root, 'not-a-directory');
  try {
    fs.writeFileSync(file, 'not a journal directory', 'utf8');
    assert.throws(() => createPersistentEvidenceEventJournal({ root: file, scope }), /EVENT_JOURNAL_ROOT_UNSAFE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import { EVIDENCE_EVENT_SCHEMA } from './evidence-events.mjs';

export const EVIDENCE_DOCTOR_SCHEMA = 'histos.evidence-doctor/v1';
export const DOCTOR_STAGES = Object.freeze([
  'USED',
  'OBSERVED',
  'PERSISTED',
  'REMEMBERED',
  'RECALLABLE',
  'GROUNDED',
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const expandForbiddenKeys = keys => new Set([...keys, ...keys.map(key => key.replaceAll('_', ''))]);
const FORBIDDEN_KEYS = expandForbiddenKeys([
  'authority',
  'current_truth',
  'mission_state',
  'verified',
  'active',
  'activation',
  'permission',
  'prompt',
  'completion',
  'transcript',
  'raw_transcript',
  'messages',
  'conversation',
  'chat_history',
  'raw_input',
  'raw_output',
  'raw_text',
  'secret',
  'token',
  'access_token',
  'api_key',
  'credential',
  'cookie',
]);

function fail(code) {
  throw new Error(code);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeId(value, code) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
  return value;
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function safeObservation(value, code) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (!object(value)) fail(code);
  for (const key of Object.keys(value)) {
    const normalizedKey = key
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    const safetyKeys = new Set([normalizedKey, normalizedKey.replaceAll('_', ''), key.toLowerCase().replace(/[\s_-]+/g, '')]);
    if ([...safetyKeys].some(candidate => FORBIDDEN_KEYS.has(candidate))) fail('EVIDENCE_DOCTOR_UNSAFE_OBSERVATION');
  }
  return value.status === 'PASS' || value.status === 'OK' || value.available === true || value.present === true;
}

function journalSnapshot(journal) {
  if (!journal || typeof journal.inspect !== 'function' || typeof journal.list !== 'function') {
    fail('EVIDENCE_DOCTOR_JOURNAL_REQUIRED');
  }
  const inspected = journal.inspect();
  if (!object(inspected) || inspected.schema !== 'histos.evidence-event-journal/v1') {
    fail('EVIDENCE_DOCTOR_JOURNAL_INVALID');
  }
  const events = journal.list();
  if (!Array.isArray(events) || events.some(event => !object(event) || event.schema !== EVIDENCE_EVENT_SCHEMA)) {
    fail('EVIDENCE_DOCTOR_JOURNAL_INVALID');
  }
  return { inspected, events };
}

/**
 * Produce a read-only evidence health view.
 *
 * The doctor reports which lifecycle observations were supplied or persisted;
 * it never promotes evidence, asserts current truth, changes Mission state or
 * infers REMEMBERED/RECALLABLE/GROUNDED from event frequency.
 */
export function doctorEvidenceJournal({
  journal,
  used_count = 0,
  usedCount,
  remembered = false,
  recallable = false,
  grounded = false,
  required_event_ids = [],
  requiredEventIds,
  observation = null,
} = {}) {
  const { inspected, events } = journalSnapshot(journal);
  const used = nonNegativeInteger(usedCount ?? used_count, 'EVIDENCE_DOCTOR_USED_COUNT_INVALID');
  const required = requiredEventIds ?? required_event_ids;
  if (!Array.isArray(required) || required.length > 10_000) fail('EVIDENCE_DOCTOR_REQUIRED_IDS_INVALID');
  const requiredIds = [...new Set(required.map(value => safeId(value, 'EVIDENCE_DOCTOR_REQUIRED_ID_INVALID')))].sort();
  const present = new Set(events.map(event => event.event_id));
  const missing = requiredIds.filter(eventId => !present.has(eventId));
  const persisted = inspected.durable === true;
  const observed = events.length > 0;
  const safeRemembered = safeObservation(remembered, 'EVIDENCE_DOCTOR_REMEMBERED_INVALID');
  const safeRecallable = safeObservation(recallable, 'EVIDENCE_DOCTOR_RECALLABLE_INVALID');
  const safeGrounded = safeObservation(grounded, 'EVIDENCE_DOCTOR_GROUNDED_INVALID');
  const suppliedObservation = safeObservation(observation, 'EVIDENCE_DOCTOR_OBSERVATION_INVALID');
  const recordingGap = (used > 0 && !observed) || missing.length > 0;
  const stages = Object.freeze({
    USED: used > 0,
    OBSERVED: observed,
    PERSISTED: persisted,
    REMEMBERED: safeRemembered,
    RECALLABLE: safeRecallable,
    GROUNDED: safeGrounded,
  });
  const status = recordingGap ? 'RECORDING_GAP' : (persisted || observed || suppliedObservation ? 'PASS' : 'INCOMPLETE');
  return Object.freeze({
    schema: EVIDENCE_DOCTOR_SCHEMA,
    status,
    recording_gap: recordingGap,
    recording_gap_reasons: Object.freeze([
      ...(used > 0 && !observed ? ['USED_WITHOUT_OBSERVED_EVENT'] : []),
      ...(missing.length > 0 ? ['REQUIRED_EVENT_MISSING'] : []),
    ]),
    scope: inspected.scope ?? null,
    stages,
    counts: Object.freeze({
      used,
      observed: events.length,
      persisted: persisted ? events.length : 0,
      required: requiredIds.length,
      missing: missing.length,
    }),
    missing_event_ids: Object.freeze(missing),
    authority: 'none',
    current_truth: false,
  });
}

export const inspectEvidenceHealth = doctorEvidenceJournal;
export const runEvidenceDoctor = doctorEvidenceJournal;

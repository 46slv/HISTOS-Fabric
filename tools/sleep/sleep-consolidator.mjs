import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, lstat, realpath, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { readMemoryRecord } from '../memory/evidence-memory.mjs';
import { readCompiledUnderstanding } from '../understanding/compiled-understanding.mjs';
import { createMemorySuppressionReader } from '../memory/suppression-index.mjs';

// H04 public host boundary; the implementation lives with H03's source-owned
// memory verifier so Sleep can consume it without gaining history access.
export { createMemorySuppressionReader } from '../memory/suppression-index.mjs';

const SCHEMA = 'histos.sleep-state/v1';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 10000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw new Error(code); };
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sleepDigest = value => createHash('sha256').update(canonical(value)).digest('hex');
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`INVALID_${name}`);
  return value;
}
async function safeRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('ABSOLUTE_SLEEP_ROOT_REQUIRED');
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) fail('UNSAFE_SLEEP_ROOT');
  return realpath(root);
}
async function readBounded(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) fail('UNSAFE_SLEEP_FILE');
  return JSON.parse(await readFile(file, 'utf8'));
}
async function syncWrite(file, data) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
async function withLock(root, work) {
  const lockPath = path.join(root, 'writer.lock');
  const owner = { pid: process.pid, host: hostname(), token: randomUUID() };
  try { await syncWrite(lockPath, JSON.stringify(owner)); }
  catch (error) { if (error.code === 'EEXIST') fail('SLEEP_WRITER_BUSY_RECOVERY_REQUIRED'); throw error; }
  try { return await work(); }
  finally {
    const existing = await readBounded(lockPath);
    if (existing.token !== owner.token) fail('SLEEP_LOCK_OWNERSHIP_LOST');
    await unlink(lockPath);
  }
}

// Explicit, fail-closed recovery only. A live/reused PID cannot be recovered.
export async function recoverSleepWriter({ root: inputRoot, expectedToken }) {
  const root = await safeRoot(inputRoot);
  const guard = path.join(root, 'recovery.lock');
  await syncWrite(guard, JSON.stringify({ pid: process.pid }));
  try {
    const lockPath = path.join(root, 'writer.lock');
    const owner = await readBounded(lockPath);
    if (!expectedToken || owner.token !== expectedToken || owner.host !== hostname()) fail('SLEEP_RECOVERY_IDENTITY_MISMATCH');
    integer(owner.pid, 1, 2 ** 31 - 1, 'OWNER_PID');
    try { process.kill(owner.pid, 0); fail('SLEEP_OWNER_STILL_ALIVE'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await unlink(lockPath);
    return { disposition: 'RECOVERED', owner };
  } finally { await unlink(guard); }
}

async function load(root, scopeId) {
  let envelope;
  try { envelope = await readBounded(path.join(root, 'state.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schema: SCHEMA, scope_id: scopeId, revision: 0, cursor: 0, events: [], pending: {}, candidates: {}, history: {}, tombstones: {}, runs: [], authority: 'none' };
  }
  const state = envelope.state;
  if (!state || state.schema !== SCHEMA || sleepDigest(state) !== envelope.sha256 || !Array.isArray(state.events) || state.events.length > MAX_EVENTS) fail('SLEEP_STATE_CORRUPT');
  if (state.scope_id !== scopeId) fail('SLEEP_SCOPE_MISMATCH');
  return state;
}
async function publish(root, state, fault) {
  state.revision++;
  const data = JSON.stringify({ state, sha256: sleepDigest(state) });
  if (Buffer.byteLength(data) > MAX_BYTES) fail('SLEEP_CAPACITY_EXCEEDED');
  const temp = path.join(root, `state.${randomUUID()}.tmp`);
  await syncWrite(temp, data);
  try {
    await fault?.('before_commit');
    await rename(temp, path.join(root, 'state.json'));
    await fault?.('after_commit');
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function normalizeEvent(event, scopeId) {
  if (!event || event.scope_id !== scopeId || !ID.test(event.id ?? '') || !ID.test(event.resource_id ?? '') || !['memory', 'understanding'].includes(event.kind) || !HASH.test(event.fingerprint ?? '')) fail('INVALID_SLEEP_EVENT');
  return { id: event.id, scope_id: scopeId, kind: event.kind, resource_id: event.resource_id, fingerprint: event.fingerprint,
    declared_bytes: integer(event.declared_bytes, 0, MAX_BYTES, 'DECLARED_BYTES') };
}
const resourceKey = event => `${event.kind}:${event.resource_id}`;

export async function enqueueSleep({ root: inputRoot, scopeId, events, fault }) {
  if (!ID.test(scopeId ?? '') || !Array.isArray(events) || !events.length || events.length > 1000) fail('INVALID_SLEEP_BATCH');
  const normalized = events.map(event => normalizeEvent(event, scopeId));
  const root = await safeRoot(inputRoot);
  return withLock(root, async () => {
    const state = await load(root, scopeId);
    let accepted = 0, duplicates = 0;
    for (const event of normalized) {
      const previous = state.events.find(item => item.event.id === event.id);
      if (previous) {
        if (sleepDigest(previous.event) !== sleepDigest(event)) fail('SLEEP_EVENT_ID_CONFLICT');
        duplicates++; continue;
      }
      if (state.events.length >= MAX_EVENTS) fail('SLEEP_CAPACITY_EXCEEDED');
      const sequence = state.events.length + 1;
      state.events.push({ sequence, event, disposition: 'pending' });
      const key = resourceKey(event), pending = state.pending[key];
      state.pending[key] = { event, sequences: [...(pending?.sequences ?? []), sequence], attempts: 0, reason: null };
      // Known change invalidates only this resource; historical payload is retained.
      if (state.candidates[key]) state.candidates[key].state = 'refresh_pending';
      accepted++;
    }
    if (accepted) await publish(root, state, fault);
    return { accepted, duplicates, revision: state.revision, pending: Object.keys(state.pending).length };
  });
}

function validateInspection(result, event) {
  if (!result || result.scope_id !== event.scope_id || result.fingerprint !== event.fingerprint || result.current_truth !== false || result.authority !== 'none') fail('SLEEP_INSPECTION_IDENTITY_MISMATCH');
  if (!Array.isArray(result.references) || !result.references.length || result.references.length > 128) fail('SLEEP_LINEAGE_REQUIRED');
  for (const ref of result.references) {
    if (!ref || !['source', 'evidence'].includes(ref.kind) || typeof ref.path !== 'string' || !ref.path || !HASH.test(ref.sha256 ?? '')) fail('SLEEP_LINEAGE_REQUIRED');
    integer(ref.bytes, 0, MAX_BYTES, 'REFERENCE_BYTES');
  }
  if (result.references.reduce((n, ref) => n + ref.bytes, 0) > event.declared_bytes) fail('SLEEP_DECLARED_BYTES_EXCEEDED');
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) fail('SLEEP_RESULT_TOO_LARGE');
  for (const ids of [result.relations?.contradicts, result.relations?.supersedes]) {
    if (!Array.isArray(ids) || ids.length > 128 || ids.some(id => !ID.test(id) || id === event.resource_id)) fail('SLEEP_INVALID_RELATIONS');
  }
  if (result.relations.supersedes.length && (!result.verified || !HASH.test(result.claim_sha256 ?? ''))) fail('SLEEP_UNVERIFIED_SUPERSESSION');
  return structuredClone(result);
}

function validateSuppression(projection, event) {
  if (Buffer.byteLength(JSON.stringify(projection) ?? '') > 256 * 1024) fail('SLEEP_RESULT_TOO_LARGE');
  if (!projection || projection.scope_id !== event.scope_id || projection.resource_id !== event.resource_id || projection.complete !== true || !HASH.test(projection.authority_sha256 ?? '') ||
      !Number.isSafeInteger(projection.authority_bytes) || projection.authority_bytes < 0 || !Array.isArray(projection.suppressions) || projection.suppressions.length > 128) fail('SLEEP_SUPPRESSION_AUTHORITY_INVALID');
  for (const marker of projection.suppressions) {
    if (marker.id !== event.resource_id || !ID.test(marker.superseded_by ?? '') || !HASH.test(marker.claim_sha256 ?? '') || !['active', 'unresolved'].includes(marker.state) ||
        !Array.isArray(marker.references) || marker.references.length === 0 || marker.references.length > 128) fail('SLEEP_SUPPRESSION_AUTHORITY_INVALID');
    for (const reference of marker.references) {
      if (!reference || !['source', 'evidence'].includes(reference.kind) || typeof reference.path !== 'string' || !reference.path || !HASH.test(reference.sha256 ?? '') ||
          !Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || reference.bytes > MAX_BYTES) fail('SLEEP_SUPPRESSION_AUTHORITY_INVALID');
    }
  }
  return structuredClone(projection);
}

export async function runSleep({ root: inputRoot, scopeId, inspect, maxResources = 8, maxDeclaredBytes = 1024 * 1024, maxMilliseconds = 1000, now = Date.now, fault }) {
  if (!ID.test(scopeId ?? '') || typeof inspect !== 'function' || typeof now !== 'function') fail('INVALID_SLEEP_RUN');
  integer(maxResources, 1, 100, 'RESOURCE_BUDGET');
  integer(maxDeclaredBytes, 0, MAX_BYTES, 'BYTE_BUDGET');
  integer(maxMilliseconds, 1, 60000, 'TIME_BUDGET');
  const root = await safeRoot(inputRoot);
  return withLock(root, async () => {
    const state = await load(root, scopeId), started = now();
    const receipt = { sequence: state.runs.length + 1, attempted: 0, processed: 0, failed: 0, coalesced: 0, admitted_declared_bytes: 0, model_calls: 0, elapsed_ms: 0, budget: { maxResources, maxDeclaredBytes, maxMilliseconds }, outcomes: [] };
    const pending = Object.entries(state.pending).sort((a, b) => a[1].attempts - b[1].attempts || a[1].sequences[0] - b[1].sequences[0]);
    for (const [key, item] of pending) {
      if (receipt.attempted >= maxResources || now() - started >= maxMilliseconds) break;
      if (receipt.admitted_declared_bytes + item.event.declared_bytes > maxDeclaredBytes) { item.reason = 'BYTE_BUDGET_DEFERRED'; continue; }
      receipt.attempted++; receipt.admitted_declared_bytes += item.event.declared_bytes;
      try {
        const inspected = await inspect(structuredClone(item.event));
        if (inspected?.suppressed === true) {
          if (item.event.kind !== 'memory' || inspected.fingerprint !== item.event.fingerprint) fail('SLEEP_INSPECTION_IDENTITY_MISMATCH');
          const projection = validateSuppression(inspected.suppression, item.event);
          if (!projection.suppressions.length) fail('SLEEP_SUPPRESSION_AUTHORITY_INVALID');
          state.tombstones[key] ??= [];
          for (const marker of projection.suppressions) {
            const retained = { ...marker, by: `memory:${marker.superseded_by}`, authority_sha256: projection.authority_sha256 };
            if (!state.tombstones[key].some(existing => sleepDigest(existing) === sleepDigest(retained))) state.tombstones[key].push(retained);
          }
          if (state.candidates[key]) state.candidates[key].state = 'suppressed';
        } else {
        const result = validateInspection(inspected, item.event);
        // Preserve authenticated supersession even if its replacement later goes stale.
        if (item.event.kind === 'memory' && result.verified) for (const id of result.relations.supersedes) {
          const target = `memory:${id}`;
          state.tombstones[target] ??= [];
          const marker = { by: key, claim_sha256: result.claim_sha256, references: result.references };
          if (!state.tombstones[target].some(existing => sleepDigest(existing) === sleepDigest(marker))) state.tombstones[target].push(marker);
        }
        const previous = state.candidates[key];
        if (previous && previous.fingerprint !== item.event.fingerprint) {
          state.history[key] ??= [];
          state.history[key].push({ ...previous, state: 'replaced' });
        }
        state.candidates[key] = { ...result, fingerprint: item.event.fingerprint, state: 'fresh', status: 'sleep_candidate', authority: 'none', current_truth: false, coverage_sequences: item.sequences };
        }
        for (const sequence of item.sequences) state.events[sequence - 1].disposition = sequence === item.sequences.at(-1) ? 'processed' : 'coalesced';
        receipt.coalesced += item.sequences.length - 1; receipt.processed++;
        delete state.pending[key];
        receipt.outcomes.push({ key, disposition: 'processed', sequences: item.sequences });
      } catch (error) {
        item.attempts++; item.reason = String(error.message).slice(0, 256);
        if (state.candidates[key]) state.candidates[key].state = 'stale';
        receipt.failed++; receipt.outcomes.push({ key, disposition: 'deferred', reason: item.reason });
      }
    }
    while (state.events[state.cursor] && state.events[state.cursor].disposition !== 'pending') state.cursor++;
    receipt.elapsed_ms = Math.max(0, now() - started);
    receipt.pending = Object.keys(state.pending).length;
    receipt.cursor = state.cursor;
    state.runs.push(receipt);
    await publish(root, state, fault);
    return receipt;
  });
}

export async function inspectSleep({ root: inputRoot, scopeId }) {
  if (!ID.test(scopeId ?? '')) fail('INVALID_SLEEP_SCOPE');
  const root = await safeRoot(inputRoot), state = await load(root, scopeId);
  const candidates = Object.entries(state.candidates).map(([key, value]) => ({ key, ...value, suppressed: Boolean(state.tombstones[key]?.length) }));
  const contradictions = [];
  for (const candidate of candidates) for (const id of candidate.relations.contradicts) contradictions.push({ from: candidate.key, to: `memory:${id}`, type: 'contradicts', state: candidate.state, claim_sha256: candidate.claim_sha256 });
  const groups = new Map();
  for (const candidate of candidates) {
    const identity = sleepDigest({ summary: candidate.summary ?? null, references: candidate.references, relations: candidate.relations });
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(candidate.key);
  }
  const duplicate_groups = [...groups.entries()].filter(([, keys]) => keys.length > 1).map(([identity, keys]) => ({ identity, keys: keys.sort(), independent_support_added: 0 }));
  return { ...state, candidates, contradictions, duplicate_groups, usable_candidates: candidates.filter(item => item.state === 'fresh' && !item.suppressed), coverage: { accepted: state.events.length, cursor: state.cursor, deferred: state.events.filter(item => item.disposition === 'pending').map(item => item.sequence) }, retention: 'Keep all input identities, replaced candidate lineage and supersession tombstones; fail closed at 10000 events or 16 MiB. No automatic source deletion.' };
}

// Public H03 adapter. Host supplies existing source-owned provenance policy.
// H03 performs source I/O; declared-byte admission is not an OS I/O quota.
export function createH03SleepInspector({ memory, understanding, readMemorySuppression }) {
  return async event => {
    if (event.kind === 'memory') {
      if (memory?.scope?.scope_id !== event.scope_id) fail('SLEEP_SCOPE_MISMATCH');
      // An individually fresh record can still be superseded by a stale or
      // deleted correction. H03 individual read alone cannot authorize reuse.
      if (typeof readMemorySuppression !== 'function') fail('SLEEP_SUPPRESSION_AUTHORITY_REQUIRED');
      const suppression = validateSuppression(await readMemorySuppression({ scope_id: event.scope_id, resource_id: event.resource_id }), event);
      if (suppression.suppressions.length) return { suppressed: true, fingerprint: event.fingerprint, suppression };
      const record = await readMemoryRecord({ ...memory, id: event.resource_id });
      if (record.status === 'deprecated') fail('SLEEP_MEMORY_DEPRECATED');
      return { scope_id: record.scope_id, fingerprint: sleepDigest(record), references: record.references,
        claim_sha256: record.verification.claim_sha256, verification: record.verification,
        verified: record.status === 'verified', relations: record.relations, summary: record.summary, authority: 'none', current_truth: false };
    }
    if (understanding?.scope?.scope_id !== event.scope_id) fail('SLEEP_SCOPE_MISMATCH');
    const object = await readCompiledUnderstanding({ ...understanding, key: event.resource_id });
    return { scope_id: object.scope_id, fingerprint: sleepDigest(object), references: object.dependencies,
      claim_sha256: null, verified: false, relations: { contradicts: [], supersedes: [] }, summary: object.summary, authority: 'none', current_truth: false };
  };
}

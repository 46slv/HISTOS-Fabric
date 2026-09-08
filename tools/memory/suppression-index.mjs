import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { recallMemory } from './evidence-memory.mjs';

/**
 * Source-owned incoming-suppression projection for the H04 Sleep boundary.
 *
 * The index is a bounded, rebuildable cache of H03's authenticated
 * supersession tombstones.  It is deliberately not a second memory authority:
 * H03 `recallMemory()` is the only source used to rebuild it, and this module
 * never promotes a candidate or invents provenance.
 */

export const SUPPRESSION_INDEX_SCHEMA = 'histos.memory-suppression-index/v1';
export const SUPPRESSION_AUTHORITY_SCHEMA = 'histos.memory-suppression-authority/v1';
export const SUPPRESSION_INDEX_FILE_SCHEMA = 'histos.memory-suppression-index-file/v1';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_ID_BYTES = 128;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_SUBJECTS = 10000;
const MAX_SUPPRESSIONS = 128;
const MAX_PROJECTION_BYTES = 256 * 1024;
const INDEX_FILE = 'index.json';

const fail = code => { throw new Error(code); };

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonical(value) { return JSON.stringify(canonicalValue(value)); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function jsonDigest(value) { return digest(Buffer.from(canonical(value))); }

function boundedId(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_ID_BYTES) fail(`MEMORY_SUPPRESSION_${label}_OVERSIZED`);
  if (!ID.test(value)) fail(`MEMORY_SUPPRESSION_${label}_INVALID`);
  return value;
}

function normalizeScopeId(value) { return boundedId(value, 'SCOPE'); }
function normalizeResourceId(value) { return boundedId(value, 'SUBJECT'); }

function normalizeReference(reference) {
  if (!reference || !['source', 'evidence'].includes(reference.kind) || typeof reference.path !== 'string' || !reference.path ||
      path.isAbsolute(reference.path) || reference.path.includes(':') || reference.path.replaceAll('\\', '/').split('/').some(part => !part || part === '.' || part === '..') ||
      !HASH.test(reference.sha256 ?? '') || !Number.isSafeInteger(reference.bytes) || reference.bytes < 0) {
    fail('MEMORY_SUPPRESSION_REFERENCE_INVALID');
  }
  const result = { kind: reference.kind, path: reference.path, sha256: reference.sha256, bytes: reference.bytes };
  if (reference.start_line !== undefined || reference.end_line !== undefined) {
    if (!Number.isSafeInteger(reference.start_line) || !Number.isSafeInteger(reference.end_line) ||
        reference.start_line < 1 || reference.end_line < reference.start_line) fail('MEMORY_SUPPRESSION_REFERENCE_INVALID');
    result.start_line = reference.start_line;
    result.end_line = reference.end_line;
  }
  return result;
}

function normalizeMarker(marker, scopeId, expectedId) {
  if (!marker || marker.id !== expectedId || !ID.test(marker.superseded_by ?? '') ||
      !HASH.test(marker.claim_sha256 ?? '') || !['active', 'unresolved'].includes(marker.state) ||
      !Array.isArray(marker.references) || marker.references.length === 0 || marker.references.length > MAX_SUPPRESSIONS) {
    fail('MEMORY_SUPPRESSION_MARKER_INVALID');
  }
  const references = marker.references.map(normalizeReference);
  const result = {
    id: expectedId,
    superseded_by: marker.superseded_by,
    claim_sha256: marker.claim_sha256,
    state: marker.state,
    references,
  };
  if (marker.reason !== undefined && marker.reason !== null) {
    if (typeof marker.reason !== 'string' || marker.reason.length > 256) fail('MEMORY_SUPPRESSION_MARKER_INVALID');
    result.reason = marker.reason;
  } else {
    result.reason = null;
  }
  // scopeId is intentionally consumed here so callers cannot accidentally
  // normalize a marker from another authority scope into this index.
  if (!scopeId) fail('MEMORY_SUPPRESSION_SCOPE_INVALID');
  return result;
}

function normalizeMemoryOptions(memory) {
  if (!memory || typeof memory !== 'object') fail('MEMORY_SUPPRESSION_MEMORY_OPTIONS_REQUIRED');
  if (!memory.scope || typeof memory.scope !== 'object') fail('MEMORY_SUPPRESSION_SCOPE_REQUIRED');
  const scope_id = normalizeScopeId(memory.scope.scope_id);
  return { ...memory, scope: { ...memory.scope, scope_id } };
}

async function safeRoot(inputRoot, missingCode = 'MEMORY_SUPPRESSION_INDEX_ROOT_REQUIRED', create = true) {
  if (typeof inputRoot !== 'string' || !path.isAbsolute(inputRoot)) fail(missingCode);
  if (create) {
    try { await mkdir(inputRoot, { recursive: true }); } catch { fail('MEMORY_SUPPRESSION_INDEX_ROOT_INVALID'); }
  }
  let stat;
  try { stat = await lstat(inputRoot); } catch { fail('MEMORY_SUPPRESSION_INDEX_ROOT_MISSING'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('MEMORY_SUPPRESSION_INDEX_UNSAFE_ROOT');
  return realpath(inputRoot);
}

async function writeAtomic(root, envelope) {
  const data = `${JSON.stringify(envelope, null, 2)}\n`;
  if (Buffer.byteLength(data) > MAX_INDEX_BYTES) fail('MEMORY_SUPPRESSION_INDEX_OVERSIZED');
  const temporary = path.join(root, `.index.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path.join(root, INDEX_FILE));
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { bytes: Buffer.byteLength(data), sha256: digest(Buffer.from(data)) };
}

async function readIndexEnvelope(root) {
  const file = path.join(root, INDEX_FILE);
  let stat;
  try { stat = await lstat(file); }
  catch (error) { if (error?.code === 'ENOENT') fail('MEMORY_SUPPRESSION_INDEX_MISSING'); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX_BYTES) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  let envelope;
  try { envelope = JSON.parse(await readFile(file, 'utf8')); } catch { fail('MEMORY_SUPPRESSION_INDEX_CORRUPT'); }
  if (!envelope || envelope.schema !== SUPPRESSION_INDEX_FILE_SCHEMA || !envelope.state || !HASH.test(envelope.state_sha256 ?? '') ||
      jsonDigest(envelope.state) !== envelope.state_sha256) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  return envelope.state;
}

function validateAuthority(state) {
  if (!state || state.schema !== SUPPRESSION_INDEX_SCHEMA || !ID.test(state.scope_id ?? '') ||
      !state.authority || state.authority.schema !== SUPPRESSION_AUTHORITY_SCHEMA ||
      state.authority.scope_id !== state.scope_id || !HASH.test(state.authority_sha256 ?? '') ||
      !Number.isSafeInteger(state.authority_bytes) || state.authority_bytes < 0 || state.authority_bytes > MAX_INDEX_BYTES ||
      jsonDigest(state.authority) !== state.authority_sha256 ||
      Buffer.byteLength(canonical(state.authority)) !== state.authority_bytes ||
      !Array.isArray(state.authority.subjects) || state.authority.subjects.length > MAX_SUBJECTS ||
      new Set(state.authority.subjects).size !== state.authority.subjects.length) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  for (const id of state.authority.subjects) normalizeResourceId(id);
  if (!Array.isArray(state.authority.supersessions) || state.authority.supersessions.length > MAX_SUBJECTS * MAX_SUPPRESSIONS) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  const markerIdentities = new Set();
  for (const marker of state.authority.supersessions) {
    const normalized = normalizeMarker(marker, state.scope_id, marker?.id);
    const identity = `${normalized.id}\u0000${normalized.superseded_by}\u0000${normalized.claim_sha256}`;
    if (markerIdentities.has(identity)) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
    markerIdentities.add(identity);
    if (!state.authority.subjects.includes(normalized.id) || !state.authority.subjects.includes(normalized.superseded_by)) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  }
  if (!state.subjects || typeof state.subjects !== 'object' || Array.isArray(state.subjects)) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  const subjectIds = Object.keys(state.subjects).sort();
  if (subjectIds.length !== state.authority.subjects.length || subjectIds.some((id, index) => id !== [...state.authority.subjects].sort()[index])) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  for (const id of subjectIds) {
    normalizeResourceId(id);
    const subject = state.subjects[id];
    if (!subject || subject.resource_id !== id || !Array.isArray(subject.suppressions) || subject.suppressions.length > MAX_SUPPRESSIONS) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
    for (const marker of subject.suppressions) normalizeMarker(marker, state.scope_id, id);
    const expected = state.authority.supersessions.filter(marker => marker.id === id);
    if (canonical(subject.suppressions) !== canonical(expected)) fail('MEMORY_SUPPRESSION_INDEX_CORRUPT');
  }
  return state;
}

function projectionFromState(state, resourceId) {
  const subject = state.subjects[resourceId];
  if (!subject) fail('MEMORY_SUPPRESSION_SUBJECT_MISSING');
  const projection = {
    schema: 'histos.memory-suppression-projection/v1',
    scope_id: state.scope_id,
    resource_id: resourceId,
    complete: true,
    authority_sha256: state.authority_sha256,
    authority_bytes: state.authority_bytes,
    suppressions: structuredClone(subject.suppressions),
  };
  if (Buffer.byteLength(JSON.stringify(projection)) > MAX_PROJECTION_BYTES) fail('MEMORY_SUPPRESSION_PROJECTION_OVERSIZED');
  return projection;
}

/**
 * Build (or rebuild) the source-owned index from the public H03 memory API.
 * A failed H03 read never replaces the last committed index.
 */
export async function rebuildMemorySuppressionIndex({ indexRoot: inputIndexRoot, memory, maxSubjects = MAX_SUBJECTS, ...directMemory }) {
  const indexRoot = await safeRoot(inputIndexRoot);
  const memoryOptions = normalizeMemoryOptions(memory ?? directMemory);
  if (!Number.isSafeInteger(maxSubjects) || maxSubjects < 1 || maxSubjects > MAX_SUBJECTS) fail('MEMORY_SUPPRESSION_SUBJECT_BUDGET_INVALID');

  // H03 remains authoritative. In particular, unresolved correction evidence
  // is returned as a marker; it is never converted into an empty projection.
  const recalled = await recallMemory({ ...memoryOptions, query: '', includeCandidates: true });
  if (!recalled || recalled.scope?.scope_id !== memoryOptions.scope.scope_id || !Array.isArray(recalled.supersessions) || !Array.isArray(recalled.records)) fail('MEMORY_SUPPRESSION_AUTHORITY_INVALID');
  const scope_id = memoryOptions.scope.scope_id;
  const supersessions = recalled.supersessions.map(marker => normalizeMarker(marker, scope_id, marker?.id));
  const subjectIds = new Set(recalled.records.map(item => item?.record?.id).filter(Boolean));
  for (const marker of supersessions) {
    subjectIds.add(marker.id);
    subjectIds.add(marker.superseded_by);
  }
  if (subjectIds.size > maxSubjects) fail('MEMORY_SUPPRESSION_SUBJECT_BUDGET_EXCEEDED');
  const subjects = Object.create(null);
  for (const id of [...subjectIds].sort()) {
    normalizeResourceId(id);
    subjects[id] = { resource_id: id, suppressions: supersessions.filter(marker => marker.id === id) };
  }
  const authority = {
    schema: SUPPRESSION_AUTHORITY_SCHEMA,
    scope_id,
    subjects: Object.keys(subjects),
    supersessions,
  };
  const state = {
    schema: SUPPRESSION_INDEX_SCHEMA,
    scope_id,
    authority,
    authority_sha256: jsonDigest(authority),
    authority_bytes: Buffer.byteLength(canonical(authority)),
    subjects,
  };
  validateAuthority(state);
  const envelope = { schema: SUPPRESSION_INDEX_FILE_SCHEMA, state, state_sha256: jsonDigest(state) };
  const published = await writeAtomic(indexRoot, envelope);
  return {
    schema: 'histos.memory-suppression-rebuild/v1',
    disposition: 'REBUILT',
    scope_id,
    subjects: Object.keys(subjects).length,
    suppressions: supersessions.length,
    authority_sha256: state.authority_sha256,
    authority_bytes: state.authority_bytes,
    index_bytes: published.bytes,
    index_sha256: published.sha256,
  };
}

export const buildMemorySuppressionIndex = rebuildMemorySuppressionIndex;

/** Return one bounded, complete projection for a subject in the requested scope. */
export async function readMemorySuppression({ indexRoot: inputIndexRoot, scope_id, resource_id, scopeId, resourceId }) {
  const requestedScope = normalizeScopeId(scope_id ?? scopeId);
  const requestedResource = normalizeResourceId(resource_id ?? resourceId);
  const indexRoot = await safeRoot(inputIndexRoot, 'MEMORY_SUPPRESSION_INDEX_ROOT_REQUIRED', false);
  const state = validateAuthority(await readIndexEnvelope(indexRoot));
  if (state.scope_id !== requestedScope) fail('MEMORY_SUPPRESSION_SCOPE_MISMATCH');
  return projectionFromState(state, requestedResource);
}

/** Bind the source-owned index and scope before passing a callback to Sleep. */
function readerConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('MEMORY_SUPPRESSION_READER_OPTIONS_REQUIRED');
  const memory = input.memory && typeof input.memory === 'object' && !Array.isArray(input.memory) ? input.memory : null;
  const indexRoot = input.indexRoot ?? input.index_root;
  if (typeof indexRoot !== 'string' || !path.isAbsolute(indexRoot)) fail('MEMORY_SUPPRESSION_INDEX_ROOT_REQUIRED');
  const boundScope = normalizeScopeId(input.scopeId ?? input.scope_id ?? memory?.scope?.scope_id);
  return { indexRoot, boundScope, memory };
}

function readerMetadata(state) {
  return {
    scope_id: state.scope_id,
    complete: true,
    authority_sha256: state.authority_sha256,
    authority_bytes: state.authority_bytes,
    subjects: state.authority.subjects.length,
    suppressions: state.authority.supersessions.length,
  };
}

/**
 * Bind the source-owned index and scope before passing a callback to Sleep.
 *
 * When memory options are supplied, `refresh()` rebuilds the persisted index
 * from one H03 `recallMemory()` snapshot and then materializes the validated
 * subjects map in memory. Without memory options, refresh only reloads an
 * already source-owned persisted index. Neither path reads the full index or
 * memory history during individual subject lookups.
 */
export function createMemorySuppressionReader(input) {
  let config = readerConfig(input);
  let state = null;
  let subjects = null;
  let refreshes = 0;
  let lookups = 0;
  let refreshChain = Promise.resolve();
  let initialLoad = null;

  const materialize = loaded => {
    if (loaded.scope_id !== config.boundScope) fail('MEMORY_SUPPRESSION_SCOPE_MISMATCH');
    // `validateAuthority` has already checked canonical hashes, complete
    // subject coverage and exact marker/reference identities. Keep only the
    // immutable subject map for bounded lookups; callers receive clones.
    const byId = new Map(Object.entries(loaded.subjects).map(([id, subject]) => [id, subject.suppressions]));
    state = loaded;
    subjects = byId;
  };

  const loadPersisted = async () => validateAuthority(await readIndexEnvelope(await safeRoot(config.indexRoot)));

  const read = async request => {
    if (!request || typeof request !== 'object' || Array.isArray(request) || request.scope_id !== config.boundScope) {
      fail('MEMORY_SUPPRESSION_SCOPE_MISMATCH');
    }
    if (typeof request.resource_id !== 'string' || !ID.test(request.resource_id)) fail('MEMORY_SUPPRESSION_SUBJECT_INVALID');
    if (!state || !subjects) {
      // A reader bound only to an existing index may lazily load it once for
      // compatibility. A source-owned memory reader must be explicitly
      // refreshed, avoiding an implicit recall during a Sleep delta.
      if (!config.memory) {
        initialLoad ??= reader.refresh().finally(() => { initialLoad = null; });
        await initialLoad;
      }
      if (!state || !subjects) fail('MEMORY_SUPPRESSION_SNAPSHOT_REQUIRED');
    }
    const suppressions = subjects.get(request.resource_id);
    if (!suppressions) fail('MEMORY_SUPPRESSION_SUBJECT_MISSING');
    lookups++;
    return {
      schema: 'histos.memory-suppression-projection/v1',
      scope_id: config.boundScope,
      resource_id: request.resource_id,
      complete: true,
      authority_sha256: state.authority_sha256,
      authority_bytes: state.authority_bytes,
      suppressions: structuredClone(suppressions),
    };
  };

  const reader = async request => read(request);
  reader.read = read;
  reader.lookup = read;
  reader.refresh = nextInput => {
    const task = refreshChain.then(async () => {
      const next = nextInput === undefined ? config : readerConfig({ ...config, ...nextInput, memory: nextInput?.memory ?? config.memory });
      config = next;
      // Never continue serving an older authority while source refresh is in
      // flight or after it fails closed.
      state = null;
      subjects = null;
      refreshes++;
      if (config.memory) {
        await rebuildMemorySuppressionIndex({ indexRoot: config.indexRoot, memory: config.memory });
      }
      const loaded = await loadPersisted();
      materialize(loaded);
      return structuredClone(readerMetadata(loaded));
    });
    refreshChain = task.catch(() => {});
    return task;
  };
  reader.refreshSnapshot = reader.refresh;
  reader.snapshot = () => {
    if (!state) fail('MEMORY_SUPPRESSION_SNAPSHOT_REQUIRED');
    return structuredClone({
      schema: SUPPRESSION_AUTHORITY_SCHEMA,
      scope_id: state.scope_id,
      subjects: state.authority.subjects,
      supersessions: state.authority.supersessions,
      authority_sha256: state.authority_sha256,
      authority_bytes: state.authority_bytes,
    });
  };
  reader.getStats = () => ({ refreshes, lookups, authority_sha256: state?.authority_sha256 ?? null });
  return reader;
}

export const createH03SuppressionReader = createMemorySuppressionReader;

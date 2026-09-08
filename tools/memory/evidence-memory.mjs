import { createHash } from 'node:crypto';
import { link, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RECORD_SCHEMA = 'histos.memory-record/v0';
const FILE_SCHEMA = 'histos.memory-file/v0';
const EXPORT_SCHEMA = 'histos.memory-export/v0';
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KINDS = new Set(['episode', 'semantic', 'failure', 'procedure', 'decision_reference']);
const STATUSES = new Set(['candidate', 'verified', 'deprecated']);
const PROVENANCE_KINDS = new Set([
  'source', 'runtime_observation', 'independent_test', 'immutable_receipt',
  'retrieved_memory', 'model_restatement', 'tool_output', 'hypothesis', 'compiled_material',
]);
const INDEPENDENT_SUPPORT = new Set(['source', 'runtime_observation', 'independent_test', 'immutable_receipt']);

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw new Error(code); }
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}
function canonical(value) { return JSON.stringify(canonicalValue(value)); }
function assertTimestamp(value, code) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
}
function relativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes(':')) fail('INVALID_REFERENCE_PATH');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) fail('INVALID_REFERENCE_PATH');
  return normalized;
}
function uniqueStrings(values, code) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) fail(code);
  if (new Set(values).size !== values.length) fail(code);
  return [...values];
}
function normalizeScope(scope) {
  if (!scope || typeof scope.scope_id !== 'string' || !scope.scope_id.trim()) fail('INVALID_MEMORY_SCOPE');
  const sourcePaths = uniqueStrings(scope.source_paths ?? [], 'INVALID_MEMORY_SCOPE').map(relativePath).sort();
  const evidencePaths = uniqueStrings(scope.evidence_paths ?? [], 'INVALID_MEMORY_SCOPE').map(relativePath).sort();
  return { scope_id: scope.scope_id, source_paths: sourcePaths, evidence_paths: evidencePaths };
}
function normalizeRelations(relations = {}) {
  const contradicts = uniqueStrings(relations.contradicts ?? [], 'INVALID_MEMORY_RELATIONS');
  const supersedes = uniqueStrings(relations.supersedes ?? [], 'INVALID_MEMORY_RELATIONS');
  if ([...contradicts, ...supersedes].some((id) => !ID_RE.test(id))) fail('INVALID_MEMORY_RELATIONS');
  if (contradicts.some((id) => supersedes.includes(id))) fail('INVALID_MEMORY_RELATIONS');
  return { contradicts: contradicts.sort(), supersedes: supersedes.sort() };
}
function normalizeRef(ref) {
  if (!ref || !['source', 'evidence'].includes(ref.kind)) fail('INVALID_MEMORY_REFERENCE');
  const normalized = {
    kind: ref.kind,
    path: relativePath(ref.path),
    sha256: ref.sha256,
    bytes: ref.bytes,
    lineage_id: ref.lineage_id,
    provenance_kind: ref.provenance_kind,
    supports_claim: ref.supports_claim === true,
  };
  if (!SHA256_RE.test(normalized.sha256 ?? '') || !Number.isSafeInteger(normalized.bytes) || normalized.bytes < 0) fail('INVALID_MEMORY_REFERENCE');
  if (typeof normalized.lineage_id !== 'string' || !normalized.lineage_id.trim() || !PROVENANCE_KINDS.has(normalized.provenance_kind)) fail('INVALID_MEMORY_REFERENCE');
  if (ref.start_line !== undefined || ref.end_line !== undefined) {
    if (!Number.isSafeInteger(ref.start_line) || !Number.isSafeInteger(ref.end_line) || ref.start_line < 1 || ref.end_line < ref.start_line) fail('INVALID_MEMORY_REFERENCE');
    normalized.start_line = ref.start_line;
    normalized.end_line = ref.end_line;
  }
  return normalized;
}
function evidenceIdentity(ref) {
  const { kind, path, sha256, bytes, start_line, end_line } = normalizeRef(ref);
  return { kind, path, sha256, bytes, ...(start_line === undefined ? {} : { start_line, end_line }) };
}
// The host computes this subject BEFORE source-owned approval. Caller provenance
// labels are deliberately excluded: only the verifier may attest their meaning.
export function memoryClaimSha256({ scope, record }) {
  return digest(Buffer.from(canonical({
    scope_id: normalizeScope(scope).scope_id,
    id: record.id, kind: record.kind, title: record.title, summary: record.summary,
    details: record.details, status: record.status, confidence: record.confidence,
    provenance_kind: record.provenance_kind ?? 'evidence_linked_record',
    references: record.references.map(evidenceIdentity),
    relations: normalizeRelations(record.relations),
    created_at: record.created_at, last_verified_at: record.last_verified_at,
    applicability: { versions: record.applicability?.versions ?? [], runtimes: record.applicability?.runtimes ?? [] },
    requires_fresh_read: record.requires_fresh_read !== false,
  })));
}
function normalizeAttestation(value, expected) {
  if (value === null || value === undefined) return null;
  if (!value || value.scope_id !== expected.scope_id || value.claim_sha256 !== expected.claim_sha256 ||
      canonical(value.reference) !== canonical(expected.reference) || !PROVENANCE_KINDS.has(value.provenance_kind) ||
      !SHA256_RE.test(value.origin_sha256 ?? '') || typeof value.lineage_id !== 'string' || !value.lineage_id ||
      typeof value.supports_claim !== 'boolean') fail('INVALID_TRUSTED_PROVENANCE');
  return { ...expected, provenance_kind: value.provenance_kind, origin_sha256: value.origin_sha256,
    lineage_id: value.lineage_id, supports_claim: value.supports_claim };
}
async function verifySupport(record, { scope, verifyProvenance }) {
  if (verifyProvenance !== undefined && typeof verifyProvenance !== 'function') fail('INVALID_PROVENANCE_VERIFIER');
  const claim_sha256 = memoryClaimSha256({ scope, record });
  const attestations = [];
  for (const ref of record.references) {
    const expected = { scope_id: scope.scope_id, claim_sha256, reference: evidenceIdentity(ref) };
    // Give the host a detached request so a verifier cannot mutate the stored subject.
    const result = verifyProvenance ? await verifyProvenance(structuredClone(expected)) : null;
    attestations.push(normalizeAttestation(result, expected));
  }
  // Connected components avoid counting aliases, copied bytes or shared origin
  // digests as independent, even if trusted labels accidentally differ.
  const supporting = attestations.map((attestation, i) => ({ attestation, ref: record.references[i] }))
    .filter(({ attestation }) => attestation?.supports_claim && INDEPENDENT_SUPPORT.has(attestation.provenance_kind));
  const components = [];
  for (const { attestation, ref } of supporting) {
    const keys = new Set([`lineage:${attestation.lineage_id}`, `origin:${attestation.origin_sha256}`, `bytes:${ref.sha256}`]);
    for (let i = components.length - 1; i >= 0; i--) {
      if ([...keys].some((key) => components[i].has(key))) {
        for (const key of components.splice(i, 1)[0]) keys.add(key);
        i = components.length; // rescan after a transitive union
      }
    }
    components.push(keys);
  }
  const independentLineages = components.map((keys) => [...keys].filter((key) => key.startsWith('lineage:')).sort()[0].slice(8)).sort();
  if (record.status === 'verified' && !independentLineages.length) fail('INSUFFICIENT_INDEPENDENT_SUPPORT');
  return {
    claim_sha256, attestations,
    independent_support_count: independentLineages.length,
    independent_lineage_ids: independentLineages,
    excluded_support_count: attestations.length - supporting.length,
    rule: 'Only host-verified claim-bound provenance counts; shared lineage, origin digest or exact evidence digest is one support component.',
  };
}
async function resolveInside(root, relative, missingCode = 'REFERENCE_MISSING') {
  if (typeof root !== 'string' || !root) fail('REFERENCE_ROOT_REQUIRED');
  let rootReal;
  try { rootReal = await realpath(root); } catch { fail('REFERENCE_ROOT_MISSING'); }
  let absolute;
  try { absolute = await realpath(path.resolve(rootReal, relative)); }
  catch (error) { if (error?.code === 'ENOENT') fail(missingCode); throw error; }
  const remainder = path.relative(rootReal, absolute);
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) fail('REFERENCE_OUT_OF_SCOPE');
  if (!(await lstat(absolute)).isFile()) fail('REFERENCE_NOT_FILE');
  return absolute;
}
async function validateReference(ref, { scope, sourceRoot, evidenceRoot }) {
  const allowed = ref.kind === 'source' ? scope.source_paths : scope.evidence_paths;
  if (!allowed.includes(ref.path)) fail('REFERENCE_OUT_OF_SCOPE');
  const absolute = await resolveInside(ref.kind === 'source' ? sourceRoot : evidenceRoot, ref.path);
  const bytes = await readFile(absolute);
  if (bytes.byteLength !== ref.bytes || digest(bytes) !== ref.sha256) fail('REFERENCE_STALE_OR_FORGED');
  if (ref.end_line !== undefined) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('REFERENCE_NOT_UTF8'); }
    if (ref.end_line > text.split(/\r?\n/).length) fail('REFERENCE_RANGE_OUT_OF_BOUNDS');
  }
  return true;
}
function recordPath(memoryRoot, id) {
  if (typeof memoryRoot !== 'string' || !memoryRoot) fail('INVALID_MEMORY_ROOT');
  if (!ID_RE.test(id ?? '')) fail('INVALID_MEMORY_ID');
  return path.resolve(memoryRoot, 'records', `${id}.json`);
}
function validateEnvelope(envelope) {
  if (!envelope || envelope.schema !== FILE_SCHEMA || envelope.record?.schema !== RECORD_SCHEMA || !SHA256_RE.test(envelope.record_sha256 ?? '')) fail('MEMORY_CORRUPT');
  if (digest(Buffer.from(canonical(envelope.record))) !== envelope.record_sha256) fail('MEMORY_CORRUPT');
  const record = envelope.record;
  if (!ID_RE.test(record.id ?? '') || !KINDS.has(record.kind) || !STATUSES.has(record.status) || typeof record.scope_id !== 'string' || !record.scope_id) fail('MEMORY_CORRUPT');
  if (typeof record.title !== 'string' || typeof record.summary !== 'string' || typeof record.details !== 'string' || typeof record.confidence !== 'number') fail('MEMORY_CORRUPT');
  try { assertTimestamp(record.created_at, 'MEMORY_CORRUPT'); assertTimestamp(record.last_verified_at, 'MEMORY_CORRUPT'); }
  catch { fail('MEMORY_CORRUPT'); }
  if (!Array.isArray(record.references) || !record.references.length || !record.relations || !record.verification) fail('MEMORY_CORRUPT');
  let normalizedReferences;
  try { normalizedReferences = record.references.map(normalizeRef); } catch { fail('MEMORY_CORRUPT'); }
  if (canonical(normalizedReferences) !== canonical(record.references)) fail('MEMORY_CORRUPT');
  let normalizedRelations;
  try { normalizedRelations = normalizeRelations(record.relations); } catch { fail('MEMORY_CORRUPT'); }
  if (canonical(normalizedRelations) !== canonical(record.relations)) fail('MEMORY_CORRUPT');
  if (!SHA256_RE.test(record.verification.claim_sha256 ?? '') || !Array.isArray(record.verification.attestations)) fail('MEMORY_CORRUPT');
  if (record.authority !== 'none' || record.current_truth !== false || typeof record.requires_fresh_read !== 'boolean') fail('MEMORY_CORRUPT');
  return envelope.record;
}
async function loadRawRecord(memoryRoot, id) {
  let parsed;
  try { await assertStoreDirectory(memoryRoot, 'records'); parsed = JSON.parse(await readFile(await resolveInside(memoryRoot, `records/${id}.json`, 'MEMORY_MISSING'), 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error.message === 'MEMORY_MISSING') fail('MEMORY_MISSING'); fail('MEMORY_CORRUPT'); }
  const record = validateEnvelope(parsed);
  if (record.id !== id) fail('MEMORY_CORRUPT');
  return record;
}
async function validateRecord(record, context) {
  if (record.scope_id !== context.scope.scope_id) fail('MEMORY_SCOPE_MISMATCH');
  await Promise.all(record.references.map((ref) => validateReference(ref, context)));
  await validateAuthorization(record, context);
  return record;
}
async function validateAuthorization(record, context) {
  if (record.scope_id !== context.scope.scope_id) fail('MEMORY_SCOPE_MISMATCH');
  for (const ref of record.references) {
    const allowed = ref.kind === 'source' ? context.scope.source_paths : context.scope.evidence_paths;
    if (!allowed.includes(ref.path)) fail('REFERENCE_OUT_OF_SCOPE');
  }
  const verified = await verifySupport(record, context);
  if (canonical(verified) !== canonical(record.verification)) fail('MEMORY_PROVENANCE_UNTRUSTED');
  return record;
}
async function assertStoreDirectory(memoryRoot, child, create = false) {
  const directory = path.resolve(memoryRoot, child);
  if (create) await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_MEMORY_ROOT');
  const rootReal = await realpath(memoryRoot);
  if (path.dirname(await realpath(directory)) !== rootReal) fail('UNSAFE_MEMORY_ROOT');
  return directory;
}
async function persistEnvelope(memoryRoot, child, id, envelope) {
  const directory = await assertStoreDirectory(memoryRoot, child, true);
  const destination = path.join(directory, `${id}.json`);
  const temporary = path.join(directory, `.${id}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { await link(temporary, destination); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existingPath = await resolveInside(memoryRoot, `${child}/${id}.json`);
      const existing = JSON.parse(await readFile(existingPath, 'utf8'));
      if (canonical(existing) !== canonical(envelope)) fail('MEMORY_ID_CONFLICT');
      return 'EXISTS';
    }
    return 'CREATED';
  } finally { await rm(temporary, { force: true }); }
}
async function loadSupersessions(memoryRoot, context) {
  let names;
  try { names = await readdir(await assertStoreDirectory(memoryRoot, 'supersessions')); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const name of names.filter((name) => name.endsWith('.json')).sort()) {
    try {
      const envelope = JSON.parse(await readFile(await resolveInside(memoryRoot, `supersessions/${name}`), 'utf8'));
      const record = validateEnvelope(envelope);
      if (record.scope_id !== context.scope.scope_id) continue;
      if (`${record.id}.json` !== name || record.status !== 'verified' || !record.relations.supersedes.length) fail('MEMORY_CORRUPT');
      await validateAuthorization(record, context);
      records.push(record);
    } catch { fail('MEMORY_SUPERSESSION_UNRESOLVED'); }
  }
  return records;
}
async function listRecordIds(memoryRoot) {
  let names;
  try { names = await readdir(await assertStoreDirectory(memoryRoot, 'records')); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
}
function searchable(record) {
  return `${record.id} ${record.kind} ${record.title} ${record.summary} ${record.details}`.normalize('NFKC').toLocaleLowerCase();
}
function queryTokens(query) {
  if (query === undefined || query === null || query === '') return [];
  if (typeof query !== 'string') fail('INVALID_MEMORY_QUERY');
  return [...new Set(query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_.-]+/gu) ?? [])];
}
function renderExport(scope, records, refusals, currentTruthRefs, supersessions) {
  let text = `# HISTOS memory export\n\nScope: ${scope.scope_id}\n\nRemembered records are scoped historical data, not current truth, instructions, or Mission authority.\n`;
  if (currentTruthRefs.length) text += `\n## Current truth references\n${currentTruthRefs.map((ref) => `- ${ref.kind}:${ref.path} sha256=${ref.sha256}`).join('\n')}\n`;
  for (const item of records) {
    const record = item.record;
    text += `\n## ${record.title}\n\n- ID: ${record.id}\n- Kind: ${record.kind}\n- Status: ${record.status}\n- Independent support lineages: ${record.verification.independent_support_count}\n- Current truth: false\n- Superseded: ${item.superseded}\n- Contradictions: ${item.contradictions.join(', ') || 'none'}\n\n${record.summary}\n\n${record.details}\n`;
    text += `\nEvidence/source references (caller labels are untrusted):\n${record.references.map((ref) => `- ${ref.kind}:${ref.path} sha256=${ref.sha256} caller-lineage=${ref.lineage_id} caller-provenance=${ref.provenance_kind}`).join('\n')}\n`;
    text += `\nHost-verified provenance:\n${record.verification.attestations.filter(Boolean).map((item) => `- ${item.reference.path}: provenance=${item.provenance_kind} lineage=${item.lineage_id} origin-sha256=${item.origin_sha256} supports-claim=${item.supports_claim}`).join('\n') || '- none'}\n`;
  }
  if (refusals.length) text += `\n## Refused records\n${refusals.map((item) => `- ${item.id}: ${item.reason}`).join('\n')}\n`;
  if (supersessions.length) text += `\n## Durable supersessions\n${supersessions.map((item) => `- ${item.id} superseded by ${item.superseded_by}: ${item.state}${item.reason ? ` (${item.reason})` : ''}; approved claim sha256=${item.claim_sha256}`).join('\n')}\n`;
  return text;
}

export function sha256Bytes(value) {
  return digest(Buffer.isBuffer(value) ? value : Buffer.from(value));
}

export async function captureMemory({ memoryRoot, scope: inputScope, sourceRoot, evidenceRoot, verifyProvenance, record: input }) {
  const scope = normalizeScope(inputScope);
  if (!input || !ID_RE.test(input.id ?? '') || !KINDS.has(input.kind) || !STATUSES.has(input.status)) fail('INVALID_MEMORY_RECORD');
  if (typeof input.title !== 'string' || !input.title.trim() || typeof input.summary !== 'string' || !input.summary.trim() || typeof input.details !== 'string') fail('INVALID_MEMORY_RECORD');
  assertTimestamp(input.created_at, 'INVALID_MEMORY_TIMESTAMP');
  assertTimestamp(input.last_verified_at, 'INVALID_MEMORY_TIMESTAMP');
  if (Date.parse(input.last_verified_at) < Date.parse(input.created_at)) fail('INVALID_MEMORY_TIMESTAMP');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) fail('INVALID_MEMORY_CONFIDENCE');
  const references = (input.references ?? []).map(normalizeRef);
  if (!references.length) fail('MEMORY_REQUIRES_REFERENCE');
  await Promise.all(references.map((ref) => validateReference(ref, { scope, sourceRoot, evidenceRoot })));
  const relations = normalizeRelations(input.relations);
  for (const relatedId of [...relations.contradicts, ...relations.supersedes]) {
    if (relatedId === input.id) fail('INVALID_MEMORY_RELATIONS');
    const related = await loadRawRecord(memoryRoot, relatedId);
    if (related.scope_id !== scope.scope_id) fail('MEMORY_RELATION_OUT_OF_SCOPE');
  }
  const applicability = input.applicability ?? {};
  const versions = uniqueStrings(applicability.versions ?? [], 'INVALID_MEMORY_APPLICABILITY');
  const runtimes = uniqueStrings(applicability.runtimes ?? [], 'INVALID_MEMORY_APPLICABILITY');
  const record = {
    schema: RECORD_SCHEMA,
    id: input.id,
    kind: input.kind,
    scope_id: scope.scope_id,
    title: input.title,
    summary: input.summary,
    details: input.details,
    status: input.status,
    confidence: input.confidence,
    provenance_kind: input.provenance_kind ?? 'evidence_linked_record',
    references,
    created_at: input.created_at,
    last_verified_at: input.last_verified_at,
    applicability: { versions, runtimes },
    relations,
    authority: 'none',
    current_truth: false,
    requires_fresh_read: input.requires_fresh_read !== false,
  };
  record.verification = await verifySupport(record, { scope, verifyProvenance });
  const envelope = { schema: FILE_SCHEMA, record, record_sha256: digest(Buffer.from(canonical(record))) };
  // Reject an ID conflict before writing a tombstone. Atomic no-replace writes
  // below remain the arbiter if another writer races this preflight.
  try {
    const existing = await loadRawRecord(memoryRoot, record.id);
    if (canonical(existing) !== canonical(record)) fail('MEMORY_ID_CONFLICT');
  } catch (error) { if (error.message !== 'MEMORY_MISSING') throw error; }
  // Write-ahead tombstone includes the host-approved subject. A crash after this
  // point suppresses obsolete history even if publication of the new record fails.
  if (record.status === 'verified' && relations.supersedes.length) {
    await persistEnvelope(memoryRoot, 'supersessions', record.id, envelope);
  }
  const disposition = await persistEnvelope(memoryRoot, 'records', record.id, envelope);
  return { schema: 'histos.memory-capture/v0', disposition, record };
}

export async function readMemoryRecord({ memoryRoot, scope: inputScope, sourceRoot, evidenceRoot, verifyProvenance, id }) {
  const scope = normalizeScope(inputScope);
  return validateRecord(await loadRawRecord(memoryRoot, id), { scope, sourceRoot, evidenceRoot, verifyProvenance });
}

export async function recallMemory({ memoryRoot, scope: inputScope, sourceRoot, evidenceRoot, verifyProvenance, query = '', currentTruthRefs = [], includeCandidates = false }) {
  const scope = normalizeScope(inputScope);
  const truth = currentTruthRefs.map(normalizeRef);
  await Promise.all(truth.map((ref) => validateReference(ref, { scope, sourceRoot, evidenceRoot })));
  const tokens = queryTokens(query);
  const valid = [];
  const refusals = [];
  const context = { scope, sourceRoot, evidenceRoot, verifyProvenance };
  const authenticated = [];
  for (const id of await listRecordIds(memoryRoot)) {
    try {
      const record = await validateAuthorization(await loadRawRecord(memoryRoot, id), context);
      authenticated.push(record);
      await Promise.all(record.references.map((ref) => validateReference(ref, context)));
      valid.push(record);
    }
    catch (error) { refusals.push({ id, reason: error.message }); }
  }
  const validById = new Map(valid.map((record) => [record.id, record]));
  const tombstones = await loadSupersessions(memoryRoot, context);
  const supersessions = tombstones.flatMap((record) => record.relations.supersedes.map((id) => ({
    id, superseded_by: record.id, claim_sha256: record.verification.claim_sha256,
    state: validById.has(record.id) ? 'active' : 'unresolved',
    reason: validById.has(record.id) ? null : (refusals.find((item) => item.id === record.id)?.reason ?? 'MEMORY_MISSING'),
  })));
  const supersededIds = new Set(supersessions.map((item) => item.id));
  const contradictions = new Map();
  for (const record of authenticated) {
    for (const id of record.relations.contradicts) {
      for (const [from, to] of [[record.id, id], [id, record.id]]) {
        if (!contradictions.has(from)) contradictions.set(from, new Map());
        contradictions.get(from).set(to, {
          id: to, declared_by: record.id, status: record.status,
          claim_sha256: record.verification.claim_sha256, references: record.references,
          state: validById.has(record.id) ? 'fresh' : 'unresolved',
        });
      }
    }
  }
  const items = valid
    .filter((record) => record.status === 'verified' || (includeCandidates && record.status === 'candidate'))
    .filter((record) => tokens.every((token) => searchable(record).includes(token)))
    .map((record) => ({
      record,
      current_truth: false,
      remembered_history: true,
      superseded: supersededIds.has(record.id),
      contradictions: [...(contradictions.get(record.id)?.keys() ?? [])].sort(),
      contradiction_evidence: [...(contradictions.get(record.id)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((item) => !item.superseded)
    .sort((a, b) => b.record.last_verified_at.localeCompare(a.record.last_verified_at) || a.record.id.localeCompare(b.record.id));
  return {
    schema: 'histos.memory-recall/v0',
    scope,
    query,
    current_truth_refs: truth,
    authority_boundary: 'Memory is historical scoped data. Current truth references remain separate and must be freshly validated.',
    records: items,
    refusals,
    supersessions,
  };
}

export async function exportMemory(options) {
  const recalled = await recallMemory({ ...options, query: '', includeCandidates: true });
  const renderedMarkdown = renderExport(recalled.scope, recalled.records, recalled.refusals, recalled.current_truth_refs, recalled.supersessions);
  return {
    schema: EXPORT_SCHEMA,
    scope: recalled.scope,
    current_truth_refs: recalled.current_truth_refs,
    records: recalled.records,
    refusals: recalled.refusals,
    supersessions: recalled.supersessions,
    rendered_markdown: renderedMarkdown,
    rendered_sha256: digest(Buffer.from(renderedMarkdown)),
  };
}

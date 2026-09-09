import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Portable, non-destructive Agent Skill projection.
 *
 * A projection is a materialized view of an already reviewed procedural
 * revision.  It is deliberately not a memory store, permission grant or
 * Mission/current-state channel.  The APIs below only write beneath an
 * explicitly supplied projectRoot and use the generated manifest as a
 * compare-and-swap ownership record.
 */

export const SKILL_PROJECTION_SCHEMA = 'histos.skill-projection/v1';
export const AGENT_SKILL_FORMAT = 'agentskills/v1';
export const TARGET_FAMILIES = Object.freeze(['codex', 'opencode']);
export const ACTIVATION_STATUSES = Object.freeze(['NOT_RUN', 'PASS', 'FAIL']);
export const MANIFEST_NAME = '.histos-projection.json';

const SHA256_RE = /^[a-f0-9]{64}$/u;
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
// Markdown bodies legitimately contain LF/CR/TAB; reject the remaining
// control range so frontmatter and manifest values cannot smuggle delimiters.
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_DESCRIPTION = 1_024;
const MAX_BODY = 64 * 1_024;
const MAX_EVIDENCE_REFS = 64;

const FORBIDDEN_KEY_RE = /^(?:secret|credential|password|token|api[_-]?key|private[_-]?key|mission(?:[_-].*)?|current[_-]?branch|runtime[_-]?session|session[_-]?state|permission|grant|capability[_-]?grant)$/iu;
const SECRET_RE = /(?:-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk|rk)-[A-Za-z0-9]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]{8,})/iu;
const AUTHORITY_ASSIGNMENT_RE = /\b(?:authority|current[_-]?truth|verified|active|permission|mission[_-]?(?:state|id|transition))\s*[:=]\s*(?:true|false|[A-Za-z0-9._-]+)/iu;
const ABSOLUTE_WINDOWS_RE = /^[A-Za-z]:[\\/]/u;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  const source = typeof value === 'string' || value instanceof Uint8Array ? value : canonical(value);
  return createHash('sha256').update(source).digest('hex');
}

function boundedString(value, max, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || CONTROL_RE.test(value)) fail(code);
  return value;
}

function normalizeId(value, code = 'PROJECTION_ID_INVALID') {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail(code);
  return value;
}

function normalizeHash(value, code = 'PROJECTION_HASH_INVALID') {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(code);
  return value;
}

function normalizeSkillName(value) {
  if (typeof value !== 'string' || !NAME_RE.test(value) || value.length > 64) fail('PROJECTION_SKILL_NAME_INVALID');
  return value;
}

function pathIsAbsolute(value) {
  return path.isAbsolute(value) || ABSOLUTE_WINDOWS_RE.test(value);
}

function normalizeRelative(value, code = 'PROJECTION_PATH_INVALID') {
  if (typeof value !== 'string' || !value || pathIsAbsolute(value) || value.includes('\\')) fail(code);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail(code);
  return parts.join('/');
}

function resolvedInside(root, candidate, code = 'PROJECTION_PATH_ESCAPE') {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const relative = path.relative(rootResolved, candidateResolved);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(code);
  return candidateResolved;
}

function relativePosix(root, candidate, code = 'PROJECTION_PATH_ESCAPE') {
  const absolute = resolvedInside(root, candidate, code);
  return path.relative(path.resolve(root), absolute).split(path.sep).join('/');
}

function walkStrings(value, visitor, seen = new Set(), location = '$') {
  if (typeof value === 'string') {
    visitor(value, location);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visitor, seen, `${location}[${index}]`));
  } else {
    Object.entries(value).forEach(([key, item]) => walkStrings(item, visitor, seen, `${location}.${key}`));
  }
}

function inspectBoundary(value, location = '$', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectBoundary(item, `${location}[${index}]`, seen));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll('-', '_');
    if (FORBIDDEN_KEY_RE.test(normalizedKey)) fail('PROJECTION_UNSAFE_FIELD', location + '.' + key);
    if (normalizedKey === 'authority' && nested !== 'none') fail('PROJECTION_AUTHORITY_FORBIDDEN');
    if (['current_truth', 'verified', 'active'].includes(normalizedKey) && nested !== false) fail('PROJECTION_AUTHORITY_FORBIDDEN');
    inspectBoundary(nested, `${location}.${key}`, seen);
  }
}

function inspectStrings(value) {
  walkStrings(value, (text, location) => {
    if (SECRET_RE.test(text)) fail('PROJECTION_SECRET_REJECTED', location);
    if (AUTHORITY_ASSIGNMENT_RE.test(text)) fail('PROJECTION_AUTHORITY_FORBIDDEN', location);
  });
}

function normalizeRevision(input) {
  const source = input?.source_revision ?? input?.procedural_revision ?? input?.revision;
  let revisionId;
  let suppliedHash;
  if (typeof source === 'string') revisionId = source;
  else if (source && typeof source === 'object' && !Array.isArray(source)) {
    revisionId = source.id ?? source.revision_id ?? source.revision ?? source.name;
    suppliedHash = source.sha256 ?? source.hash ?? source.source_sha256;
  }
  revisionId ??= input?.source_revision_id ?? input?.revision_id;
  revisionId = normalizeId(revisionId, 'PROJECTION_SOURCE_REVISION_REQUIRED');
  if (suppliedHash !== undefined) normalizeHash(suppliedHash, 'PROJECTION_SOURCE_HASH_INVALID');
  return { id: revisionId, ...(suppliedHash ? { supplied_sha256: suppliedHash } : {}) };
}

function normalizeReviewStatus(input) {
  const raw = String(input?.review_status ?? input?.review?.status ?? input?.status ?? '').toLowerCase().replaceAll('_', '-');
  if (!['accepted', 'reviewed', 'approved', 'synthetic-reviewed'].includes(raw)) fail('PROJECTION_REVIEW_REQUIRED');
  return raw;
}

function normalizeEvidenceRefs(input) {
  const refs = input?.evidence_refs ?? input?.review?.evidence_refs ?? [];
  if (!Array.isArray(refs) || refs.length > MAX_EVIDENCE_REFS) fail('PROJECTION_EVIDENCE_REFS_INVALID');
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) fail('PROJECTION_EVIDENCE_REF_INVALID');
    const id = normalizeId(ref.id ?? ref.ref_id ?? ref.evidence_id, 'PROJECTION_EVIDENCE_REF_ID_INVALID');
    const digest = normalizeHash(ref.sha256 ?? ref.hash, 'PROJECTION_EVIDENCE_REF_HASH_INVALID');
    return { id, sha256: digest };
  }).sort((a, b) => canonical(a).localeCompare(canonical(b)));
}

/** Normalize one reviewed, portable procedural revision. */
export function normalizeProceduralRevision(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('PROJECTION_PROCEDURE_INVALID');
  inspectBoundary(input);
  inspectStrings(input);
  const skillName = normalizeSkillName(input.skill_name ?? input.name);
  const description = boundedString(input.description, MAX_DESCRIPTION, 'PROJECTION_DESCRIPTION_INVALID').trim();
  if (!description || /[\r\n]/u.test(description)) fail('PROJECTION_DESCRIPTION_INVALID');
  const body = boundedString(input.body ?? input.procedure ?? input.content, MAX_BODY, 'PROJECTION_BODY_INVALID').trim();
  if (!body) fail('PROJECTION_BODY_INVALID');
  const revision = normalizeRevision(input);
  const reviewStatus = normalizeReviewStatus(input);
  const evidenceRefs = normalizeEvidenceRefs(input);
  const scopeInput = input.scope;
  let scope = null;
  if (scopeInput !== undefined) {
    if (!scopeInput || typeof scopeInput !== 'object' || Array.isArray(scopeInput)) fail('PROJECTION_SCOPE_INVALID');
    const scopeId = normalizeId(scopeInput.scope_id ?? scopeInput.id, 'PROJECTION_SCOPE_INVALID');
    const paths = scopeInput.paths ?? [];
    if (!Array.isArray(paths) || paths.some(item => typeof item !== 'string' || !item || item.includes('\\') || pathIsAbsolute(item) || item.split('/').some(part => !part || part === '.' || part === '..'))) fail('PROJECTION_SCOPE_INVALID');
    scope = { scope_id: scopeId, ...(paths.length ? { paths: [...new Set(paths)].sort() } : {}) };
  }
  const normalized = {
    schema: 'histos.procedural-revision/v1',
    skill_name: skillName,
    description,
    body,
    source_revision: { id: revision.id },
    review_status: reviewStatus,
    evidence_refs: evidenceRefs,
    ...(scope ? { scope } : {}),
  };
  const sourceSha256 = sha256(normalized);
  if (revision.supplied_sha256 && revision.supplied_sha256 !== sourceSha256) fail('PROJECTION_SOURCE_HASH_MISMATCH');
  return Object.freeze({ ...normalized, source_revision: { id: revision.id, sha256: sourceSha256 } });
}

/** Render the portable core SKILL.md body; target family never changes it. */
export function renderSkillDocument(input) {
  const procedure = normalizeProceduralRevision(input);
  const frontmatter = `---\nname: ${procedure.skill_name}\ndescription: ${procedure.description.replaceAll('\\n', ' ')}\n---`;
  return `${frontmatter}\n\n${procedure.body}\n`;
}

function normalizeTargetFamily(value) {
  const target = String(value ?? '').toLowerCase();
  if (!TARGET_FAMILIES.includes(target)) fail('PROJECTION_TARGET_UNSUPPORTED');
  return target;
}

function normalizeActivationEvidence(input) {
  const evidence = input ?? { status: 'NOT_RUN', reason: 'activation_probe_not_requested' };
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('PROJECTION_ACTIVATION_EVIDENCE_INVALID');
  const status = String(evidence.status ?? 'NOT_RUN').toUpperCase();
  if (!ACTIVATION_STATUSES.includes(status)) fail('PROJECTION_ACTIVATION_EVIDENCE_INVALID');
  if (status === 'NOT_RUN' && (!evidence.reason || typeof evidence.reason !== 'string')) fail('PROJECTION_ACTIVATION_REASON_REQUIRED');
  const result = { status, ...(evidence.reason ? { reason: boundedString(evidence.reason, 512, 'PROJECTION_ACTIVATION_REASON_INVALID') } : {}) };
  if (evidence.binary !== undefined) result.binary = boundedString(evidence.binary, 256, 'PROJECTION_ACTIVATION_BINARY_INVALID');
  if (evidence.version !== undefined) result.version = boundedString(evidence.version, 128, 'PROJECTION_ACTIVATION_VERSION_INVALID');
  if (evidence.evidence_sha256 !== undefined) result.evidence_sha256 = normalizeHash(evidence.evidence_sha256, 'PROJECTION_ACTIVATION_HASH_INVALID');
  return result;
}

function validateRootPair(projectRoot, destinationRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) fail('PROJECTION_PROJECT_ROOT_REQUIRED');
  const project = path.resolve(projectRoot);
  if (project === path.parse(project).root) fail('PROJECTION_PROJECT_ROOT_TOO_BROAD');
  if (typeof destinationRoot !== 'string' || !path.isAbsolute(destinationRoot)) fail('PROJECTION_DESTINATION_ROOT_REQUIRED');
  const destination = resolvedInside(project, destinationRoot, 'PROJECTION_DESTINATION_OUT_OF_SCOPE');
  return { project, destination };
}

function manifestPathFor(destinationRoot, skillName) {
  const skillDir = resolvedInside(destinationRoot, path.join(destinationRoot, skillName), 'PROJECTION_SKILL_PATH_ESCAPE');
  return { skillDir, documentPath: path.join(skillDir, 'SKILL.md'), manifestPath: path.join(skillDir, MANIFEST_NAME) };
}

function buildManifest({ procedure, target, targetPath, rendered, activation, previous }) {
  const documentSha256 = sha256(rendered);
  const targetFamily = normalizeTargetFamily(target);
  const managedFiles = [{ path: 'SKILL.md', sha256: documentSha256, bytes: Buffer.byteLength(rendered, 'utf8'), owner: 'projection' }];
  const source = {
    revision: procedure.source_revision.id,
    sha256: procedure.source_revision.sha256,
    review_status: procedure.review_status,
    evidence_refs: clone(procedure.evidence_refs),
    ...(procedure.scope ? { scope_id: procedure.scope.scope_id } : {}),
  };
  const base = {
    schema: SKILL_PROJECTION_SCHEMA,
    format: AGENT_SKILL_FORMAT,
    projection_id: 'pending',
    skill_name: procedure.skill_name,
    source,
    target: { family: targetFamily, target_path: targetPath },
    managed_files: managedFiles,
    ownership: { owner: 'histos', managed_paths: ['SKILL.md'], manifest: MANIFEST_NAME, uninstall: 'managed_only' },
    compatibility: {
      core_body_shared: true,
      discovery: 'on-demand',
      target_family: targetFamily,
      no_global_config: true,
      project_local_only: true,
    },
    authority_boundary: { authority: 'none', current_truth: false, mission_authority: 'external', permission_grant: false },
    activation: normalizeActivationEvidence(activation),
    ...(previous ? { previous_projection_id: previous.projection_id, previous_source_revision: previous.source?.revision } : {}),
  };
  const projectionId = `projection-${sha256(base).slice(0, 32)}`;
  const completed = { ...base, projection_id: projectionId };
  return Object.freeze({ ...completed, manifest_sha256: sha256(completed) });
}

async function pathExists(target) {
  try { await lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function assertNoSymlink(target, code) {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) fail(code);
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Check every existing path component before creating a destination. This
// prevents a project-local lexical path from resolving through a junction or
// symlink into an unrelated tree.
async function assertNoSymlinkAncestors(root, target, code = 'PROJECTION_SYMLINK_REFUSED') {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(target);
  const relative = path.relative(rootResolved, targetResolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('PROJECTION_PATH_ESCAPE');
  await assertNoSymlink(rootResolved, code);
  let current = rootResolved;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    const stat = await assertNoSymlink(current, code);
    if (!stat) break;
  }
}

async function writeAtomic(target, content) {
  const temporary = `${target}.tmp-${process.pid}-${sha256(content).slice(0, 12)}`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try { await rename(temporary, target); } catch (error) { try { await unlink(temporary); } catch {} throw error; }
}

async function readManifest(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8');
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail('PROJECTION_MANIFEST_INVALID'); }
  validateManifestShape(manifest);
  const { manifest_sha256: integrity, ...withoutIntegrity } = manifest;
  if (integrity !== sha256(withoutIntegrity)) fail('PROJECTION_MANIFEST_INTEGRITY_INVALID');
  return manifest;
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.schema !== SKILL_PROJECTION_SCHEMA || typeof manifest.projection_id !== 'string') fail('PROJECTION_MANIFEST_INVALID');
  normalizeHash(manifest.manifest_sha256, 'PROJECTION_MANIFEST_INVALID');
  normalizeSkillName(manifest.skill_name);
  normalizeTargetFamily(manifest.target?.family);
  normalizeRelative(manifest.target?.target_path, 'PROJECTION_MANIFEST_PATH_INVALID');
  if (!Array.isArray(manifest.managed_files) || manifest.managed_files.length === 0) fail('PROJECTION_MANIFEST_INVALID');
  if (manifest.authority_boundary?.authority !== 'none' || manifest.authority_boundary?.current_truth !== false || manifest.authority_boundary?.permission_grant !== false) fail('PROJECTION_MANIFEST_AUTHORITY_INVALID');
  for (const item of manifest.managed_files) {
    const relative = normalizeRelative(item.path, 'PROJECTION_MANAGED_PATH_INVALID');
    normalizeHash(item.sha256, 'PROJECTION_MANAGED_HASH_INVALID');
    if (relative !== 'SKILL.md' || item.owner !== 'projection') fail('PROJECTION_MANAGED_OWNERSHIP_INVALID');
  }
}

async function inspectManagedFiles({ skillDir, manifest }) {
  validateManifestShape(manifest);
  const drift = [];
  for (const item of manifest.managed_files) {
    const target = resolvedInside(skillDir, path.join(skillDir, item.path), 'PROJECTION_MANAGED_PATH_ESCAPE');
    const stat = await assertNoSymlink(target, 'PROJECTION_SYMLINK_REFUSED');
    if (!stat || !stat.isFile()) { drift.push({ path: item.path, reason: 'missing' }); continue; }
    const content = await readFile(target);
    const actual = sha256(content);
    if (actual !== item.sha256) drift.push({ path: item.path, reason: 'hash_mismatch', expected: item.sha256, actual });
  }
  return drift;
}

async function listAllFiles(root, prefix = '') {
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail('PROJECTION_SYMLINK_REFUSED');
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listAllFiles(absolute, relative));
    else result.push(relative);
  }
  return result;
}

/** Build a deterministic manifest without writing any files. */
export function buildSkillProjectionManifest({ procedure: input, target, targetPath, activationEvidence, previousManifest } = {}) {
  const procedure = normalizeProceduralRevision(input);
  const targetFamily = normalizeTargetFamily(target);
  const relativeTarget = normalizeRelative(targetPath ?? `${targetFamily}/${procedure.skill_name}`);
  const rendered = renderSkillDocument(procedure);
  return buildManifest({ procedure, target: targetFamily, targetPath: relativeTarget, rendered, activation: activationEvidence, previous: previousManifest });
}

/**
 * Install or update a projection under a project-local destination.
 * Existing managed content is compare-and-swap checked; user drift is never
 * overwritten silently.
 */
export async function projectSkill({ procedure: input, target, projectRoot, destinationRoot, activationEvidence, expectedProjectionId, expectedSourceRevision, mode = 'create' } = {}) {
  const procedure = normalizeProceduralRevision(input);
  const targetFamily = normalizeTargetFamily(target);
  const { project, destination } = validateRootPair(projectRoot, destinationRoot);
  await assertNoSymlinkAncestors(project, destination, 'PROJECTION_SYMLINK_REFUSED');
  await mkdir(destination, { recursive: true });
  await assertNoSymlink(destination, 'PROJECTION_SYMLINK_REFUSED');
  const { skillDir, documentPath, manifestPath } = manifestPathFor(destination, procedure.skill_name);
  const existing = await pathExists(skillDir);
  if (existing) await assertNoSymlink(skillDir, 'PROJECTION_SYMLINK_REFUSED');
  const manifestExists = await pathExists(manifestPath);
  let previous = null;
  if (manifestExists) {
    await assertNoSymlink(manifestPath, 'PROJECTION_SYMLINK_REFUSED');
    previous = await readManifest(manifestPath);
  }
  if (existing && !manifestExists) fail('PROJECTION_UNMANAGED_TARGET');
  if (previous) {
    if (previous.skill_name !== procedure.skill_name || previous.target?.target_path !== relativePosix(project, skillDir, 'PROJECTION_SKILL_PATH_ESCAPE')) fail('PROJECTION_MANIFEST_PATH_MISMATCH');
    if (expectedProjectionId && previous.projection_id !== expectedProjectionId) fail('PROJECTION_COMPARE_AND_SWAP_MISMATCH');
    if (expectedSourceRevision && previous.source?.revision !== expectedSourceRevision) fail('PROJECTION_COMPARE_AND_SWAP_MISMATCH');
    const drift = await inspectManagedFiles({ skillDir, manifest: previous });
    if (drift.length) fail('PROJECTION_DRIFT_CONFLICT', JSON.stringify(drift));
    if (mode === 'create') fail('PROJECTION_ALREADY_EXISTS');
  } else if (mode === 'update') {
    fail('PROJECTION_UPDATE_REQUIRES_EXISTING');
  }
  if (!previous && mode !== 'create' && mode !== 'update') fail('PROJECTION_MODE_INVALID');
  await mkdir(skillDir, { recursive: true });
  const targetPath = relativePosix(project, skillDir, 'PROJECTION_SKILL_PATH_ESCAPE');
  const rendered = renderSkillDocument(procedure);
  const manifest = buildManifest({ procedure, target: targetFamily, targetPath, rendered, activation: activationEvidence, previous });
  await writeAtomic(documentPath, rendered);
  await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.freeze({
    status: previous ? 'updated' : 'created',
    projection_id: manifest.projection_id,
    source_revision: manifest.source.revision,
    target: manifest.target,
    managed_files: clone(manifest.managed_files),
    manifest: clone(manifest),
    activation: clone(manifest.activation),
  });
}

/** Read a projection and report managed-file drift without mutating it. */
export async function inspectSkillProjection({ projectRoot, destinationRoot, skillName } = {}) {
  const name = normalizeSkillName(skillName);
  const { project, destination } = validateRootPair(projectRoot, destinationRoot);
  const { skillDir, manifestPath } = manifestPathFor(destination, name);
  await assertNoSymlinkAncestors(project, skillDir, 'PROJECTION_SYMLINK_REFUSED');
  await assertNoSymlink(manifestPath, 'PROJECTION_SYMLINK_REFUSED');
  const manifest = await readManifest(manifestPath);
  if (manifest.skill_name !== name) fail('PROJECTION_MANIFEST_SKILL_MISMATCH');
  if (manifest.target.target_path !== relativePosix(project, skillDir, 'PROJECTION_SKILL_PATH_ESCAPE')) fail('PROJECTION_MANIFEST_PATH_MISMATCH');
  return Object.freeze({ manifest, drift: await inspectManagedFiles({ skillDir, manifest }) });
}

/** Remove only files owned by a projection; refuse drift, extras or escapes. */
export async function uninstallSkillProjection({ projectRoot, destinationRoot, skillName, expectedProjectionId } = {}) {
  const name = normalizeSkillName(skillName);
  const { project, destination } = validateRootPair(projectRoot, destinationRoot);
  const { skillDir, manifestPath } = manifestPathFor(destination, name);
  await assertNoSymlinkAncestors(project, skillDir, 'PROJECTION_SYMLINK_REFUSED');
  await assertNoSymlink(manifestPath, 'PROJECTION_SYMLINK_REFUSED');
  const manifest = await readManifest(manifestPath);
  if (manifest.skill_name !== name) fail('PROJECTION_MANIFEST_SKILL_MISMATCH');
  if (expectedProjectionId && manifest.projection_id !== expectedProjectionId) fail('PROJECTION_COMPARE_AND_SWAP_MISMATCH');
  if (manifest.target.target_path !== relativePosix(project, skillDir, 'PROJECTION_SKILL_PATH_ESCAPE')) fail('PROJECTION_MANIFEST_PATH_MISMATCH');
  const drift = await inspectManagedFiles({ skillDir, manifest });
  if (drift.length) fail('PROJECTION_DRIFT_CONFLICT', JSON.stringify(drift));
  const allFiles = await listAllFiles(skillDir);
  const owned = new Set(manifest.managed_files.map(item => item.path));
  const extras = allFiles.filter(item => item !== MANIFEST_NAME && !owned.has(item));
  if (extras.length) fail('PROJECTION_UNOWNED_FILE', extras.join(','));
  for (const item of manifest.managed_files) await unlink(resolvedInside(skillDir, path.join(skillDir, item.path), 'PROJECTION_MANAGED_PATH_ESCAPE'));
  await unlink(manifestPath);
  try { await rmdir(skillDir); } catch (error) { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  return Object.freeze({ status: 'uninstalled', projection_id: manifest.projection_id, removed: [...owned, MANIFEST_NAME].sort() });
}

/** Capability evidence intentionally remains NOT_RUN until a caller performs a process-local probe. */
export function activationCapabilityEvidence({ target, status = 'NOT_RUN', reason = 'activation_probe_not_run', binary, version, evidence_sha256 } = {}) {
  const family = normalizeTargetFamily(target);
  const evidence = normalizeActivationEvidence({ status, reason, binary, version, evidence_sha256 });
  return Object.freeze({ target: family, ...evidence });
}

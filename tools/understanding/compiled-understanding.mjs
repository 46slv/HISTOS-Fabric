import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile, link } from 'node:fs/promises';
import path from 'node:path';

const OBJECT_SCHEMA = 'histos.compiled-understanding/v0';
const FILE_SCHEMA = 'histos.compiled-understanding-file/v0';
const SHA256_RE = /^[a-f0-9]{64}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KINDS = new Set(['architecture_overview', 'module_dependency_explanation', 'known_failure_boundary', 'verified_integration_contract']);

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw new Error(code); }
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}
function canonical(value) { return JSON.stringify(canonicalValue(value)); }
function assertTimestamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_UNDERSTANDING_TIMESTAMP');
}
function relativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes(':')) fail('INVALID_DEPENDENCY_PATH');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) fail('INVALID_DEPENDENCY_PATH');
  return normalized;
}
function normalizeScope(scope) {
  if (!scope || typeof scope.scope_id !== 'string' || !scope.scope_id.trim() || !scope.paths_by_kind || typeof scope.paths_by_kind !== 'object') fail('INVALID_UNDERSTANDING_SCOPE');
  const pathsByKind = {};
  for (const [kind, values] of Object.entries(scope.paths_by_kind)) {
    if (typeof kind !== 'string' || !kind || !Array.isArray(values)) fail('INVALID_UNDERSTANDING_SCOPE');
    const normalized = values.map(relativePath);
    if (new Set(normalized).size !== normalized.length) fail('INVALID_UNDERSTANDING_SCOPE');
    pathsByKind[kind] = normalized.sort();
  }
  return { scope_id: scope.scope_id, paths_by_kind: pathsByKind };
}
function normalizeDependency(dependency) {
  if (!dependency || typeof dependency.kind !== 'string' || !dependency.kind) fail('INVALID_UNDERSTANDING_DEPENDENCY');
  const normalized = {
    kind: dependency.kind,
    path: relativePath(dependency.path),
    sha256: dependency.sha256,
    bytes: dependency.bytes,
  };
  if (!SHA256_RE.test(normalized.sha256 ?? '') || !Number.isSafeInteger(normalized.bytes) || normalized.bytes < 0) fail('INVALID_UNDERSTANDING_DEPENDENCY');
  return normalized;
}
async function dependencyBytes(dependency, { scope, roots }) {
  const allowed = scope.paths_by_kind[dependency.kind];
  if (!allowed || !allowed.includes(dependency.path)) fail('DEPENDENCY_OUT_OF_SCOPE');
  const root = roots?.[dependency.kind];
  if (typeof root !== 'string' || !root) fail('DEPENDENCY_ROOT_REQUIRED');
  let rootReal;
  try { rootReal = await realpath(root); } catch { fail('DEPENDENCY_ROOT_MISSING'); }
  let absolute;
  try { absolute = await realpath(path.resolve(rootReal, dependency.path)); }
  catch (error) { if (error?.code === 'ENOENT') fail('DEPENDENCY_MISSING'); throw error; }
  const remainder = path.relative(rootReal, absolute);
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) fail('DEPENDENCY_OUT_OF_SCOPE');
  if (!(await lstat(absolute)).isFile()) fail('DEPENDENCY_NOT_FILE');
  return readFile(absolute);
}
async function validateDependency(dependency, context) {
  const bytes = await dependencyBytes(dependency, context);
  if (bytes.byteLength !== dependency.bytes || digest(bytes) !== dependency.sha256) fail('DEPENDENCY_STALE_OR_FORGED');
  return true;
}
function normalizeCoverage(coverage, dependencies) {
  if (!coverage || !Array.isArray(coverage.inspected) || !Array.isArray(coverage.not_inspected)) fail('INVALID_UNDERSTANDING_COVERAGE');
  const dependencyKeys = new Set(dependencies.map((item) => `${item.kind}:${item.path}`));
  const inspected = coverage.inspected.map((item) => {
    if (!item || typeof item.kind !== 'string') fail('INVALID_UNDERSTANDING_COVERAGE');
    const normalized = { kind: item.kind, path: relativePath(item.path) };
    if (!dependencyKeys.has(`${normalized.kind}:${normalized.path}`)) fail('COVERAGE_NOT_DEPENDENCY');
    if (item.start_line !== undefined || item.end_line !== undefined) {
      if (!Number.isSafeInteger(item.start_line) || !Number.isSafeInteger(item.end_line) || item.start_line < 1 || item.end_line < item.start_line) fail('INVALID_UNDERSTANDING_COVERAGE');
      normalized.start_line = item.start_line;
      normalized.end_line = item.end_line;
    }
    return normalized;
  });
  if (coverage.not_inspected.some((item) => typeof item !== 'string' || !item.trim())) fail('INVALID_UNDERSTANDING_COVERAGE');
  return { inspected, not_inspected: [...coverage.not_inspected] };
}
function objectPath(cacheRoot, key) {
  if (typeof cacheRoot !== 'string' || !cacheRoot) fail('INVALID_UNDERSTANDING_ROOT');
  if (!KEY_RE.test(key ?? '')) fail('INVALID_UNDERSTANDING_KEY');
  return path.resolve(cacheRoot, 'objects', `${key}.json`);
}
function validateEnvelope(envelope, expectedKey = null) {
  if (!envelope || envelope.schema !== FILE_SCHEMA || envelope.object?.schema !== OBJECT_SCHEMA || !SHA256_RE.test(envelope.object_sha256 ?? '')) fail('UNDERSTANDING_CORRUPT');
  if (digest(Buffer.from(canonical(envelope.object))) !== envelope.object_sha256) fail('UNDERSTANDING_CORRUPT');
  const object = envelope.object;
  if (!KEY_RE.test(object.key ?? '') || !KINDS.has(object.kind) || typeof object.scope_id !== 'string' || !object.scope_id) fail('UNDERSTANDING_CORRUPT');
  if (expectedKey !== null && object.key !== expectedKey) fail('UNDERSTANDING_CORRUPT');
  if (typeof object.title !== 'string' || typeof object.summary !== 'string' || typeof object.details !== 'string' || !Array.isArray(object.dependencies) || !object.dependencies.length) fail('UNDERSTANDING_CORRUPT');
  let dependencies;
  try { dependencies = object.dependencies.map(normalizeDependency); } catch { fail('UNDERSTANDING_CORRUPT'); }
  if (canonical(dependencies) !== canonical(object.dependencies) || dependencyAddress(dependencies) !== object.dependency_address) fail('UNDERSTANDING_CORRUPT');
  if (!object.coverage || !Array.isArray(object.coverage.inspected) || !Array.isArray(object.coverage.not_inspected)) fail('UNDERSTANDING_CORRUPT');
  try { assertTimestamp(object.created_at); assertTimestamp(object.last_verified_at); } catch { fail('UNDERSTANDING_CORRUPT'); }
  if (object.status !== 'compiled_candidate' || object.authority !== 'none' || object.current_truth !== false || typeof object.requires_fresh_read !== 'boolean') fail('UNDERSTANDING_CORRUPT');
  return object;
}
async function loadObject(cacheRoot, key) {
  let parsed;
  try {
    await assertObjectsDirectory(cacheRoot);
    const candidate = objectPath(cacheRoot, key);
    const resolved = await realpath(candidate);
    if (path.dirname(resolved) !== await realpath(path.resolve(cacheRoot, 'objects'))) fail('UNSAFE_UNDERSTANDING_ROOT');
    if ((await lstat(candidate)).isSymbolicLink()) fail('UNSAFE_UNDERSTANDING_ROOT');
    parsed = JSON.parse(await readFile(resolved, 'utf8'));
  }
  catch (error) { if (error?.code === 'ENOENT') fail('UNDERSTANDING_MISSING'); fail('UNDERSTANDING_CORRUPT'); }
  return validateEnvelope(parsed, key);
}
async function assertObjectsDirectory(cacheRoot, create = false) {
  const directory = path.resolve(cacheRoot, 'objects');
  if (create) await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.dirname(await realpath(directory)) !== await realpath(cacheRoot)) fail('UNSAFE_UNDERSTANDING_ROOT');
  return directory;
}
async function publish(cacheRoot, key, envelope) {
  const objectsDir = await assertObjectsDirectory(cacheRoot, true);
  const finalPath = objectPath(cacheRoot, key);
  const tempPath = path.resolve(objectsDir, `.${key}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await link(tempPath, finalPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    fail('UNDERSTANDING_PUBLISH_CONFLICT');
  } finally { await rm(tempPath, { force: true }); }
}
async function replace(cacheRoot, key, envelope) {
  const objectsDir = await assertObjectsDirectory(cacheRoot, true);
  const finalPath = objectPath(cacheRoot, key);
  const tempPath = path.resolve(objectsDir, `.${key}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    const { rename } = await import('node:fs/promises');
    await rename(tempPath, finalPath);
  } finally { await rm(tempPath, { force: true }); }
}
function dependencyAddress(dependencies) {
  return digest(Buffer.from(canonical([...dependencies].sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)))));
}
function renderObject(object) {
  let text = `# ${object.title}\n\nKind: ${object.kind}\nScope: ${object.scope_id}\nDependency address: ${object.dependency_address}\nCurrent truth: false\nAuthority: derived candidate only\nFresh live read required: ${object.requires_fresh_read}\n\n${object.summary}\n\n${object.details}\n\n## Inspected coverage\n`;
  text += object.coverage.inspected.map((item) => `- ${item.kind}:${item.path}${item.start_line ? `:${item.start_line}-${item.end_line}` : ''}`).join('\n') || '- none';
  text += `\n\n## Not inspected\n${object.coverage.not_inspected.map((item) => `- ${item}`).join('\n') || '- none'}\n\n## Exact dependencies\n`;
  text += object.dependencies.map((item) => `- ${item.kind}:${item.path} bytes=${item.bytes} sha256=${item.sha256}`).join('\n');
  text += '\n';
  return text;
}

export function sha256Bytes(value) {
  return digest(Buffer.isBuffer(value) ? value : Buffer.from(value));
}

export async function putCompiledUnderstanding({ cacheRoot, scope: inputScope, roots, understanding: input }) {
  const scope = normalizeScope(inputScope);
  if (!input || !KEY_RE.test(input.key ?? '') || !KINDS.has(input.kind)) fail('INVALID_UNDERSTANDING');
  if (typeof input.title !== 'string' || !input.title.trim() || typeof input.summary !== 'string' || !input.summary.trim() || typeof input.details !== 'string') fail('INVALID_UNDERSTANDING');
  assertTimestamp(input.created_at);
  assertTimestamp(input.last_verified_at);
  if (Date.parse(input.last_verified_at) < Date.parse(input.created_at)) fail('INVALID_UNDERSTANDING_TIMESTAMP');
  const dependencies = (input.dependencies ?? []).map(normalizeDependency);
  if (!dependencies.length) fail('UNDERSTANDING_REQUIRES_DEPENDENCY');
  const keys = dependencies.map((item) => `${item.kind}:${item.path}`);
  if (new Set(keys).size !== keys.length) fail('DUPLICATE_UNDERSTANDING_DEPENDENCY');
  await Promise.all(dependencies.map((dependency) => validateDependency(dependency, { scope, roots })));
  const address = dependencyAddress(dependencies);
  let previous = null;
  try { previous = await loadObject(cacheRoot, input.key); }
  catch (error) { if (error.message !== 'UNDERSTANDING_MISSING') throw error; }
  if (previous && previous.scope_id !== scope.scope_id) fail('UNDERSTANDING_SCOPE_MISMATCH');
  if (previous && previous.dependency_address === address) {
    await Promise.all(previous.dependencies.map((dependency) => validateDependency(dependency, { scope, roots })));
    return { schema: 'histos.compiled-understanding-put/v0', disposition: 'REUSED', object: previous };
  }
  const object = {
    schema: OBJECT_SCHEMA,
    key: input.key,
    kind: input.kind,
    scope_id: scope.scope_id,
    title: input.title,
    summary: input.summary,
    details: input.details,
    dependencies: [...dependencies].sort((a, b) => `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)),
    dependency_address: address,
    coverage: normalizeCoverage(input.coverage, dependencies),
    created_at: input.created_at,
    last_verified_at: input.last_verified_at,
    confidence: input.confidence ?? null,
    status: 'compiled_candidate',
    authority: 'none',
    current_truth: false,
    requires_fresh_read: input.requires_fresh_read !== false,
  };
  const envelope = { schema: FILE_SCHEMA, object, object_sha256: digest(Buffer.from(canonical(object))) };
  if (previous) await replace(cacheRoot, input.key, envelope);
  else await publish(cacheRoot, input.key, envelope);
  return { schema: 'histos.compiled-understanding-put/v0', disposition: previous ? 'RECOMPILED' : 'CREATED', object, previous_dependency_address: previous?.dependency_address ?? null };
}

export async function assessCompiledUnderstanding({ cacheRoot, scope: inputScope, roots, key }) {
  const scope = normalizeScope(inputScope);
  let object;
  try { object = await loadObject(cacheRoot, key); }
  catch (error) { return { schema: 'histos.compiled-understanding-assessment/v0', key, reusable: false, reason: error.message, object: null, stale_dependencies: [] }; }
  if (object.scope_id !== scope.scope_id) return { schema: 'histos.compiled-understanding-assessment/v0', key, reusable: false, reason: 'UNDERSTANDING_SCOPE_MISMATCH', object: null, stale_dependencies: [] };
  const stale = [];
  for (const dependency of object.dependencies) {
    try { await validateDependency(dependency, { scope, roots }); }
    catch (error) { stale.push({ kind: dependency.kind, path: dependency.path, reason: error.message }); }
  }
  return {
    schema: 'histos.compiled-understanding-assessment/v0',
    key,
    reusable: stale.length === 0,
    reason: stale.length ? 'DEPENDENCIES_STALE' : 'UNCHANGED_DEPENDENCIES',
    object: stale.length ? null : object,
    stale_dependencies: stale,
  };
}

export async function readCompiledUnderstanding(options) {
  const assessment = await assessCompiledUnderstanding(options);
  if (!assessment.reusable) fail(assessment.reason);
  return assessment.object;
}

export async function assessUnderstandingCache({ cacheRoot, scope, roots }) {
  let names;
  try { names = await readdir(await assertObjectsDirectory(cacheRoot)); }
  catch (error) { if (error?.code === 'ENOENT') names = []; else throw error; }
  const assessments = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    assessments.push(await assessCompiledUnderstanding({ cacheRoot, scope, roots, key: name.slice(0, -5) }));
  }
  return {
    schema: 'histos.compiled-understanding-cache-assessment/v0',
    reusable: assessments.filter((item) => item.reusable).map((item) => item.key),
    stale: assessments.filter((item) => !item.reusable).map((item) => ({ key: item.key, reason: item.reason, stale_dependencies: item.stale_dependencies })),
  };
}

export async function exportCompiledUnderstanding(options) {
  const object = await readCompiledUnderstanding(options);
  const renderedMarkdown = renderObject(object);
  return {
    schema: 'histos.compiled-understanding-export/v0',
    object,
    rendered_markdown: renderedMarkdown,
    rendered_sha256: digest(Buffer.from(renderedMarkdown)),
  };
}

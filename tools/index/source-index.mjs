import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const INDEX_SCHEMA = 'histos.source-index/v1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value);

function fail(code) { throw new Error(code); }
function relativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes(':')) fail('INVALID_SCOPE_PATH');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) fail('INVALID_SCOPE_PATH');
  return normalized;
}
function uniqueSorted(values) {
  const normalized = values.map(relativePath);
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_SCOPE_PATH');
  return normalized.sort((a, b) => a.localeCompare(b));
}
async function inside(rootReal, relative) {
  let absolute;
  try { absolute = await realpath(path.resolve(rootReal, relativePath(relative))); }
  catch (error) { if (error?.code === 'ENOENT') fail('SOURCE_MISSING'); throw error; }
  const remainder = path.relative(rootReal, absolute);
  if (!remainder || remainder === '..' || remainder.startsWith(`..${path.sep}`) || path.isAbsolute(remainder)) fail('SOURCE_OUT_OF_SCOPE');
  return absolute;
}
function tokenize(value) {
  return [...new Set(String(value).normalize('NFKC').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])]
    .flatMap((token) => token.split(/[._-]+/u)).filter((token) => token.length >= 2);
}
function languageFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) return 'javascript';
  if (['.ts', '.mts', '.cts', '.tsx'].includes(ext)) return 'typescript';
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  return 'text';
}
function braceEnd(lines, start) {
  let depth = 0;
  let seen = false;
  for (let index = start; index < lines.length; index += 1) {
    const stripped = lines[index].replace(/(['"`]).*?\1/g, '');
    for (const char of stripped) {
      if (char === '{') { depth += 1; seen = true; }
      if (char === '}') depth -= 1;
    }
    if (seen && depth <= 0) return index + 1;
  }
  return start + 1;
}
function outlineCode(lines) {
  const symbols = [];
  const pattern = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:(function|class)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    const name = match[2] ?? match[3];
    symbols.push({ name, kind: match[1] ?? 'binding', start_line: index + 1, end_line: braceEnd(lines, index) });
  }
  return symbols;
}
function outlineMarkdown(lines) {
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ name: match[2], kind: 'heading', level: match[1].length, start_line: index + 1, end_line: lines.length });
  }
  for (let index = 0; index < headings.length; index += 1) {
    const next = headings.slice(index + 1).find((entry) => entry.level <= headings[index].level);
    if (next) headings[index].end_line = next.start_line - 1;
    delete headings[index].level;
  }
  return headings;
}
function deriveSource(relative, bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('SOURCE_NOT_UTF8'); }
  const lines = text.split(/\r?\n/);
  const language = languageFor(relative);
  const symbols = language === 'markdown' ? outlineMarkdown(lines) : ['javascript', 'typescript'].includes(language) ? outlineCode(lines) : [];
  const dependencies = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/(?:from\s+|require\s*\(|import\s*\()(['"])([^'"]+)\1/);
    if (match) dependencies.push({ specifier: match[2], line: index + 1 });
  }
  return { path: relative, sha256: sha256(bytes), bytes: bytes.length, line_count: lines.length, language, lines, symbols, dependencies };
}
function snapshotDigest(sources) {
  return sha256(Buffer.from(sources.map((source) => `${source.path}\0${source.sha256}\0${source.bytes}`).join('\n')));
}
function coreForDigest(index) {
  const { derived_digest: ignored, ...core } = index;
  return core;
}
function validateIndex(index) {
  if (!index || index.schema !== INDEX_SCHEMA || typeof index.scope?.scope_id !== 'string' || !SHA256_RE.test(index.scope?.snapshot_digest ?? '')) fail('INDEX_CORRUPT');
  if (index.retention?.policy !== 'manual' || !Array.isArray(index.sources)) fail('INDEX_CORRUPT');
  if (index.sources.some((source) => !SHA256_RE.test(source.sha256 ?? '') || !Array.isArray(source.lines) || !Array.isArray(source.symbols))) fail('INDEX_CORRUPT');
  if (snapshotDigest(index.sources) !== index.scope.snapshot_digest) fail('INDEX_CORRUPT');
  if (sha256(Buffer.from(canonical(coreForDigest(index)))) !== index.derived_digest) fail('INDEX_CORRUPT');
  return index;
}

export async function loadSourceIndex({ indexRoot, expectedScopeId = null, expectedSnapshotDigest = null }) {
  let parsed;
  try { parsed = JSON.parse(await readFile(path.resolve(indexRoot, 'source-index-v1.json'), 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') fail('INDEX_MISSING'); fail('INDEX_CORRUPT'); }
  const index = validateIndex(parsed);
  if (expectedScopeId !== null && index.scope.scope_id !== expectedScopeId) fail('SCOPE_MISMATCH');
  if (expectedSnapshotDigest !== null && index.scope.snapshot_digest !== expectedSnapshotDigest) fail('SNAPSHOT_MISMATCH');
  return index;
}

export async function buildSourceIndex({ root, indexRoot, scopeId, paths, currentDiffPaths = [], forceRebuild = false }) {
  if (typeof scopeId !== 'string' || !scopeId.trim()) fail('INVALID_SCOPE_ID');
  if (!Array.isArray(paths) || !paths.length || !Array.isArray(currentDiffPaths)) fail('INVALID_SCOPE_PATHS');
  const inventory = uniqueSorted(paths);
  const diff = uniqueSorted(currentDiffPaths);
  if (diff.some((entry) => !inventory.includes(entry))) fail('DIFF_OUT_OF_SCOPE');
  const rootReal = await realpath(root);
  if (!(await lstat(rootReal)).isDirectory()) fail('INVALID_SOURCE_ROOT');
  let previous = null;
  try { previous = await loadSourceIndex({ indexRoot, expectedScopeId: scopeId }); }
  catch (error) {
    if (!['INDEX_MISSING', 'INDEX_CORRUPT'].includes(error.message)) throw error;
    if (error.message === 'INDEX_CORRUPT' && !forceRebuild) throw error;
  }
  const oldByPath = new Map((previous?.sources ?? []).map((source) => [source.path, source]));
  const sources = [];
  const changes = { added: [], modified: [], deleted: [], unchanged: [], parsed_files: 0, reused_files: 0 };
  for (const relative of inventory) {
    const bytes = await readFile(await inside(rootReal, relative));
    const digest = sha256(bytes);
    const old = oldByPath.get(relative);
    if (old && old.sha256 === digest && old.bytes === bytes.length) {
      sources.push(old); changes.unchanged.push(relative); changes.reused_files += 1;
    } else {
      sources.push(deriveSource(relative, bytes)); changes.parsed_files += 1;
      (old ? changes.modified : changes.added).push(relative);
    }
  }
  for (const oldPath of oldByPath.keys()) if (!inventory.includes(oldPath)) changes.deleted.push(oldPath);
  const index = {
    schema: INDEX_SCHEMA,
    scope: { scope_id: scopeId, snapshot_digest: snapshotDigest(sources), paths: inventory },
    retention: { policy: 'manual', cleanup: 'Delete source-index-v1.json explicitly; every field is rebuildable from scoped source.' },
    current_diff_paths: diff,
    sources,
    derived_digest: null,
  };
  index.derived_digest = sha256(Buffer.from(canonical(coreForDigest(index))));
  await mkdir(indexRoot, { recursive: true });
  const stat = await lstat(indexRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_INDEX_ROOT');
  const finalPath = path.resolve(indexRoot, 'source-index-v1.json');
  const tempPath = path.resolve(indexRoot, `.source-index-v1.${process.pid}.${Date.now()}.tmp`);
  try { await writeFile(tempPath, `${JSON.stringify(index)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await rename(tempPath, finalPath); }
  finally { await rm(tempPath, { force: true }); }
  return { index, changes };
}

function assertSearchScope(index, scope) {
  validateIndex(index);
  if (!scope || scope.scope_id !== index.scope.scope_id) fail('SCOPE_MISMATCH');
  if (scope.snapshot_digest !== index.scope.snapshot_digest) fail('SNAPSHOT_MISMATCH');
  const allowed = scope.paths === undefined ? index.scope.paths : uniqueSorted(scope.paths);
  if (allowed.some((entry) => !index.scope.paths.includes(entry))) fail('SCOPE_OUT_OF_BOUNDS');
  return new Set(allowed);
}
function mergeIntervals(intervals) {
  const sorted = intervals.sort((a, b) => a.start_line - b.start_line || a.end_line - b.end_line);
  const merged = [];
  for (const entry of sorted) {
    const prior = merged.at(-1);
    if (prior && entry.start_line <= prior.end_line + 1) {
      prior.end_line = Math.max(prior.end_line, entry.end_line);
      prior.score += entry.score;
      prior.signals.push(...entry.signals);
    } else merged.push({ ...entry, signals: [...entry.signals] });
  }
  return merged;
}

export function searchSourceIndex({ index, query, scope, maxCandidates = 30 }) {
  if (typeof query !== 'string' || !query.trim() || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1) fail('INVALID_SEARCH');
  const allowed = assertSearchScope(index, scope);
  const sources = index.sources.filter((source) => allowed.has(source.path));
  const namedFiles = [...query.matchAll(/[A-Za-z0-9_$.-]+\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx|json|md)\b/giu)].map((match) => match[0].toLowerCase());
  if (namedFiles.some((name) => !sources.some((source) => source.path.toLowerCase().endsWith(`/${name}`) || path.posix.basename(source.path).toLowerCase() === name))) {
    return { schema: 'histos.source-search/v1', scope: index.scope, query, candidates: [], receipt: { reason: 'EXPLICIT_SOURCE_NOT_IN_SCOPE', candidate_count: 0 } };
  }
  const queryTokens = tokenize(query);
  const candidates = [];
  for (const source of sources) {
    const lexicalIntervals = [];
    const pathTokens = new Set(tokenize(source.path));
    for (let lineIndex = 0; lineIndex < source.lines.length; lineIndex += 1) {
      const lineTokens = new Set(tokenize(source.lines[lineIndex]));
      const hits = queryTokens.filter((token) => lineTokens.has(token)).length;
      if (!hits) continue;
      lexicalIntervals.push({ start_line: Math.max(1, lineIndex - 1), end_line: Math.min(source.lines.length, lineIndex + 3), score: hits * 100, signals: [`lexical:${hits}`] });
    }
    const intervals = mergeIntervals(lexicalIntervals);
    for (const symbol of source.symbols) {
      const symbolTokens = new Set(tokenize(`${symbol.name} ${source.lines.slice(symbol.start_line - 1, symbol.end_line).join(' ')}`));
      const hits = queryTokens.filter((token) => symbolTokens.has(token)).length;
      const nameHits = queryTokens.filter((token) => tokenize(symbol.name).includes(token)).length;
      if (!hits) continue;
      intervals.push({ start_line: symbol.start_line, end_line: symbol.end_line, score: 100 + hits * 100 + nameHits * 400, signals: [`structure:${symbol.kind}:${symbol.name}`, `structural_lexical:${hits}`] });
    }
    const pathHits = queryTokens.filter((token) => pathTokens.has(token)).length;
    for (const interval of intervals) {
      const diff = index.current_diff_paths.includes(source.path);
      const score = interval.score + pathHits * 25 + (diff ? 20 : 0);
      const signals = [...new Set([...interval.signals, ...(pathHits ? [`path:${pathHits}`] : []), ...(diff ? ['current_diff'] : [])])].sort();
      candidates.push({
        path: source.path, source_sha256: source.sha256, start_line: interval.start_line, end_line: interval.end_line,
        text: source.lines.slice(interval.start_line - 1, interval.end_line).join('\n'), score,
        why_included: signals, reopen: { operation: 'context.read_source', scope_id: index.scope.scope_id, snapshot_digest: index.scope.snapshot_digest, path: source.path, start_line: interval.start_line, end_line: interval.end_line },
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.start_line - b.start_line || a.end_line - b.end_line);
  const nonOverlapping = [];
  for (const candidate of candidates) {
    if (nonOverlapping.some((prior) => prior.path === candidate.path && prior.start_line <= candidate.end_line && prior.end_line >= candidate.start_line)) continue;
    nonOverlapping.push(candidate);
    if (nonOverlapping.length >= maxCandidates) break;
  }
  return { schema: 'histos.source-search/v1', scope: index.scope, query, candidates: nonOverlapping, receipt: { reason: candidates.length ? 'MATCHES' : 'NO_LEXICAL_OR_STRUCTURAL_MATCH', candidate_count: nonOverlapping.length, total_candidate_count: candidates.length } };
}

// Validate even a no-match response against the complete requested source scope.
export async function validateIndexedScope({ root, index, scope }) {
  const allowed = assertSearchScope(index, scope);
  const rootReal = await realpath(root);
  for (const relative of allowed) {
    const source = index.sources.find(entry => entry.path === relative);
    if (!source) fail('INDEX_CORRUPT');
    const bytes = await readFile(await inside(rootReal, relative));
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) fail('SOURCE_STALE');
  }
  return { scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest, paths: [...allowed] };
}

export async function readIndexedRange({ root, index, scope, sourcePath, startLine, endLine }) {
  const allowed = assertSearchScope(index, scope);
  const relative = relativePath(sourcePath);
  if (!allowed.has(relative)) fail('SOURCE_OUT_OF_SCOPE');
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) fail('INVALID_SOURCE_RANGE');
  const source = index.sources.find((entry) => entry.path === relative);
  if (!source || endLine > source.line_count) fail('INVALID_SOURCE_RANGE');
  const rootReal = await realpath(root);
  const bytes = await readFile(await inside(rootReal, relative));
  if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) fail('SOURCE_STALE');
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split(/\r?\n/);
  return { schema: 'histos.source-read/v1', scope: index.scope, path: relative, source_sha256: source.sha256, start_line: startLine, end_line: endLine, text: lines.slice(startLine - 1, endLine).join('\n') };
}

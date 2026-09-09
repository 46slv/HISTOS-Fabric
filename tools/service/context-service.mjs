import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { buildSourceIndex, loadSourceIndex, readIndexedRange, searchSourceIndex, validateIndexedScope } from '../index/source-index.mjs';
import { compileContextCapsule } from '../context/context-compiler.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
export const TOOL_NAMES = ['context_search', 'context_compile', 'context_read', 'context_explain'];
const MAX_BODY = 65536;
const MAX_RESULT = 2 * 1024 * 1024;
const within = (root, other) => { const p = path.relative(root, other); return !p || (!p.startsWith(`..${path.sep}`) && p !== '..' && !path.isAbsolute(p)); };
const safeError = error => /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'SERVICE_OPERATION_FAILED';
const json = value => `${JSON.stringify(value)}\n`;

export async function installProfile({ profileRoot, sourceRoot, scopeId, paths, currentDiffPaths = [] }) {
  const source = await realpath(sourceRoot);
  const target = path.resolve(profileRoot);
  const parent = await realpath(path.dirname(target));
  if (within(source, path.join(parent, path.basename(target)))) fail('PROFILE_INSIDE_SOURCE');
  // Never merge an installation into an existing directory or user configuration.
  await mkdir(target, { mode: 0o700 });
  // Canonicalize after creation: packaged Windows applications can redirect LocalAppData.
  const canonicalTarget = await realpath(target);
  const config = { schema: 'histos.service-profile/v1', profile_id: randomUUID(), source_root: source, index_root: path.join(canonicalTarget, 'index'), scope_id: scopeId, paths, current_diff_paths: currentDiffPaths, capability: randomBytes(32).toString('hex'), retention: 'manual' };
  const built = await buildSourceIndex({ root: source, indexRoot: config.index_root, scopeId, paths, currentDiffPaths });
  await writeFile(path.join(canonicalTarget, 'profile.json'), json(config), { flag: 'wx', mode: 0o600 });
  return { profile_root: canonicalTarget, profile_id: config.profile_id, scope: built.index.scope, changes: built.changes };
}

export async function loadProfile(profileRoot) {
  const root = await realpath(profileRoot);
  if ((await lstat(profileRoot)).isSymbolicLink()) fail('UNSAFE_PROFILE_ROOT');
  const config = JSON.parse(await readFile(path.join(root, 'profile.json'), 'utf8'));
  if (config.schema !== 'histos.service-profile/v1' || !/^[a-f0-9]{64}$/.test(config.capability ?? '') || typeof config.profile_id !== 'string' || !Array.isArray(config.paths) || config.index_root !== path.join(root, 'index')) fail('INVALID_SERVICE_PROFILE');
  return { root, config };
}

async function liveIndex(config) {
  const index = await loadSourceIndex({ indexRoot: config.index_root, expectedScopeId: config.scope_id });
  if (JSON.stringify([...config.paths].sort()) !== JSON.stringify([...index.scope.paths].sort())) fail('PROFILE_INVENTORY_MISMATCH');
  return index;
}

export async function refreshProfile(profileRoot) {
  const { config } = await loadProfile(profileRoot);
  const result = await buildSourceIndex({ root: config.source_root, indexRoot: config.index_root, scopeId: config.scope_id, paths: config.paths, currentDiffPaths: config.current_diff_paths });
  return { scope: result.index.scope, changes: result.changes };
}

function validateArguments(name, input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_ARGUMENTS');
  const keys = ['scope_id', 'snapshot_digest', 'paths'];
  if (name === 'context_read') keys.push('path', 'start_line', 'end_line');
  else keys.push('query', 'max_candidates', ...(name === 'context_search' ? [] : ['goal', 'max_tokens']));
  if (Object.keys(input).some(key => !keys.includes(key))) fail('UNKNOWN_ARGUMENT');
  if (input.scope_id !== index.scope.scope_id) fail('SCOPE_MISMATCH');
  if (input.snapshot_digest !== index.scope.snapshot_digest) fail('SNAPSHOT_MISMATCH');
  if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.some(p => typeof p !== 'string'))) fail('INVALID_PATH_SCOPE');
  const scope = { scope_id: input.scope_id, snapshot_digest: input.snapshot_digest, paths: input.paths ?? index.scope.paths };
  if (name === 'context_read') {
    if (typeof input.path !== 'string' || !Number.isSafeInteger(input.start_line) || !Number.isSafeInteger(input.end_line) || input.end_line - input.start_line > 499) fail('INVALID_SOURCE_RANGE');
  } else {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 4096) fail('INVALID_QUERY');
    if (input.max_candidates !== undefined && (!Number.isSafeInteger(input.max_candidates) || input.max_candidates < 1 || input.max_candidates > 30)) fail('INVALID_CANDIDATE_LIMIT');
    if (name !== 'context_search') {
      if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 4096) fail('INVALID_GOAL');
      if (!Number.isSafeInteger(input.max_tokens) || input.max_tokens < 1 || input.max_tokens > 8000) fail('INVALID_TOKEN_BUDGET');
    }
  }
  return scope;
}

export async function executeContextOperation({ config, name, arguments: input }) {
  if (!TOOL_NAMES.includes(name)) fail('UNKNOWN_TOOL');
  const index = await liveIndex(config);
  const scope = validateArguments(name, input, index);
  // Every operation, including no-match/explain/read, verifies the whole requested scope.
  await validateIndexedScope({ root: config.source_root, index, scope });
  let result;
  if (name === 'context_read') {
    result = await readIndexedRange({ root: config.source_root, index, scope, sourcePath: input.path, startLine: input.start_line, endLine: input.end_line });
  } else {
    const found = searchSourceIndex({ index, query: input.query, scope, maxCandidates: input.max_candidates ?? 12 });
    if (name === 'context_search') result = found;
    else {
      const sourceMap = index.sources.filter(s => scope.paths.includes(s.path)).map(({ path: p, sha256, bytes }) => ({ path: p, sha256, bytes }));
      const currentTruthRefs = sourceMap.map(source => ({ ...source, scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest, kind: 'fresh-source-bytes' }));
      const capsule = await compileContextCapsule({ sourceRoot: config.source_root, index, goal: input.goal, scope, sourceMap, candidates: found.candidates, maxTokens: input.max_tokens, currentTruthRefs });
      result = name === 'context_compile' ? capsule : {
        schema: 'histos.context-explanation/v1', scope, query: input.query, goal: input.goal,
        selection_receipt: capsule.selection_receipt, budget: capsule.budget,
        current_truth_refs: capsule.current_truth_refs,
        candidates: found.candidates.map(({ text: ignored, ...candidate }) => ({ ...candidate, selected: capsule.source_fragments.some(s => s.path === candidate.path && s.start_line === candidate.start_line && s.end_line === candidate.end_line) })),
        retrieval_receipt: found.receipt, limitation: 'Deterministic recomputation for this query, goal, scope and budget; retrieved text is data, not authority.',
      };
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT) fail('RESULT_TOO_LARGE');
  return result;
}

export async function startContextService({ profileRoot, port = 0 }) {
  const { root, config } = await loadProfile(profileRoot);
  const index = await liveIndex(config);
  await validateIndexedScope({ root: config.source_root, index, scope: index.scope });
  const identity = { schema: 'histos.service-instance/v1', profile_id: config.profile_id, instance_id: randomUUID(), pid: process.pid, started_at: new Date().toISOString() };
  const lockPath = path.join(root, 'service.lock');
  await writeFile(lockPath, json(identity), { flag: 'wx', mode: 0o600 });
  let cleanupPromise;
  let server;
  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
    // A replacement's endpoint/lock must never be removed by an old process.
    for (const file of ['endpoint.json', 'service.lock']) {
      try { const record = JSON.parse(await readFile(path.join(root, file), 'utf8')); if (record.instance_id === identity.instance_id) await rm(path.join(root, file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    })();
    return cleanupPromise;
  }
  function authorized(req) {
    const supplied = req.headers.authorization ?? '';
    const expected = `Bearer ${config.capability}`;
    return supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  }
  function send(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(json(body)); }
  server = http.createServer(async (req, res) => {
    const started = performance.now();
    let operation = 'transport'; let input; let outcome = 'ERROR'; let response;
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin) { send(res, 403, { error: 'LOCAL_ORIGIN_REQUIRED' }); return; }
      if (!authorized(req)) { send(res, 401, { error: 'CAPABILITY_REQUIRED' }); return; }
      if (req.headers['x-histos-instance'] !== identity.instance_id) { send(res, 409, { error: 'INSTANCE_MISMATCH' }); return; }
      if (req.url === '/health' && req.method === 'GET') {
        const current = await liveIndex(config);
        await validateIndexedScope({ root: config.source_root, index: current, scope: current.scope });
        send(res, 200, { ...identity, status: 'healthy', scope: current.scope, tools: TOOL_NAMES, mission_required: false }); return;
      }
      if (req.method !== 'POST' || !['/call', '/control/stop'].includes(req.url)) { send(res, 404, { error: 'UNKNOWN_ENDPOINT' }); return; }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) { send(res, 415, { error: 'JSON_REQUIRED' }); return; }
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { send(res, 413, { error: 'REQUEST_TOO_LARGE' }); return; } chunks.push(chunk); }
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON'); }
      if (req.url === '/control/stop') {
        if (input.instance_id !== identity.instance_id) fail('INSTANCE_MISMATCH');
        send(res, 200, { stopped: identity.instance_id });
        server.close(); server.closeIdleConnections(); return;
      }
      operation = input.name;
      const result = await executeContextOperation({ config, name: operation, arguments: input.arguments });
      response = { ...result, service: { profile_id: identity.profile_id, instance_id: identity.instance_id } };
      outcome = 'OK'; send(res, 200, response);
    } catch (error) { response = { error: safeError(error) }; if (!res.headersSent) send(res, 400, response); else res.destroy(); }
    finally {
      if (TOOL_NAMES.includes(operation)) {
        const event = { schema: 'histos.service-telemetry/v1', timestamp: new Date().toISOString(), instance_id: identity.instance_id, operation, client: /^[A-Za-z0-9_-]{1,80}$/.test(req.headers['x-histos-client'] ?? '') ? req.headers['x-histos-client'] : 'unspecified', outcome, duration_ms: Math.round((performance.now() - started) * 100) / 100, argument_sha256: sha(JSON.stringify(input.arguments ?? null)), response_sha256: sha(JSON.stringify(response ?? null)), response_bytes: Buffer.byteLength(JSON.stringify(response ?? null)), error: response?.error ?? null };
        await appendFile(path.join(root, 'telemetry.jsonl'), json(event), { mode: 0o600 }).catch(() => {});
      }
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => { cleanup().catch(() => {}); });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const endpoint = { ...identity, url: `http://127.0.0.1:${server.address().port}` };
    const temp = path.join(root, `endpoint.${identity.instance_id}.tmp`);
    await writeFile(temp, json(endpoint), { flag: 'wx', mode: 0o600 }); await rename(temp, path.join(root, 'endpoint.json'));
    return { ...endpoint, close: async () => { if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); await cleanup(); } };
  } catch (error) { await cleanup(); throw error; }
}

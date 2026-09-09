import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  assessCompiledUnderstanding,
  assessUnderstandingCache,
  exportCompiledUnderstanding,
  putCompiledUnderstanding,
  readCompiledUnderstanding,
  sha256Bytes,
} from './compiled-understanding.mjs';

const execFileAsync = promisify(execFile);
const workerMode = process.argv[2] === '--worker';

async function executeWorker(job) {
  try {
    if (job.operation === 'put') return { ok: true, result: await putCompiledUnderstanding(job.options) };
    if (job.operation === 'read') return { ok: true, result: await readCompiledUnderstanding(job.options) };
    if (job.operation === 'assess') return { ok: true, result: await assessCompiledUnderstanding(job.options) };
    if (job.operation === 'assess-cache') return { ok: true, result: await assessUnderstandingCache(job.options) };
    if (job.operation === 'export') return { ok: true, result: await exportCompiledUnderstanding(job.options) };
    throw new Error('UNKNOWN_WORKER_OPERATION');
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

if (workerMode) {
  const job = JSON.parse(await readFile(process.argv[3], 'utf8'));
  process.stdout.write(JSON.stringify(await executeWorker(job)));
} else {
  async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'histos-understanding-'));
    const sourceRoot = path.join(root, 'source');
    const evidenceRoot = path.join(root, 'evidence');
    const cacheRoot = path.join(root, 'cache');
    await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
    await mkdir(path.join(evidenceRoot, 'receipts'), { recursive: true });
    const a = Buffer.from('export function alpha() { return "A"; }\n');
    const b = Buffer.from('export function beta() { throw new Error("B"); }\n');
    const receipt = Buffer.from('{"test":"integration","exit":0}\n');
    await writeFile(path.join(sourceRoot, 'src', 'alpha.mjs'), a);
    await writeFile(path.join(sourceRoot, 'src', 'beta.mjs'), b);
    await writeFile(path.join(evidenceRoot, 'receipts', 'integration.json'), receipt);
    const scope = { scope_id: 'project-alpha', paths_by_kind: { source: ['src/alpha.mjs', 'src/beta.mjs'], evidence: ['receipts/integration.json'] } };
    const roots = { source: sourceRoot, evidence: evidenceRoot };
    const depA = { kind: 'source', path: 'src/alpha.mjs', sha256: sha256Bytes(a), bytes: a.length };
    const depB = { kind: 'source', path: 'src/beta.mjs', sha256: sha256Bytes(b), bytes: b.length };
    const depReceipt = { kind: 'evidence', path: 'receipts/integration.json', sha256: sha256Bytes(receipt), bytes: receipt.length };
    return { root, sourceRoot, evidenceRoot, cacheRoot, scope, roots, depA, depB, depReceipt };
  }

  function understanding(key, kind, title, summary, dependencies) {
    return {
      key, kind, title, summary,
      details: 'This compiled interpretation is derived data. Reopen exact dependencies before a freshness-sensitive action.',
      dependencies,
      coverage: { inspected: dependencies.map((item) => ({ kind: item.kind, path: item.path })), not_inspected: ['runtime state outside the fixture'] },
      created_at: '2026-09-08T02:00:00.000Z', last_verified_at: '2026-09-08T02:01:00.000Z',
      confidence: 0.8, requires_fresh_read: true,
    };
  }

  async function runWorker(root, job) {
    const jobPath = path.join(root, `job-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await writeFile(jobPath, JSON.stringify(job));
    try {
      const script = new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1');
      const { stdout } = await execFileAsync(process.execPath, [script, '--worker', jobPath], { windowsHide: true, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout);
    } finally { await unlink(jobPath); }
  }

  test('unchanged dependency address is reused across fresh processes and exports exact readable provenance', async (t) => {
    const f = await fixture();
    t.after(() => rm(f.root, { recursive: true, force: true }));
    const original = understanding('architecture-alpha', 'architecture_overview', 'Alpha architecture', 'Alpha returns A.', [f.depA, f.depReceipt]);
    const first = await runWorker(f.root, { operation: 'put', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: original } });
    assert.equal(first.ok, true);
    assert.equal(first.result.disposition, 'CREATED');

    const alternateCandidate = { ...original, summary: 'A later model proposed different wording without a source delta.' };
    const reused = await runWorker(f.root, { operation: 'put', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: alternateCandidate } });
    assert.equal(reused.ok, true);
    assert.equal(reused.result.disposition, 'REUSED');
    assert.equal(reused.result.object.summary, 'Alpha returns A.');
    assert.equal(reused.result.object.current_truth, false);
    assert.equal(reused.result.object.authority, 'none');

    const exported = await runWorker(f.root, { operation: 'export', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, key: 'architecture-alpha' } });
    assert.equal(exported.ok, true);
    assert.match(exported.result.rendered_markdown, /Dependency address:/);
    assert.match(exported.result.rendered_markdown, new RegExp(f.depA.sha256));
    assert.match(exported.result.rendered_markdown, /Authority: derived candidate only/);
  });

  test('only objects depending on a changed or deleted input become stale, then changed input recompiles', async (t) => {
    const f = await fixture();
    t.after(() => rm(f.root, { recursive: true, force: true }));
    await runWorker(f.root, { operation: 'put', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('architecture-alpha', 'architecture_overview', 'Alpha', 'Alpha returns A.', [f.depA]) } });
    await runWorker(f.root, { operation: 'put', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('failure-beta', 'known_failure_boundary', 'Beta failure', 'Beta throws B.', [f.depB]) } });

    const changedBytes = Buffer.from('export function alpha() { return "A2"; }\n');
    await writeFile(path.join(f.sourceRoot, 'src', 'alpha.mjs'), changedBytes);
    const assessed = await runWorker(f.root, { operation: 'assess-cache', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots } });
    assert.equal(assessed.ok, true);
    assert.deepEqual(assessed.result.reusable, ['failure-beta']);
    assert.deepEqual(assessed.result.stale.map((item) => item.key), ['architecture-alpha']);
    assert.equal(assessed.result.stale[0].stale_dependencies[0].reason, 'DEPENDENCY_STALE_OR_FORGED');
    const staleRead = await runWorker(f.root, { operation: 'read', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, key: 'architecture-alpha' } });
    assert.deepEqual(staleRead, { ok: false, error: 'DEPENDENCIES_STALE' });

    const changedDep = { ...f.depA, sha256: sha256Bytes(changedBytes), bytes: changedBytes.length };
    const recompiled = await runWorker(f.root, { operation: 'put', options: { cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('architecture-alpha', 'architecture_overview', 'Alpha v2', 'Alpha returns A2.', [changedDep]) } });
    assert.equal(recompiled.ok, true);
    assert.equal(recompiled.result.disposition, 'RECOMPILED');
    assert.notEqual(recompiled.result.object.dependency_address, recompiled.result.previous_dependency_address);
    assert.equal((await readCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, key: 'architecture-alpha' })).summary, 'Alpha returns A2.');

    await unlink(path.join(f.sourceRoot, 'src', 'beta.mjs'));
    const deleted = await assessCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, key: 'failure-beta' });
    assert.equal(deleted.reusable, false);
    assert.equal(deleted.stale_dependencies[0].reason, 'DEPENDENCY_MISSING');
  });

  test('forged, out-of-scope, and corrupt compiled inputs fail closed', async (t) => {
    const f = await fixture();
    t.after(() => rm(f.root, { recursive: true, force: true }));
    const forged = { ...f.depA, sha256: 'f'.repeat(64) };
    await assert.rejects(
      putCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('forged', 'architecture_overview', 'Forged', 'Forged.', [forged]) }),
      /DEPENDENCY_STALE_OR_FORGED/,
    );
    const outside = { ...f.depA, path: 'src/outside.mjs' };
    await assert.rejects(
      putCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('outside', 'architecture_overview', 'Outside', 'Outside.', [outside]) }),
      /DEPENDENCY_OUT_OF_SCOPE/,
    );
    await putCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, understanding: understanding('architecture-alpha', 'architecture_overview', 'Alpha', 'Alpha.', [f.depA]) });
    await writeFile(path.join(f.cacheRoot, 'objects', 'architecture-alpha.json'), '{"schema":"histos.compiled-understanding-file/v0"}\n');
    const corrupt = await assessCompiledUnderstanding({ cacheRoot: f.cacheRoot, scope: f.scope, roots: f.roots, key: 'architecture-alpha' });
    assert.equal(corrupt.reusable, false);
    assert.equal(corrupt.reason, 'UNDERSTANDING_CORRUPT');
    assert.equal(corrupt.object, null);
  });
}

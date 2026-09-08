import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  captureMemory,
  memoryClaimSha256,
  sha256Bytes,
} from './evidence-memory.mjs';
import {
  createMemorySuppressionReader,
  readMemorySuppression,
  rebuildMemorySuppressionIndex,
} from './suppression-index.mjs';
import { createH03SleepInspector, enqueueSleep, inspectSleep, runSleep, sleepDigest } from '../sleep/sleep-consolidator.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const identity = ({ kind, path: filePath, sha256, bytes, start_line, end_line }) => ({
  kind, path: filePath, sha256, bytes, ...(start_line === undefined ? {} : { start_line, end_line }),
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-suppression-index-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source'), memoryRoot = path.join(root, 'memory'), indexRoot = path.join(root, 'suppression-index');
  await mkdir(sourceRoot); await mkdir(indexRoot);
  const scope = { scope_id: 'scope-index', source_paths: ['old.txt', 'new.txt', 'candidate.txt'], evidence_paths: [] };
  const approvals = [];
  const options = { memoryRoot, sourceRoot, scope };
  const verifyProvenance = async request => approvals.find(entry => entry.scope_id === request.scope_id &&
    entry.claim_sha256 === request.claim_sha256 && JSON.stringify(entry.reference) === JSON.stringify(request.reference)) ?? null;
  const trusted = { ...options, verifyProvenance };

  async function capture(id, relation = {}, status = 'verified') {
    const text = id === 'old' ? 'Historical procedure v1.\n' : id === 'new' ? 'Current correction v2.\n' : 'Candidate note.\n';
    const bytes = Buffer.from(text);
    const filePath = `${id}.txt`;
    await writeFile(path.join(sourceRoot, filePath), bytes);
    const reference = { kind: 'source', path: filePath, sha256: sha256Bytes(bytes), bytes: bytes.length,
      lineage_id: `caller:${id}`, provenance_kind: 'source', supports_claim: true };
    const input = { id, kind: 'semantic', title: id, summary: `Historical ${id}`, details: '', status, confidence: status === 'verified' ? 1 : 0,
      references: [reference], relations: relation, created_at: '2026-09-08T01:00:00.000Z', last_verified_at: '2026-09-08T01:01:00.000Z' };
    if (status === 'verified') approvals.push({ scope_id: scope.scope_id, claim_sha256: memoryClaimSha256({ scope, record: input }), reference: identity(reference),
      provenance_kind: 'independent_test', lineage_id: `host:${id}`, origin_sha256: hash(`origin:${id}`), supports_claim: true });
    return (await captureMemory({ ...trusted, record: input })).record;
  }
  return { root, sourceRoot, memoryRoot, indexRoot, scope, trusted, capture };
}

test('rebuild publishes deterministic active per-subject authority with exact reference identity', async t => {
  const f = await fixture(t);
  await f.capture('old');
  await f.capture('new', { supersedes: ['old'] });
  const first = await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  const old = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.equal(first.suppressions, 1);
  assert.equal(old.complete, true);
  assert.equal(old.authority_bytes, first.authority_bytes);
  assert.equal(old.suppressions.length, 1);
  assert.deepEqual(old.suppressions[0], {
    id: 'old', superseded_by: 'new', claim_sha256: first.suppressions === 1 ? old.suppressions[0].claim_sha256 : '', state: 'active',
    reason: null,
    references: [{ kind: 'source', path: 'new.txt', sha256: sha256Bytes(Buffer.from('Current correction v2.\n')), bytes: Buffer.byteLength('Current correction v2.\n') }],
  });
  const empty = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'new' });
  assert.deepEqual(empty.suppressions, []);
  const indexBefore = await readFile(path.join(f.indexRoot, 'index.json'));
  const second = await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  const indexAfter = await readFile(path.join(f.indexRoot, 'index.json'));
  assert.equal(second.authority_sha256, first.authority_sha256);
  assert.equal(second.authority_bytes, first.authority_bytes);
  assert.deepEqual(indexAfter, indexBefore);
  const reader = createMemorySuppressionReader({ indexRoot: f.indexRoot, scopeId: f.scope.scope_id });
  assert.deepEqual(await reader({ scope_id: f.scope.scope_id, resource_id: 'old' }), old);
});

test('stale and deleted corrections remain unresolved and never resurrect old history', async t => {
  const f = await fixture(t);
  await f.capture('old');
  await f.capture('new', { supersedes: ['old'] });
  await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  await writeFile(path.join(f.sourceRoot, 'new.txt'), 'changed correction bytes');
  const stale = await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  const staleProjection = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.equal(stale.suppressions, 1);
  assert.equal(staleProjection.suppressions[0].state, 'unresolved');
  assert.equal(staleProjection.suppressions[0].reason, 'REFERENCE_STALE_OR_FORGED');
  assert.equal(staleProjection.suppressions[0].references[0].bytes, Buffer.byteLength('Current correction v2.\n'));
  await unlink(path.join(f.memoryRoot, 'records', 'new.json'));
  await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  const deletedProjection = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.equal(deletedProjection.suppressions[0].state, 'unresolved');
  assert.equal(deletedProjection.suppressions[0].reason, 'MEMORY_MISSING');
  // A failed rebuild must not destroy the last committed projection.
  await writeFile(path.join(f.memoryRoot, 'supersessions', 'new.json'), '{}');
  await assert.rejects(rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted }), /MEMORY_SUPERSESSION_UNRESOLVED/);
  const retained = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.equal(retained.suppressions[0].reason, 'MEMORY_MISSING');
});

test('missing, corrupt, cross-scope and oversized identities fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' }), /INDEX_MISSING/);
  await f.capture('old');
  await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  await assert.rejects(readMemorySuppression({ indexRoot: f.indexRoot, scope_id: 'other', resource_id: 'old' }), /SCOPE_MISMATCH/);
  await assert.rejects(readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'does-not-exist' }), /SUBJECT_MISSING/);
  await assert.rejects(readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'x'.repeat(129) }), /SUBJECT_OVERSIZED/);
  await writeFile(path.join(f.indexRoot, 'index.json'), '{corrupt');
  await assert.rejects(readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'old' }), /INDEX_CORRUPT/);
});

test('candidate records can be indexed for lookup but cannot create suppression authority', async t => {
  const f = await fixture(t);
  await f.capture('candidate', {}, 'candidate');
  const result = await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  assert.equal(result.suppressions, 0);
  const projection = await readMemorySuppression({ indexRoot: f.indexRoot, scope_id: f.scope.scope_id, resource_id: 'candidate' });
  assert.deepEqual(projection.suppressions, []);
});

test('reader refreshes one H03 snapshot and serves bounded exact lookups without per-delta recall', async t => {
  const f = await fixture(t);
  await f.capture('old');
  await f.capture('new', { supersedes: ['old'] });
  let verifierCalls = 0;
  const verifier = f.trusted.verifyProvenance;
  const memory = { ...f.trusted, verifyProvenance: async request => { verifierCalls++; return verifier(request); } };
  const reader = createMemorySuppressionReader({ indexRoot: f.indexRoot, memory });
  await assert.rejects(reader({ scope_id: f.scope.scope_id, resource_id: 'old' }), /SNAPSHOT_REQUIRED/);
  const first = await reader.refresh();
  assert.equal(first.complete, true);
  assert.equal(first.scope_id, f.scope.scope_id);
  assert.match(first.authority_sha256, /^[a-f0-9]{64}$/);
  const recallCallsAfterRefresh = verifierCalls;
  assert.ok(recallCallsAfterRefresh > 0);
  const old = await reader({ scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.deepEqual(Object.keys(old).sort(), ['authority_bytes', 'authority_sha256', 'complete', 'resource_id', 'schema', 'scope_id', 'suppressions'].sort());
  assert.equal(old.resource_id, 'old');
  assert.equal(old.scope_id, f.scope.scope_id);
  assert.equal(old.complete, true);
  assert.equal(old.authority_sha256, first.authority_sha256);
  assert.equal(old.suppressions[0].state, 'active');
  // Each lookup is a map read; no verifier/reacall pass occurs for bursts.
  for (let index = 0; index < 100; index++) {
    const projection = await reader({ scope_id: f.scope.scope_id, resource_id: index % 2 ? 'old' : 'new' });
    assert.equal(projection.authority_sha256, first.authority_sha256);
  }
  assert.equal(verifierCalls, recallCallsAfterRefresh);

  // A source transition is explicit: refresh once, then the same old subject
  // remains suppressed but its correction is marked unresolved.
  await writeFile(path.join(f.sourceRoot, 'new.txt'), 'changed correction bytes');
  const second = await reader.refresh();
  assert.notEqual(second.authority_sha256, first.authority_sha256);
  assert.ok(verifierCalls > recallCallsAfterRefresh);
  const unresolved = await reader({ scope_id: f.scope.scope_id, resource_id: 'old' });
  assert.equal(unresolved.suppressions[0].state, 'unresolved');
  assert.equal(unresolved.suppressions[0].reason, 'REFERENCE_STALE_OR_FORGED');
  await assert.rejects(reader({ scope_id: 'other', resource_id: 'old' }), /SCOPE_MISMATCH/);
  await assert.rejects(reader({ scope_id: f.scope.scope_id, resource_id: 'not-indexed' }), /SUBJECT_MISSING/);
});

test('failed refresh invalidates the cached reader instead of serving forged or partial authority', async t => {
  const f = await fixture(t);
  await f.capture('old');
  await f.capture('new', { supersedes: ['old'] });
  const reader = createMemorySuppressionReader({ indexRoot: f.indexRoot, memory: f.trusted });
  await reader.refresh();
  await writeFile(path.join(f.memoryRoot, 'supersessions', 'new.json'), '{}');
  await assert.rejects(reader.refresh(), /MEMORY_SUPERSESSION_UNRESOLVED/);
  await assert.rejects(reader({ scope_id: f.scope.scope_id, resource_id: 'old' }), /SNAPSHOT_REQUIRED/);
});

test('source-owned reader is a bounded H04 Sleep callback and suppresses before candidate read', async t => {
  const f = await fixture(t);
  const old = await f.capture('old');
  await f.capture('new', { supersedes: ['old'] });
  await rebuildMemorySuppressionIndex({ indexRoot: f.indexRoot, memory: f.trusted });
  const reader = createMemorySuppressionReader({ indexRoot: f.indexRoot, scopeId: f.scope.scope_id });
  const inspector = createH03SleepInspector({ memory: f.trusted, readMemorySuppression: reader });
  const sleepRoot = path.join(f.root, 'sleep');
  await enqueueSleep({ root: sleepRoot, scopeId: f.scope.scope_id, events: [{ id: 'old-delta', scope_id: f.scope.scope_id, kind: 'memory', resource_id: 'old', fingerprint: sleepDigest(old), declared_bytes: 1024 }] });
  const receipt = await runSleep({ root: sleepRoot, scopeId: f.scope.scope_id, inspect: inspector });
  assert.equal(receipt.processed, 1);
  assert.deepEqual((await inspectSleep({ root: sleepRoot, scopeId: f.scope.scope_id })).usable_candidates, []);
  assert.equal(reader.getStats().lookups, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { enqueueSleep, runSleep, inspectSleep, sleepDigest, recoverSleepWriter, createH03SleepInspector } from './sleep-consolidator.mjs';
import { putCompiledUnderstanding } from '../understanding/compiled-understanding.mjs';
import { captureMemory, memoryClaimSha256, recallMemory } from '../memory/evidence-memory.mjs';

const exec = promisify(execFile), scopeId = 'scope-a';
const digest = data => createHash('sha256').update(data).digest('hex');
const emptyFixtureSuppression = async request => ({ ...request, complete: true, authority_sha256: digest('test-host-empty-suppression-registry'), authority_bytes: Buffer.byteLength('test-host-empty-suppression-registry'), suppressions: [] });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'histos-sleep-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, scopeId };
}
const event = (id, resource = 'resource', version = id, declared_bytes = 10) => ({ id, resource_id: resource, kind: 'memory', scope_id: scopeId, fingerprint: digest(version), declared_bytes });
// Deterministic unit inspector is a trusted-boundary fixture, never host proof.
const inspection = (item, extra = {}) => ({ scope_id: scopeId, fingerprint: item.fingerprint,
  references: [{ kind: 'source', path: 'fixture.txt', sha256: digest('fixture'), bytes: 7 }],
  claim_sha256: digest('fixture-claim'), verified: true, relations: { contradicts: [], supersedes: [] }, authority: 'none', current_truth: false, ...extra });

test('burst coalesces exact resource deltas and retains durable coverage/idempotency', async t => {
  const f = await fixture(t), batch = Array.from({ length: 100 }, (_, i) => event(`event-${i}`));
  assert.equal((await enqueueSleep({ ...f, events: batch })).pending, 1);
  let calls = 0;
  const result = await runSleep({ ...f, inspect: async item => { calls++; return inspection(item); } });
  assert.equal(calls, 1); assert.equal(result.coalesced, 99); assert.equal(result.cursor, 100);
  assert.equal((await enqueueSleep({ ...f, events: batch })).duplicates, 100);
  const state = await inspectSleep(f);
  assert.equal(state.usable_candidates.length, 1);
  assert.equal(state.usable_candidates[0].status, 'sleep_candidate');
  assert.equal(state.usable_candidates[0].coverage_sequences.length, 100);
  assert.deepEqual(state.coverage, { accepted: 100, cursor: 100, deferred: [] });
  await assert.rejects(enqueueSleep({ ...f, events: [event('event-0', 'other')] }), /ID_CONFLICT/);
});

test('resource and byte budgets defer work without losing input; poison does not starve next resource', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('a', 'a'), event('b', 'b'), event('c', 'c', 'c', 100)] });
  const inspect = async item => { if (item.resource_id === 'a') throw new Error('SOURCE_STALE'); return inspection(item); };
  const first = await runSleep({ ...f, inspect, maxResources: 1 });
  assert.equal(first.failed, 1); assert.equal(first.cursor, 0);
  const second = await runSleep({ ...f, inspect, maxResources: 2, maxDeclaredBytes: 10 });
  assert.equal(second.processed, 1); assert.equal(second.attempted, 1);
  const state = await inspectSleep(f);
  assert.deepEqual(state.coverage.deferred, [1, 3]);
  assert.equal(state.pending['memory:c'].reason, 'BYTE_BUDGET_DEFERRED');
  const third = await runSleep({ ...f, inspect: async item => inspection(item) });
  assert.equal(third.cursor, 3); assert.equal(third.pending, 0); assert.equal(third.model_calls, 0);
});

test('elapsed time stops new admissions; invalid budgets and underdeclared output are refused', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('a', 'a', 'a', 1), event('b', 'b')] });
  let clock = 0;
  const result = await runSleep({ ...f, inspect: async item => { clock = 100; return inspection(item); }, now: () => clock, maxMilliseconds: 50 });
  assert.equal(result.attempted, 1); assert.equal(result.failed, 1);
  assert.match(result.outcomes[0].reason, /DECLARED_BYTES_EXCEEDED/);
  await assert.rejects(runSleep({ ...f, inspect: async () => {}, maxResources: Infinity }), /INVALID_RESOURCE_BUDGET/);
});

test('stale correction never resurrects superseded history; candidate-only output cannot supersede', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('old', 'old'), event('new', 'new')] });
  await runSleep({ ...f, inspect: async item => inspection(item, item.resource_id === 'new' ? { relations: { supersedes: ['old'], contradicts: [] } } : {}) });
  assert.deepEqual((await inspectSleep(f)).usable_candidates.map(item => item.key), ['memory:new']);
  await enqueueSleep({ ...f, events: [event('new-change', 'new')] });
  assert.equal((await inspectSleep(f)).usable_candidates.length, 0);
  await runSleep({ ...f, inspect: async () => { throw new Error('REFERENCE_MISSING'); } });
  const state = await inspectSleep(f);
  assert.equal(state.usable_candidates.length, 0); assert.equal(state.tombstones['memory:old'].length, 1);
  assert.equal(state.candidates.find(item => item.key === 'memory:new').state, 'stale');
  await runSleep({ ...f, inspect: async item => inspection(item, { verified: false, relations: { supersedes: ['old'], contradicts: [] } }) });
  assert.match((await inspectSleep(f)).pending['memory:new'].reason, /UNVERIFIED_SUPERSESSION/);
});

test('before-commit failure rolls back whole transaction, after-commit retry is idempotent', async t => {
  const f = await fixture(t), batch = [event('first')];
  await enqueueSleep({ ...f, events: batch });
  const failAt = phase => async actual => { if (actual === phase) throw new Error(`INJECTED_${phase}`); };
  await assert.rejects(runSleep({ ...f, inspect: async item => inspection(item), fault: failAt('before_commit') }), /INJECTED/);
  assert.equal((await inspectSleep(f)).cursor, 0);
  await assert.rejects(runSleep({ ...f, inspect: async item => inspection(item), fault: failAt('after_commit') }), /INJECTED/);
  assert.equal((await inspectSleep(f)).cursor, 1);
  let calls = 0;
  await runSleep({ ...f, inspect: async item => { calls++; return inspection(item); } });
  assert.equal(calls, 0);
  assert.equal((await enqueueSleep({ ...f, events: batch })).duplicates, 1);
});

test('real child process interruption leaves a recoverable lock and replays only uncommitted work', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('first')] });
  const worker = path.join(f.root, 'worker.mjs');
  await writeFile(worker, `import { runSleep } from ${JSON.stringify(new URL('./sleep-consolidator.mjs', import.meta.url).href)};\nawait runSleep({root:${JSON.stringify(f.root)},scopeId:${JSON.stringify(scopeId)},inspect:async item=>(${inspection.toString()})(item),fault:async phase=>{if(phase==='before_commit')process.exit(23)}});`);
  // Inline fixture helper requires its independent hash constants in child.
  const code = await readFile(worker, 'utf8');
  await writeFile(worker, `import { createHash } from 'node:crypto'; const scopeId=${JSON.stringify(scopeId)}; const digest=data=>createHash('sha256').update(data).digest('hex');\n${code}`);
  await assert.rejects(exec(process.execPath, [worker], { windowsHide: true }), error => error.code === 23);
  const lock = JSON.parse(await readFile(path.join(f.root, 'writer.lock'), 'utf8'));
  assert.equal((await inspectSleep(f)).cursor, 0);
  await assert.rejects(runSleep({ ...f, inspect: async item => inspection(item) }), /WRITER_BUSY/);
  await assert.rejects(recoverSleepWriter({ root: f.root, expectedToken: 'wrong' }), /IDENTITY_MISMATCH/);
  await recoverSleepWriter({ root: f.root, expectedToken: lock.token });
  assert.equal((await runSleep({ ...f, inspect: async item => inspection(item) })).cursor, 1);
});

test('state hash corruption and cross-scope replay fail closed', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('a')] });
  await assert.rejects(inspectSleep({ ...f, scopeId: 'scope-b' }), /SCOPE_MISMATCH/);
  const file = path.join(f.root, 'state.json'), envelope = JSON.parse(await readFile(file, 'utf8'));
  envelope.state.cursor = 99; await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(inspectSleep(f), /STATE_CORRUPT/);
});

test('live writer excludes competing mutations and cannot be taken over', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('a')] });
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const admission = new Promise(resolve => { entered = resolve; });
  const run = runSleep({ ...f, inspect: async item => { entered(); await waiting; return inspection(item); } });
  await admission;
  try {
    const owner = JSON.parse(await readFile(path.join(f.root, 'writer.lock'), 'utf8'));
    await assert.rejects(enqueueSleep({ ...f, events: [event('b')] }), /WRITER_BUSY/);
    await assert.rejects(recoverSleepWriter({ root: f.root, expectedToken: owner.token }), /OWNER_STILL_ALIVE/);
  } finally { release(); }
  await run;
  assert.equal((await inspectSleep(f)).coverage.accepted, 1);
});

test('replacement retains exact previous lineage, while duplicate groups add no support', async t => {
  const f = await fixture(t);
  await enqueueSleep({ ...f, events: [event('a1', 'a'), event('b1', 'b')] });
  await runSleep({ ...f, inspect: async item => inspection(item) });
  assert.equal((await inspectSleep(f)).duplicate_groups[0].independent_support_added, 0);
  await enqueueSleep({ ...f, events: [event('a2', 'a')] });
  assert.deepEqual((await inspectSleep(f)).usable_candidates.map(item => item.key), ['memory:b']);
  await runSleep({ ...f, inspect: async item => inspection(item, { summary: 'Updated local fixture candidate' }) });
  const state = await inspectSleep(f);
  assert.equal(state.history['memory:a'][0].fingerprint, event('a1', 'a').fingerprint);
  assert.equal(state.history['memory:a'][0].references[0].sha256, digest('fixture'));
  assert.equal(state.duplicate_groups.length, 0);
});

test('H03 public adapter actually verifies exact source dependencies and invalidates changed source only', async t => {
  const f = await fixture(t), sourceRoot = path.join(f.root, 'sources'), cacheRoot = path.join(f.root, 'cache');
  await mkdir(sourceRoot); await writeFile(path.join(sourceRoot, 'a.txt'), 'version-one'); await writeFile(path.join(sourceRoot, 'b.txt'), 'stable');
  const scope = { scope_id: scopeId, paths_by_kind: { source: ['a.txt', 'b.txt'] } }, roots = { source: sourceRoot };
  const objects = [];
  for (const [key, source, text] of [['a', 'a.txt', 'version-one'], ['b', 'b.txt', 'stable']]) {
    const object = (await putCompiledUnderstanding({ cacheRoot, scope, roots, understanding: {
      key, kind: 'architecture_overview', title: key, summary: 'fixture summary', details: 'Data only',
      dependencies: [{ kind: 'source', path: source, sha256: digest(text), bytes: Buffer.byteLength(text) }],
      coverage: { inspected: [{ kind: 'source', path: source }], not_inspected: [] },
      created_at: '2026-09-08T01:00:00.000Z', last_verified_at: '2026-09-08T01:00:00.000Z' } })).object;
    objects.push(object);
  }
  const inspector = createH03SleepInspector({ understanding: { cacheRoot, scope, roots } });
  await enqueueSleep({ ...f, events: objects.map(object => ({ ...event(`initial-${object.key}`, object.key), kind: 'understanding', fingerprint: sleepDigest(object), declared_bytes: 100 })) });
  assert.equal((await runSleep({ ...f, inspect: inspector })).processed, 2);
  await writeFile(path.join(sourceRoot, 'a.txt'), 'version-two');
  await enqueueSleep({ ...f, events: [{ ...event('changed-a', 'a'), kind: 'understanding', fingerprint: sleepDigest(objects[0]), declared_bytes: 100 }] });
  const receipt = await runSleep({ ...f, inspect: inspector });
  assert.equal(receipt.attempted, 1); assert.match(receipt.outcomes[0].reason, /DEPENDENCIES_STALE/);
  assert.deepEqual((await inspectSleep(f)).usable_candidates.map(item => item.key), ['understanding:b']);
});

test('H03 candidate memory remains unsupported candidate, and missing trusted provenance cannot be invented by Sleep', async t => {
  const f = await fixture(t), sourceRoot = path.join(f.root, 'source'), memoryRoot = path.join(f.root, 'memory');
  await mkdir(sourceRoot); await writeFile(path.join(sourceRoot, 'source.txt'), 'fixture');
  const scope = { scope_id: scopeId, source_paths: ['source.txt'], evidence_paths: [] };
  const options = { memoryRoot, sourceRoot, scope };
  const record = { id: 'candidate', kind: 'semantic', title: 'Candidate', summary: 'Unsupported fixture candidate', details: '', status: 'candidate', confidence: 0,
    created_at: '2026-09-08T01:00:00.000Z', last_verified_at: '2026-09-08T01:00:00.000Z',
    references: [{ kind: 'source', path: 'source.txt', sha256: digest('fixture'), bytes: 7, lineage_id: 'caller', provenance_kind: 'source', supports_claim: true }] };
  const captured = (await captureMemory({ ...options, record })).record;
  const input = { ...event('candidate-event', 'candidate'), fingerprint: sleepDigest(captured) };
  await enqueueSleep({ ...f, events: [input] });
  await runSleep({ ...f, inspect: createH03SleepInspector({ memory: options, readMemorySuppression: emptyFixtureSuppression }) });
  const output = (await inspectSleep(f)).usable_candidates[0];
  assert.equal(output.verified, false); assert.equal(output.verification.independent_support_count, 0);
  assert.equal(output.status, 'sleep_candidate');
  await assert.rejects(captureMemory({ ...options, record: { ...record, id: 'forged', status: 'verified' } }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
  const deprecated = (await captureMemory({ ...options, record: { ...record, id: 'deprecated', status: 'deprecated' } })).record;
  await enqueueSleep({ ...f, events: [{ ...event('deprecated-event', 'deprecated'), fingerprint: sleepDigest(deprecated) }] });
  const refused = await runSleep({ ...f, inspect: createH03SleepInspector({ memory: options, readMemorySuppression: emptyFixtureSuppression }) });
  assert.match(refused.outcomes[0].reason, /MEMORY_DEPRECATED/);
  assert.deepEqual((await inspectSleep(f)).usable_candidates.map(item => item.key), ['memory:candidate']);
});

test('H04-IV-01 initial sleep honors H03 suppression when correction source and record are stale/deleted', async t => {
  const f = await fixture(t), sourceRoot = path.join(f.root, 'source'), memoryRoot = path.join(f.root, 'memory');
  await mkdir(sourceRoot);
  const scope = { scope_id: scopeId, source_paths: ['old.txt', 'new.txt'], evidence_paths: [] }, approvals = [];
  const options = { memoryRoot, sourceRoot, scope, verifyProvenance: async request => approvals.find(entry => entry.scope_id === request.scope_id && entry.claim_sha256 === request.claim_sha256 && sleepDigest(entry.reference) === sleepDigest(request.reference)) ?? null };
  async function captured(id, relations = {}) {
    const bytes = `Historical ${id}`; await writeFile(path.join(sourceRoot, `${id}.txt`), bytes);
    const reference = { kind: 'source', path: `${id}.txt`, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) };
    const input = { id, kind: 'semantic', title: id, summary: bytes, details: '', status: 'verified', confidence: 1, relations,
      references: [{ ...reference, lineage_id: 'caller', provenance_kind: 'source', supports_claim: true }],
      created_at: '2026-09-08T01:00:00.000Z', last_verified_at: '2026-09-08T01:00:00.000Z' };
    approvals.push({ scope_id: scopeId, claim_sha256: memoryClaimSha256({ scope, record: input }), reference, provenance_kind: 'independent_test', lineage_id: `host-${id}`, origin_sha256: digest(`origin-${id}`), supports_claim: true });
    return (await captureMemory({ ...options, record: input })).record;
  }
  const records = [await captured('old'), await captured('new', { supersedes: ['old'] })];
  await writeFile(path.join(sourceRoot, 'new.txt'), 'changed');
  const events = records.map(record => ({ ...event(`event-${record.id}`, record.id), fingerprint: sleepDigest(record), declared_bytes: 100 }));
  await enqueueSleep({ ...f, events });
  const absent = await runSleep({ ...f, inspect: createH03SleepInspector({ memory: options }) });
  assert.equal(absent.failed, 2); assert.equal((await inspectSleep(f)).usable_candidates.length, 0);
  assert.ok(absent.outcomes.every(item => item.reason === 'SLEEP_SUPPRESSION_AUTHORITY_REQUIRED'));
  for (const deleted of [false, true]) {
    if (deleted) { await rm(path.join(sourceRoot, 'new.txt')); await rm(path.join(memoryRoot, 'records', 'new.json')); }
    // Test host materializes public H03 authority once per source transition;
    // Sleep performs only bounded subject lookups, never full-history scans.
    const authority = await recallMemory(options);
    assert.equal(authority.records.length, 0); assert.equal(authority.supersessions[0].state, 'unresolved');
    let lookups = 0;
    const authorityText = JSON.stringify(authority);
    const readMemorySuppression = async request => { lookups++; return { ...request, complete: true, authority_sha256: sleepDigest(authority), authority_bytes: Buffer.byteLength(authorityText), suppressions: authority.supersessions.filter(marker => marker.id === request.resource_id) }; };
    const isolated = { root: path.join(f.root, deleted ? 'deleted-case' : 'stale-case'), scopeId };
    await enqueueSleep({ ...isolated, events });
    await runSleep({ ...isolated, inspect: createH03SleepInspector({ memory: options, readMemorySuppression }) });
    const observed = await inspectSleep(isolated);
    assert.equal(lookups, 2); assert.equal(observed.usable_candidates.length, 0);
    assert.equal(observed.tombstones['memory:old'][0].by, 'memory:new');
    assert.equal(observed.tombstones['memory:old'][0].claim_sha256, authority.supersessions[0].claim_sha256);
  }
});

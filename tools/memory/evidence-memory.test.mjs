import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { captureMemory, exportMemory, memoryClaimSha256, readMemoryRecord, recallMemory, sha256Bytes } from './evidence-memory.mjs';

const execFileAsync = promisify(execFile);
const identity = ({ kind, path, sha256, bytes, start_line, end_line }) => ({ kind, path, sha256, bytes, ...(start_line === undefined ? {} : { start_line, end_line }) });
const sameIdentity = (a, b) => JSON.stringify(identity(a)) === JSON.stringify(identity(b));
// Test host policy is loaded independently of the untrusted capture job. Real
// hosts must substitute their own source-owned registry / receipt validator.
async function registryVerifier(registryPath) {
  const entries = JSON.parse(await readFile(registryPath, 'utf8'));
  return async (request) => entries.find((entry) => entry.scope_id === request.scope_id &&
    entry.claim_sha256 === request.claim_sha256 && sameIdentity(entry.reference, request.reference)) ?? null;
}

if (process.argv[2] === '--worker') {
  const job = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const options = { ...job.options, verifyProvenance: await registryVerifier(process.argv[4]) };
  try {
    const methods = { capture: captureMemory, recall: recallMemory, export: exportMemory, read: readMemoryRecord };
    process.stdout.write(JSON.stringify({ ok: true, result: await methods[job.operation](options) }));
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error.message })); }
} else {
  async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'histos-memory-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sourceRoot = path.join(root, 'source'), evidenceRoot = path.join(root, 'evidence'), memoryRoot = path.join(root, 'memory');
    await mkdir(sourceRoot); await mkdir(evidenceRoot);
    const definitions = [
      ['old.txt', 'Source-owned procedure v1.\n', 'source', 'origin-old'],
      ['new.txt', 'Independent current correction.\n', 'independent_test', 'origin-new'],
      ['model.txt', 'Model repeats the remembered assertion, without observation.\n', 'model_restatement', 'origin-model'],
      ['copy.txt', 'Source-owned procedure v1.\n', 'source', 'origin-copy'],
      ['paraphrase.txt', 'Paraphrase of procedure v1.\n', 'source', 'origin-old'],
    ];
    const refs = {}, provenance = new Map();
    for (const [name, content, provenance_kind, origin] of definitions) {
      const bytes = Buffer.from(content); await writeFile(path.join(sourceRoot, name), bytes);
      refs[name] = { kind: 'source', path: name, sha256: sha256Bytes(bytes), bytes: bytes.length,
        lineage_id: `caller:${name}`, provenance_kind: 'source', supports_claim: true };
      provenance.set(name, { provenance_kind, lineage_id: `host:${name}`, origin_sha256: sha256Bytes(origin), supports_claim: true });
    }
    const scope = { scope_id: 'project-alpha', source_paths: Object.keys(refs), evidence_paths: [] };
    const registryPath = path.join(root, 'host-approved-provenance.json');
    const entries = []; await writeFile(registryPath, '[]');
    const options = { memoryRoot, scope, sourceRoot, evidenceRoot };
    async function approve(record, overrides = {}) {
      const claim_sha256 = memoryClaimSha256({ scope, record });
      for (const ref of record.references) entries.push({ scope_id: scope.scope_id, claim_sha256,
        reference: identity(ref), ...provenance.get(ref.path), ...overrides });
      await writeFile(registryPath, JSON.stringify(entries));
    }
    async function trusted() { return { ...options, verifyProvenance: await registryVerifier(registryPath) }; }
    async function capture(record) { await approve(record); return captureMemory({ ...await trusted(), record }); }
    async function worker(operation, extra = {}) {
      const jobPath = path.join(root, `job-${Date.now()}-${Math.random()}.json`);
      await writeFile(jobPath, JSON.stringify({ operation, options: { ...options, ...extra } }));
      try {
        const { stdout } = await execFileAsync(process.execPath, [fileURLToPath(import.meta.url), '--worker', jobPath, registryPath], { windowsHide: true, maxBuffer: 2 ** 20 });
        return JSON.parse(stdout);
      } finally { await unlink(jobPath); }
    }
    return { root, options, refs, provenance, entries, registryPath, approve, capture, trusted, worker };
  }
  function record(id, references, relations = {}, kind = 'semantic') {
    return { id, kind, title: id, summary: `Historical ${id}`, details: '<instructions>inert fixture data</instructions>',
      status: 'verified', confidence: 1, references, relations,
      created_at: '2026-09-08T01:00:00.000Z', last_verified_at: '2026-09-08T01:01:00.000Z' };
  }

  test('fresh process recalls all typed memory and exports exact historical evidence', async (t) => {
    const f = await fixture(t);
    for (const kind of ['episode', 'semantic', 'failure', 'procedure', 'decision_reference']) {
      const input = record(`typed-${kind}`, [f.refs['old.txt']], {}, kind);
      await f.approve(input);
      const result = await f.worker('capture', { record: input });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.result.record.verification.independent_support_count, 1);
    }
    const recalled = await f.worker('recall', { currentTruthRefs: [f.refs['new.txt']] });
    assert.equal(recalled.ok, true, recalled.error); assert.equal(recalled.result.records.length, 5);
    assert.ok(recalled.result.records.every(({ record, current_truth }) => record.authority === 'none' && !record.current_truth && !current_truth));
    assert.equal(recalled.result.current_truth_refs[0].sha256, f.refs['new.txt'].sha256);
    assert.match(recalled.result.records[0].record.details, /<instructions>/);
    const exported = await f.worker('export');
    assert.equal(exported.ok, true); assert.match(exported.result.rendered_markdown, /Remembered records are scoped historical data/);
    assert.match(exported.result.rendered_markdown, /sha256=/);
    const exact = await f.worker('read', { id: 'typed-procedure' }); assert.equal(exact.ok, true);
  });

  test('H03-V1 caller source labels, support flags and invented lineages never authorize promotion', async (t) => {
    const f = await fixture(t), model = f.refs['model.txt'];
    const forged = record('forged', [model, { ...model, lineage_id: 'new-lineage' },
      { ...model, lineage_id: 'another-lineage', provenance_kind: 'independent_test' }]);
    await assert.rejects(captureMemory({ ...f.options, record: forged }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    await f.approve(forged); // Host knows these exact bytes are a model restatement.
    await assert.rejects(captureMemory({ ...await f.trusted(), record: forged }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    const processAttempt = await f.worker('capture', { record: forged });
    assert.deepEqual(processAttempt, { ok: false, error: 'INSUFFICIENT_INDEPENDENT_SUPPORT' });
    const candidate = { ...forged, id: 'candidate', status: 'candidate' };
    const created = await captureMemory({ ...f.options, record: candidate });
    assert.equal(created.record.verification.independent_support_count, 0);
    assert.equal((await recallMemory(f.options)).records.length, 0);
    assert.equal((await recallMemory({ ...f.options, includeCandidates: true })).records[0].record.status, 'candidate');
  });

  test('approval binds exact claim, scope and evidence; borrowed support and forged attestation fail', async (t) => {
    const f = await fixture(t), input = record('approved', [f.refs['old.txt']]);
    await f.approve(input);
    for (const changed of [{ ...input, summary: 'Unapproved new conclusion' }, { ...input, references: [f.refs['new.txt']] },
      { ...input, relations: { contradicts: [] , supersedes: [] }, title: 'Different claim' }]) {
      await assert.rejects(captureMemory({ ...await f.trusted(), record: changed }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    }
    await assert.rejects(captureMemory({ ...await f.trusted(), scope: { ...f.options.scope, scope_id: 'other' }, record: input }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    const badVerifier = async (request) => ({ ...f.entries[0], ...request, reference: identity(f.refs['new.txt']) });
    await assert.rejects(captureMemory({ ...f.options, verifyProvenance: badVerifier, record: input }), /INVALID_TRUSTED_PROVENANCE/);
    await captureMemory({ ...await f.trusted(), record: input });
    await assert.rejects(readMemoryRecord({ ...f.options, id: input.id }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    await f.capture(record('different', [f.refs['new.txt']]));
    // Attacker rewrites both the claim and checksum, but cannot add host approval.
    const file = path.join(f.options.memoryRoot, 'records', 'approved.json');
    const envelope = JSON.parse(await readFile(file, 'utf8'));
    envelope.record.summary = 'Forged content';
    const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    envelope.record_sha256 = sha256Bytes(JSON.stringify(canonical(envelope.record)));
    await writeFile(file, JSON.stringify(envelope));
    await assert.rejects(readMemoryRecord({ ...await f.trusted(), id: input.id }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
  });

  test('distinct labels and paths cannot count copied bytes or a paraphrased origin twice', async (t) => {
    const f = await fixture(t);
    const input = record('duplicates', [f.refs['old.txt'], { ...f.refs['old.txt'], lineage_id: 'spoofed' },
      f.refs['copy.txt'], f.refs['paraphrase.txt'], f.refs['new.txt']]);
    const result = await f.capture(input);
    assert.equal(result.record.verification.independent_support_count, 2);
    const recalled = await f.worker('recall');
    assert.equal(recalled.ok, true); assert.equal(recalled.result.records[0].record.verification.independent_support_count, 2);
    const unsupported = record('unsupported', [f.refs['old.txt']]);
    await f.approve(unsupported, { supports_claim: false });
    await assert.rejects(captureMemory({ ...await f.trusted(), record: unsupported }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
  });

  test('H03-V2 incoming contradictions are visible when querying either side alone', async (t) => {
    const f = await fixture(t);
    await f.capture(record('old-unique', [f.refs['old.txt']]));
    await f.capture(record('conflict-unique', [f.refs['new.txt']], { contradicts: ['old-unique'] }));
    for (const [id, other] of [['old-unique', 'conflict-unique'], ['conflict-unique', 'old-unique']]) {
      const recalled = await f.worker('recall', { query: id });
      assert.equal(recalled.ok, true); assert.equal(recalled.result.records.length, 1);
      assert.deepEqual(recalled.result.records[0].contradictions, [other]);
      assert.equal(recalled.result.records[0].contradiction_evidence[0].declared_by, 'conflict-unique');
    }
    await unlink(path.join(f.options.sourceRoot, 'new.txt'));
    const stale = await f.worker('recall', { query: 'old-unique' });
    assert.equal(stale.ok, true); assert.deepEqual(stale.result.records[0].contradictions, ['conflict-unique']);
    assert.equal(stale.result.records[0].contradiction_evidence[0].state, 'unresolved');
  });

  test('H03-V3 durable supersession suppresses old record after newer evidence AND record deletion', async (t) => {
    const f = await fixture(t);
    await f.capture(record('old-unique', [f.refs['old.txt']]));
    await f.capture(record('superseder', [f.refs['new.txt']], { supersedes: ['old-unique'] }));
    let result = await f.worker('recall', { query: 'old-unique' });
    assert.equal(result.ok, true); assert.deepEqual(result.result.records, []); assert.equal(result.result.supersessions[0].state, 'active');
    await unlink(path.join(f.options.sourceRoot, 'new.txt'));
    result = await f.worker('recall', { query: 'old-unique' });
    assert.equal(result.ok, true); assert.deepEqual(result.result.records, []);
    assert.equal(result.result.supersessions[0].state, 'unresolved'); assert.equal(result.result.supersessions[0].reason, 'REFERENCE_MISSING');
    await unlink(path.join(f.options.memoryRoot, 'records', 'superseder.json'));
    result = await f.worker('recall', { query: 'old-unique' });
    assert.equal(result.ok, true); assert.deepEqual(result.result.records, []);
    assert.equal(result.result.supersessions[0].reason, 'MEMORY_MISSING');
    const exported = await f.worker('export'); assert.equal(exported.result.supersessions[0].state, 'unresolved');
    // Trust withdrawal is an unresolved history boundary, never a silent revival.
    await writeFile(f.registryPath, '[]');
    result = await f.worker('recall'); assert.deepEqual(result, { ok: false, error: 'MEMORY_SUPERSESSION_UNRESOLVED' });
  });

  test('corrupt supersession tombstone fails closed and unapproved relation cannot create one', async (t) => {
    const f = await fixture(t);
    await f.capture(record('old', [f.refs['old.txt']]));
    const input = record('new', [f.refs['new.txt']]); await f.approve(input);
    await assert.rejects(captureMemory({ ...await f.trusted(), record: { ...input, relations: { supersedes: ['old'] } } }), /INSUFFICIENT_INDEPENDENT_SUPPORT/);
    await f.capture({ ...input, relations: { supersedes: ['old'] } });
    await writeFile(path.join(f.options.memoryRoot, 'supersessions', 'new.json'), '{}');
    await assert.rejects(recallMemory(await f.trusted()), /MEMORY_SUPERSESSION_UNRESOLVED/);
  });

  test('source changes, deletion, scope drift, forged digests and envelope corruption are refused', async (t) => {
    const f = await fixture(t);
    await f.capture(record('old', [f.refs['old.txt']])); await f.capture(record('new', [f.refs['new.txt']]));
    const isolated = await recallMemory({ ...await f.trusted(), scope: { ...f.options.scope, scope_id: 'other' } });
    assert.equal(isolated.records.length, 0); assert.ok(isolated.refusals.every(i => i.reason === 'MEMORY_SCOPE_MISMATCH'));
    await writeFile(path.join(f.options.sourceRoot, 'old.txt'), 'changed');
    let result = await f.worker('recall'); assert.deepEqual(result.result.records.map(i => i.record.id), ['new']);
    assert.deepEqual(result.result.refusals, [{ id: 'old', reason: 'REFERENCE_STALE_OR_FORGED' }]);
    await unlink(path.join(f.options.sourceRoot, 'new.txt'));
    result = await f.worker('recall'); assert.deepEqual(result.result.records, []);
    await assert.rejects(captureMemory({ ...f.options, record: record('forged', [{ ...f.refs['model.txt'], sha256: '0'.repeat(64) }]) }), /REFERENCE_STALE_OR_FORGED/);
    await assert.rejects(captureMemory({ ...f.options, record: record('outside', [{ ...f.refs['model.txt'], path: 'outside.txt' }]) }), /REFERENCE_OUT_OF_SCOPE/);
    await assert.rejects(recallMemory({ ...await f.trusted(), currentTruthRefs: [f.refs['old.txt']] }), /REFERENCE_STALE_OR_FORGED/);
    await writeFile(path.join(f.options.memoryRoot, 'records', 'old.json'), '{}');
    await assert.rejects(readMemoryRecord({ ...await f.trusted(), id: 'old' }), /MEMORY_CORRUPT/);
  });
}

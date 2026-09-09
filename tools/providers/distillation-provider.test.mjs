import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { KURA_READONLY_STORE_SCHEMA, KURA_UPSTREAM, createKuraReadOnlyProvider } from './kura-readonly-provider.mjs';
import { ProviderRegistry } from './provider-boundary.mjs';
import {
  DISTILLATION_SCHEMA,
  acceptDistilledCandidate,
  createDistillationProvider,
  distillationDigest,
  runBoundedDistillation,
} from './distillation-provider.mjs';

const DIGEST = 'a'.repeat(64);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function providerScope() {
  return { scope_id: 'project-alpha', snapshot_digest: DIGEST, paths: ['notes.md', 'test.txt'] };
}

function rawKuraStore() {
  return {
    schema: KURA_READONLY_STORE_SCHEMA,
    store_id: 'alpha',
    scope: providerScope(),
    snapshot_digest: DIGEST,
    revision: 'fixture-r1',
    memories: [{
      slug: 'seed',
      title: 'Restart seed',
      body: 'The local profile resumes committed state after restart.',
      tags: ['restart'],
      evidence: [{ kind: 'source', path: 'notes.md', quote: 'local profile resumes committed state', snapshot_digest: DIGEST }],
    }],
  };
}

function candidate(overrides = {}) {
  return {
    candidate_id: 'distilled-restart',
    scope: providerScope(),
    kind: 'semantic',
    title: 'Restart continuity',
    summary: 'The local profile resumes committed state after restart in this reviewed scope.',
    details: 'Reviewed evidence says profile resumes committed state after restart.',
    confidence: 0.99,
    references: [{ kind: 'source', path: 'notes.md', sha256: DIGEST, bytes: 1, lineage_id: 'source-lineage', provenance_kind: 'source' }, { kind: 'evidence', path: 'test.txt', sha256: DIGEST, bytes: 1, lineage_id: 'test-lineage', provenance_kind: 'independent_test' }],
    lineage: ['source-lineage', 'test-lineage'],
    grounding_receipts: [{ kind: 'fixture-grounding', provider_id: 'fixture', provider_version: 'v1', surviving_quotes: ['profile resumes committed state'], evidence_refs: [{ path: 'notes.md' }] }],
    ...overrides,
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-distillation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const evidenceRoot = path.join(root, 'evidence');
  const memoryRoot = path.join(root, 'memory');
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(memoryRoot, { recursive: true });
  const sourceBytes = Buffer.from('The local profile resumes committed state after restart.\n');
  const evidenceBytes = Buffer.from('Independent test observed restart persistence.\n');
  await writeFile(path.join(sourceRoot, 'notes.md'), sourceBytes);
  await writeFile(path.join(evidenceRoot, 'test.txt'), evidenceBytes);
  const sourceRef = { kind: 'source', path: 'notes.md', sha256: sha256(sourceBytes), bytes: sourceBytes.length, lineage_id: 'source-lineage', provenance_kind: 'source' };
  const evidenceRef = { kind: 'evidence', path: 'test.txt', sha256: sha256(evidenceBytes), bytes: evidenceBytes.length, lineage_id: 'test-lineage', provenance_kind: 'independent_test' };
  const storePath = path.join(root, 'kura.json');
  await writeFile(storePath, JSON.stringify(rawKuraStore(), null, 2));
  return { root, sourceRoot, evidenceRoot, memoryRoot, storePath, sourceRef, evidenceRef };
}

function hostCandidate(f, extra = {}) {
  return candidate({ references: [f.sourceRef, f.evidenceRef], ...extra });
}

test('Kura-grounded candidate remains untrusted until native H03 accepts it', async t => {
  const f = await fixture(t);
  const kura = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: providerScope(), upstream: KURA_UPSTREAM });
  const provider = createDistillationProvider({
    scope: providerScope(), kuraProvider: kura,
    generate: async () => ({ candidates: [hostCandidate(f)], cost_units: 0 }),
  });
  const report = await provider.distill({ scope: providerScope(), inputs: [{ event_id: 'evt-restart' }] });
  assert.equal(report.schema, DISTILLATION_SCHEMA);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].authority, 'none');
  assert.equal(report.candidates[0].current_truth, false);
  assert.equal(report.candidates[0].grounding_receipts.length, 2);
  assert.equal(report.candidates[0].grounding_receipts.at(-1).provider_id, 'kura-readonly-alpha');

  const verifyProvenance = async request => ({ ...request, provenance_kind: request.reference.kind === 'source' ? 'source' : 'independent_test', origin_sha256: request.reference.sha256, lineage_id: request.reference.kind === 'source' ? 'source-lineage' : 'test-lineage', supports_claim: true });
  const accepted = await acceptDistilledCandidate({
    candidate: report.candidates[0], decision: 'verified', memoryRoot: f.memoryRoot,
    scope: { scope_id: 'project-alpha', source_paths: ['notes.md'], evidence_paths: ['test.txt'] },
    sourceRoot: f.sourceRoot, evidenceRoot: f.evidenceRoot, verifyProvenance,
  });
  assert.equal(accepted.decision, 'verified');
  assert.equal(accepted.record.status, 'verified');
  assert.equal(accepted.record.authority, 'none');
  assert.equal(accepted.record.current_truth, false);
  assert.equal(accepted.record.verification.independent_support_count, 2);
  await assert.rejects(() => acceptDistilledCandidate({ candidate: report.candidates[0], decision: 'verified', memoryRoot: f.memoryRoot, scope: { scope_id: 'project-alpha', source_paths: ['notes.md'], evidence_paths: ['test.txt'] }, sourceRoot: f.sourceRoot, evidenceRoot: f.evidenceRoot }), /DISTILLATION_TRUST_VERIFIER_REQUIRED/u);
});

test('store echo, unsupported numeric claim, duplicate lineage and stale scope refuse without promotion', async t => {
  const f = await fixture(t);
  const kura = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: providerScope(), upstream: KURA_UPSTREAM });
  const run = async raw => createDistillationProvider({ scope: providerScope(), kuraProvider: kura, generate: async () => ({ candidates: raw }) }).distill({ scope: providerScope(), inputs: [{ event_id: 'evt' }] });
  const echo = await run([hostCandidate(f, { details: 'The local profile resumes committed state after restart.', grounding_receipts: [{ provider_id: 'fixture', provider_version: 'v1', surviving_quotes: ['local profile resumes committed state'], evidence_refs: [{ path: 'notes.md' }] }] })]);
  assert.equal(echo.candidates.length, 0);
  assert.match(echo.refusals[0].code, /DISTILLATION_STORE_ECHO/u);
  const numeric = await run([hostCandidate(f, { summary: 'This is release version 99.', details: 'A profile resumes committed state.', grounding_receipts: [{ provider_id: 'fixture', provider_version: 'v1', surviving_quotes: ['profile resumes committed state'], evidence_refs: [{ path: 'notes.md' }] }] })]);
  assert.equal(numeric.candidates.length, 0);
  assert.match(numeric.refusals[0].code, /UNSUPPORTED_NUMERIC_CLAIM/u);
  const first = hostCandidate(f);
  const second = hostCandidate(f, { candidate_id: 'distilled-restart-2' });
  const duplicate = await run([first, second]);
  assert.equal(duplicate.candidates.length, 1);
  assert.match(duplicate.refusals[0].code, /DUPLICATE_LINEAGE/u);
  const stale = await run([hostCandidate(f, { scope: { ...providerScope(), snapshot_digest: 'b'.repeat(64) } })]);
  assert.equal(stale.candidates.length, 0);
  assert.match(stale.refusals[0].code, /STALE_SNAPSHOT|SCOPE_MISMATCH/u);
});

test('provider failure, rate limit and cost exhaustion are explicit bounded refusals', async t => {
  const f = await fixture(t);
  const failing = createDistillationProvider({ scope: providerScope(), generate: async () => { throw new Error('LOCAL_PROVIDER_DOWN'); } });
  const failed = await failing.distill({ scope: providerScope(), inputs: [{ id: 'e' }] });
  assert.equal(failed.candidates.length, 0);
  assert.equal(failed.refusals[0].code, 'DISTILLATION_PROVIDER_FAILURE');
  const rate = createDistillationProvider({ scope: providerScope(), budget: { max_calls: 0 }, generate: async () => [hostCandidate(f)] });
  const limited = await rate.distill({ scope: providerScope(), inputs: [{ id: 'e' }] });
  assert.equal(limited.refusals[0].code, 'DISTILLATION_RATE_LIMIT');
  const costly = createDistillationProvider({ scope: providerScope(), budget: { max_cost_units: 1 }, generate: async () => ({ candidates: [hostCandidate(f)], cost_units: 2 }) });
  const exhausted = await costly.distill({ scope: providerScope(), inputs: [{ id: 'e' }] });
  assert.equal(exhausted.refusals[0].code, 'DISTILLATION_COST_EXHAUSTED');
});

test('nested and camelCase authority/currentTruth fields cannot cross the provider boundary', async t => {
  const f = await fixture(t);
  const run = async raw => createDistillationProvider({ scope: providerScope(), generate: async () => [raw] }).distill({ scope: providerScope(), inputs: [{ id: 'e' }] });
  const camelTruth = await run(hostCandidate(f, { currentTruth: true }));
  assert.equal(camelTruth.candidates.length, 0);
  assert.equal(camelTruth.refusals[0].code, 'DISTILLATION_TRUTH_MUTATION');
  const nestedAuthority = await run(hostCandidate(f, { grounding_receipts: [{ provider_id: 'fixture', provider_version: 'v1', surviving_quotes: ['profile resumes committed state'], evidence_refs: [{ path: 'notes.md' }], authority: 'system' }] }));
  assert.equal(nestedAuthority.candidates.length, 0);
  assert.equal(nestedAuthority.refusals[0].code, 'DISTILLATION_AUTHORITY_MUTATION');
  const nestedCurrentTruth = await run(hostCandidate(f, { grounding_receipts: [{ provider_id: 'fixture', provider_version: 'v1', surviving_quotes: ['profile resumes committed state'], evidence_refs: [{ path: 'notes.md' }], currentTruth: true }] }));
  assert.equal(nestedCurrentTruth.candidates.length, 0);
  assert.equal(nestedCurrentTruth.refusals[0].code, 'DISTILLATION_TRUTH_MUTATION');
});

test('provider registry invokes distillation only through the declared bounded capability', async t => {
  const f = await fixture(t);
  const provider = createDistillationProvider({ scope: providerScope(), generate: async () => [hostCandidate(f)] });
  const registry = new ProviderRegistry({ scope: providerScope(), policy: { allowed_egress: 'none' } });
  registry.register(provider);
  const wrapped = await registry.invoke(provider.descriptor.provider_id, 'distill', { inputs: [{ id: 'registry-event' }] });
  assert.equal(wrapped.authority, 'none');
  assert.equal(wrapped.current_truth, false);
  assert.equal(wrapped.result.candidates.length, 1);
  await assert.rejects(() => registry.invoke(provider.descriptor.provider_id, 'remember', {}), /PROVIDER_OPERATION_UNSUPPORTED/u);
});

test('H04 queue owns bounded retry, replay and restart while provider remains a stateless candidate source', async t => {
  const f = await fixture(t);
  const sleepRoot = path.join(f.root, 'sleep');
  const request = hostCandidate(f, { candidate_id: 'scheduled-restart' });
  const requests = new Map([['scheduled-restart', { inputs: [{ id: 'event-scheduled' }] }]]);
  const event = { id: 'event-scheduled', resource_id: 'scheduled-restart', fingerprint: distillationDigest({ request }), declared_bytes: 128 };
  let attempts = 0;
  const provider = createDistillationProvider({ scope: providerScope(), generate: async () => { attempts += 1; if (attempts === 1) throw new Error('TEMPORARY_PROVIDER_FAILURE'); return [request]; } });
  const first = await runBoundedDistillation({ root: sleepRoot, scopeId: 'project-alpha', scope: providerScope(), provider, events: [event], requests });
  assert.equal(first.receipt.failed, 1);
  assert.equal(first.receipt.pending, 1);
  const second = await runBoundedDistillation({ root: sleepRoot, scopeId: 'project-alpha', scope: providerScope(), provider, events: [event], requests });
  assert.equal(second.enqueued.duplicates, 1);
  assert.equal(second.receipt.processed, 1);
  assert.equal(second.state.usable_candidates.length, 1);
  const restarted = createDistillationProvider({ scope: providerScope(), generate: async () => [request] });
  const third = await runBoundedDistillation({ root: sleepRoot, scopeId: 'project-alpha', scope: providerScope(), provider: restarted, events: [event], requests });
  assert.equal(third.enqueued.duplicates, 1);
  assert.equal(third.state.usable_candidates.length, 1);
  const stored = await readFile(path.join(sleepRoot, 'state.json'), 'utf8');
  assert.match(stored, /scheduled-restart/u);
});

test('H03 acceptance rejects stale source bytes and scope escape', async t => {
  const f = await fixture(t);
  const source = hostCandidate(f);
  await writeFile(path.join(f.sourceRoot, 'notes.md'), 'changed bytes\n');
  await assert.rejects(() => acceptDistilledCandidate({ candidate: source, decision: 'candidate', memoryRoot: f.memoryRoot, scope: { scope_id: 'project-alpha', source_paths: ['notes.md'], evidence_paths: ['test.txt'] }, sourceRoot: f.sourceRoot, evidenceRoot: f.evidenceRoot }), /REFERENCE_STALE_OR_FORGED/u);
  await assert.rejects(() => acceptDistilledCandidate({ candidate: hostCandidate(f, { scope: { ...providerScope(), scope_id: 'other' } }), memoryRoot: f.memoryRoot, scope: { scope_id: 'project-alpha', source_paths: ['notes.md'], evidence_paths: ['test.txt'] }, sourceRoot: f.sourceRoot, evidenceRoot: f.evidenceRoot }), /DISTILLATION_SCOPE_MISMATCH/u);
});

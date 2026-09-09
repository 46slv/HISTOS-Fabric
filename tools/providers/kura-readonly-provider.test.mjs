import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ProviderRegistry } from './provider-boundary.mjs';
import {
  KURA_READONLY_REPORT_SCHEMA,
  KURA_READONLY_STORE_SCHEMA,
  KURA_UPSTREAM,
  createKuraReadOnlyProvider,
  evaluateKuraCandidate,
  runKuraReadOnlyComparison,
} from './kura-readonly-provider.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function scope(snapshot_digest = DIGEST_A) {
  return { scope_id: 'project-alpha', snapshot_digest, paths: ['notes.md', 'runbook.md'] };
}

function store(snapshot_digest = DIGEST_A) {
  return {
    schema: KURA_READONLY_STORE_SCHEMA,
    store_id: 'alpha',
    scope: scope(snapshot_digest),
    snapshot_digest,
    revision: snapshot_digest.slice(0, 12),
    memories: [
      {
        slug: 'restart-proof',
        title: 'Restart keeps committed state',
        body: 'The local service keeps the committed state after a controlled restart.',
        tags: ['restart', 'state'],
        evidence: [{ kind: 'source', path: 'runbook.md', line: 7, quote: 'committed state after a controlled restart', snapshot_digest }],
      },
      {
        slug: 'scope-proof',
        title: 'Scope is explicit',
        body: 'Every recall is bound to the project-alpha scope and its source snapshot.',
        tags: ['scope', 'snapshot'],
        evidence: [{ kind: 'source', path: 'notes.md', line: 3, quote: 'project-alpha scope and its source snapshot', snapshot_digest }],
      },
    ],
  };
}

async function fixture(t, snapshot_digest = DIGEST_A) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-kura-readonly-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'store.json');
  await writeFile(storePath, JSON.stringify(store(snapshot_digest), null, 2));
  return { root, storePath };
}

function lexicalBaseline(records) {
  return async ({ query, scope: requested }) => {
    assert.equal(requested.scope_id, 'project-alpha');
    const lower = query.toLocaleLowerCase();
    const selected = records.filter(record => `${record.title} ${record.body} ${record.tags.join(' ')}`.toLocaleLowerCase().split(/\s+/u).some(term => term.length > 2 && lower.includes(term)));
    return {
      records: selected.slice(0, 5).map(record => ({
        slug: record.slug,
        title: record.title,
        body: record.body,
        evidence_refs: record.evidence,
        scope_id: requested.scope_id,
        snapshot_digest: requested.snapshot_digest,
        authority: 'none',
        current_truth: false,
      })),
      refusals: selected.length ? [] : [{ code: 'NATIVE_ABSTAIN_NO_MATCH' }],
    };
  };
}

test('Kura read-only provider recalls scoped memories with exact evidence descent', async t => {
  const f = await fixture(t);
  const provider = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: scope(), upstream: KURA_UPSTREAM });
  const record = await provider.read({ id: 'restart-proof', scope: scope() });
  assert.equal(record.slug, 'restart-proof');
  assert.equal(record.scope_id, 'project-alpha');
  assert.equal(record.snapshot_digest, DIGEST_A);
  assert.equal(record.authority, 'none');
  assert.equal(record.current_truth, false);
  assert.equal(record.evidence_refs[0].path, 'runbook.md');
  assert.match(record.evidence_refs[0].quote, /controlled restart/u);

  const recalled = await provider.recall({ query: 'what survives a restart?', scope: scope(), maxResults: 1, maxChars: 500 });
  assert.equal(recalled.records[0].slug, 'restart-proof');
  assert.equal(recalled.records[0].evidence_refs[0].snapshot_digest, DIGEST_A);
  assert.equal(recalled.abstained, false);
  assert.ok(recalled.context_bytes > 0);
  await assert.rejects(provider.recall({ query: 'restart', scope: { scope_id: 'other', snapshot_digest: DIGEST_A } }), /KURA_SCOPE_MISMATCH/u);
});

test('provider registry preserves Kura read-only and refuses write attempts at the call boundary', async t => {
  const f = await fixture(t);
  const bound = scope();
  const provider = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: bound });
  const registry = new ProviderRegistry({ scope: bound, policy: { allowed_egress: 'none' } });
  registry.register(provider);
  const wrapped = await registry.invoke(provider.descriptor.provider_id, 'recall', { query: 'explicit scope', maxResults: 1 });
  assert.equal(wrapped.authority, 'none');
  assert.equal(wrapped.current_truth, false);
  assert.equal(wrapped.result.records[0].slug, 'scope-proof');
  assert.throws(() => provider.invoke('remember', { scope: bound, slug: 'new', body: 'must not write' }), /KURA_READ_ONLY_WRITE_REJECTED/u);
  await assert.rejects(() => registry.invoke(provider.descriptor.provider_id, 'remember', { slug: 'new', body: 'must not write' }), /PROVIDER_OPERATION_UNSUPPORTED/u);
});

test('Kura quote floor rejects store echo and unsupported quotation without mutation', async t => {
  const f = await fixture(t);
  const provider = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: scope() });
  const before = await readFile(f.storePath, 'utf8');
  const echoed = await provider.evaluateCandidate({
    scope: scope(),
    candidate: { body: 'The local service keeps the committed state after a controlled restart.', quotes: ['committed state after a controlled restart'] },
  });
  assert.equal(echoed.accepted, false);
  assert.equal(echoed.reason, 'STORE_ECHO');
  const unsupported = await provider.evaluateCandidate({ scope: scope(), candidate: { body: 'new claim', quotes: ['a quote absent from the reviewed source'] } });
  assert.equal(unsupported.accepted, false);
  assert.equal(unsupported.reason, 'QUOTE_NOT_FOUND');
  const after = await readFile(f.storePath, 'utf8');
  assert.equal(after, before);

  const direct = evaluateKuraCandidate({ store: store(), scope: scope(), candidate: { body: 'A new grounded note', quotes: ['project-alpha scope and its source snapshot'] } });
  assert.equal(direct.accepted, true);
  assert.equal(direct.authority, 'none');
});

test('snapshot changes are refused until an explicit fresh provider is constructed', async t => {
  const f = await fixture(t);
  const provider = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: { scope_id: 'project-alpha' } });
  await provider.recall({ query: 'restart' });
  await writeFile(f.storePath, JSON.stringify(store(DIGEST_B), null, 2));
  await assert.rejects(provider.recall({ query: 'restart' }), /KURA_STALE_STORE_SNAPSHOT/u);
  const fresh = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: scope(DIGEST_B) });
  const recalled = await fresh.recall({ query: 'restart', scope: scope(DIGEST_B) });
  assert.equal(recalled.snapshot_digest, DIGEST_B);
});

test('comparison report uses equal scopes/budgets and records recall, abstention, descent, bytes, latency, restart, stale and read-only gates', async t => {
  const f = await fixture(t);
  const bound = scope();
  const provider = createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: bound });
  const records = store().memories;
  const cases = [
    { id: 'positive-restart', query: 'committed state restart', expected_slug: 'restart-proof' },
    { id: 'positive-scope', query: 'explicit project scope', expected_slug: 'scope-proof' },
    { id: 'negative-unknown', query: 'unrecorded database migration', expected_slug: null },
  ];
  const report = await runKuraReadOnlyComparison({
    scope: bound,
    cases,
    kuraProvider: provider,
    baselineRecall: lexicalBaseline(records),
    budget: { max_results: 2, max_chars: 800 },
    clock: () => 0,
    restartFactory: () => createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: bound }),
    staleProbe: async ({ provider: staleProvider }) => {
      const before = await readFile(f.storePath, 'utf8');
      await writeFile(f.storePath, JSON.stringify(store(DIGEST_B), null, 2));
      try {
        await assert.rejects(staleProvider.recall({ query: 'restart', scope: bound }), /KURA_SCOPE_SNAPSHOT_MISMATCH|KURA_STALE_STORE_SNAPSHOT/u);
        return { status: 'PASS', refusal: 'KURA_STALE_STORE_SNAPSHOT' };
      } finally {
        await writeFile(f.storePath, before);
      }
    },
  });
  assert.equal(report.schema, KURA_READONLY_REPORT_SCHEMA);
  assert.equal(report.upstream.commit, KURA_UPSTREAM.commit);
  assert.deepEqual(report.fixture.budget, { max_results: 2, max_chars: 800 });
  assert.equal(report.fixture.equal_task_and_scope, true);
  assert.equal(report.providers.kura.summary.recall_rate, 1);
  assert.equal(report.providers.kura.summary.false_recall, 0);
  assert.equal(report.providers.kura.summary.abstentions, 1);
  assert.equal(report.providers.kura.summary.evidence_descent_rate, 1);
  assert.equal(report.providers.kura.summary.latency_ms.p50, 0);
  assert.equal(report.providers.kura.summary.latency_ms.max, 0);
  assert.equal(report.providers.baseline.summary.recall_rate, 1);
  assert.equal(report.recovery.restart.status, 'PASS');
  assert.equal(report.recovery.stale_input.status, 'PASS');
  assert.equal(report.read_only_enforcement.status, 'PASS');

  const second = await runKuraReadOnlyComparison({
    scope: bound,
    cases,
    kuraProvider: createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: bound }),
    baselineRecall: lexicalBaseline(records),
    budget: { max_results: 2, max_chars: 800 },
    clock: () => 0,
    restartFactory: () => createKuraReadOnlyProvider({ storePath: f.storePath, storeId: 'alpha', scope: bound }),
    staleProbe: async () => ({ status: 'NOT_RUN', reason: 'determinism_second_pass' }),
  });
  // The deterministic fixture, fixed clock and equal budget make quality and
  // accounting comparable.  Recovery probes may be host-specific and are
  // intentionally not part of this equality check.
  assert.deepEqual(second.providers, report.providers);
});

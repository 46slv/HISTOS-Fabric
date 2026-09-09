import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSourceIndex, searchSourceIndex } from '../index/source-index.mjs';
import { compileContextCapsule } from '../context/context-compiler.mjs';
import {
  buildEphemeraObservationEvent,
  createEphemeraH05CompatibilityBridge,
  createEvidenceEventJournal,
  EPHEMERA_H05_COMPATIBILITY_SCHEMA,
  HISTOS_CONTEXT_CAPSULE_SCHEMA,
  HISTOS_MEMORY_RECALL_SCHEMA,
} from './ephemera-compatibility.mjs';

const AT = '2026-09-09T09:00:00.000Z';

async function fixture({ mutateMemory = null, mutateContext = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-ephemera-h05-'));
  const sourceRoot = path.join(root, 'source');
  const indexRoot = path.join(root, 'index');
  await writeFile(path.join(root, 'unused'), 'fixture');
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, 'a.mjs'), 'export function alpha(value) {\n  return value + 1;\n}\n');
  const evidenceBytes = Buffer.from('evidence\n');
  const evidenceSha = createHash('sha256').update(evidenceBytes).digest('hex');
  const { index } = await buildSourceIndex({ root: sourceRoot, indexRoot, scopeId: 'repo', paths: ['a.mjs'] });
  const source = index.sources[0];
  const scope = {
    scope_id: 'repo',
    snapshot_digest: index.scope.snapshot_digest,
    paths: ['a.mjs'],
    source_paths: ['a.mjs'],
    evidence_paths: ['evidence.json'],
  };
  const currentTruth = [{
    kind: 'fresh-source-bytes', path: 'a.mjs', sha256: source.sha256, bytes: source.bytes,
    scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest,
  }];
  const evidence = [{
    kind: 'evidence', path: 'evidence.json', sha256: evidenceSha, bytes: evidenceBytes.byteLength,
    scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest,
  }];
  const rolePolicy = {
    role: 'implementer', allowed_paths: ['a.mjs'], allowed_evidence_paths: ['evidence.json'],
    allowed_memory_kinds: ['procedure'], allowed_memory_ids: [], max_tokens: 2_000,
    max_memory_records: 4, allow_candidates: false, allow_current_truth: true,
  };
  const search = searchSourceIndex({ index, query: 'alpha', scope: { scope_id: scope.scope_id, snapshot_digest: scope.snapshot_digest, paths: ['a.mjs'] } });
  const candidate = search.candidates[0];
  const calls = { memory: [], context: [], transition: 0 };
  const memory = {
    schema: HISTOS_MEMORY_RECALL_SCHEMA,
    version: 0,
    scope: { scope_id: scope.scope_id, source_paths: ['a.mjs'], evidence_paths: ['evidence.json'] },
    query: 'alpha',
    current_truth_refs: [{ kind: 'source', path: 'a.mjs', sha256: source.sha256, bytes: source.bytes }],
    authority_boundary: 'Memory is historical scoped data. Current truth references remain separate.',
    records: [], refusals: [], supersessions: [],
  };
  const makeContext = (request) => compileContextCapsule({
    sourceRoot,
    index,
    goal: request.goal,
    scope: request.scope,
    sourceMap: [{ path: source.path, sha256: source.sha256, bytes: source.bytes }],
    candidates: [candidate],
    maxTokens: request.max_tokens,
    currentTruthRefs: request.current_truth_refs,
    evidenceRefs: evidence,
    memory: request.memory,
  });
  const bridge = createEphemeraH05CompatibilityBridge({
    read_memory: async (request) => {
      calls.memory.push(request);
      request.role = 'callback-mutated';
      return mutateMemory ? mutateMemory(structuredClone(memory), request) : structuredClone(memory);
    },
    compile_context: async (request) => {
      calls.context.push(request);
      request.role = 'callback-mutated';
      const result = await makeContext(request);
      return mutateContext ? mutateContext(result, request) : result;
    },
    mission_transition: async () => { calls.transition += 1; throw new Error('must not be called'); },
  });
  const input = { scope, current_truth_refs: currentTruth, role_policy: rolePolicy, goal: 'find alpha', query: 'alpha' };
  return { root, sourceRoot, index, source, scope, currentTruth, evidence, rolePolicy, input, bridge, calls, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('H05 bridge consumes real H01 compiler shape and faithful H03 recall shape', async () => {
  const f = await fixture();
  try {
    const result = await f.bridge.materialize(f.input, { event: { session_or_run_ref: 'run-h05', occurred_at: AT, observed_at: AT } });
    assert.equal(result.schema, EPHEMERA_H05_COMPATIBILITY_SCHEMA);
    assert.equal(result.context.schema, HISTOS_CONTEXT_CAPSULE_SCHEMA);
    assert.equal(result.memory.length, 0);
    assert.match(result.current_truth_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.authority, 'none');
    assert.equal(result.current_truth, false);
    assert.equal(result.mission_transition, 'NOT_REQUESTED');
    assert.equal(result.event.scope.scope_id, f.scope.scope_id);
    assert.equal(result.event.scope.source_snapshot_sha256, f.scope.snapshot_digest);
    assert.equal(result.event.output_artifact_refs.length, 1);
    assert.equal(result.event.output_artifact_refs[0].path, 'evidence.json');
    assert.equal(f.calls.memory.length, 1);
    assert.equal(f.calls.context.length, 1);
    assert.equal(f.calls.transition, 0);
    // Callback-side mutation was detached from the caller's request.
    assert.equal(f.input.scope.paths[0], 'a.mjs');
    assert.equal(f.input.current_truth_refs[0].path, 'a.mjs');
  } finally { await f.cleanup(); }
});

test('stale scope, out-of-scope evidence, authority and unknown fields fail closed', async (t) => {
  await t.test('stale context snapshot', async () => {
    const f = await fixture({ mutateContext: (context) => ({ ...context, scope: { ...context.scope, snapshot_digest: 'f'.repeat(64) } }) });
    try { await assert.rejects(() => f.bridge.materialize(f.input), /STALE_SCOPE|SCOPE_MISMATCH/); } finally { await f.cleanup(); }
  });
  await t.test('out-of-scope evidence path', async () => {
    const f = await fixture({ mutateContext: (context) => ({ ...context, evidence_refs: [{ ...context.evidence_refs[0], path: 'outside.json' }] }) });
    try { await assert.rejects(() => f.bridge.materialize(f.input), /REFERENCE_OUT_OF_SCOPE|ROLE_ALLOWLIST_REFUSED/); } finally { await f.cleanup(); }
  });
  await t.test('memory authority/current-truth mutation', async () => {
    const f = await fixture({ mutateMemory: (memory) => ({ ...memory, records: [{ record: { id: 'm1', kind: 'procedure', scope_id: 'repo', status: 'verified', authority: 'mission', current_truth: true, references: [] } }] }) });
    try { await assert.rejects(() => f.bridge.materialize(f.input), /CURRENT_TRUTH_SEPARATION_FAILED/); } finally { await f.cleanup(); }
  });
  await t.test('unknown memory field', async () => {
    const f = await fixture({ mutateMemory: (memory) => ({ ...memory, unknown: true }) });
    try { await assert.rejects(() => f.bridge.materialize(f.input), /UNKNOWN_FIELD/); } finally { await f.cleanup(); }
  });
});

test('missing evidence, secret/authority event fields and replay conflict are refused', async (t) => {
  await t.test('missing evidence blocks event return', async () => {
    const f = await fixture({ mutateContext: (context) => ({ ...context, evidence_refs: [] }) });
    try { await assert.rejects(() => f.bridge.materialize(f.input, { event: { session_or_run_ref: 'run-h05', occurred_at: AT, observed_at: AT } }), /MISSING_EVIDENCE/); } finally { await f.cleanup(); }
  });
  await t.test('secret and authority metadata are not event inputs', async () => {
    const f = await fixture();
    try {
      await assert.rejects(() => f.bridge.materialize(f.input, { event: { session_or_run_ref: 'run-h05', occurred_at: AT, observed_at: AT, password: 'secret' } }), /EVENT_SECRET_PAYLOAD/);
      await assert.rejects(() => f.bridge.materialize(f.input, { event: { session_or_run_ref: 'run-h05', occurred_at: AT, observed_at: AT, authority: 'mission' } }), /EVENT_AUTHORITY_MUTATION/);
    } finally { await f.cleanup(); }
  });
  await t.test('event journal is idempotent but rejects same-ID conflict', async () => {
    const f = await fixture();
    try {
      const result = await f.bridge.materialize(f.input, { event: { session_or_run_ref: 'run-h05', occurred_at: AT, observed_at: AT } });
      const journal = createEvidenceEventJournal({ scope: { scope_id: f.scope.scope_id, source_snapshot_sha256: f.scope.snapshot_digest } });
      const {
        schema: _schema, event_sha256: _hash, byte_size: _bytes, routing: _routing, independence: _independence,
        ...rawNormalized
      } = result.event;
      assert.equal(journal.ingest(rawNormalized).accepted, true);
      assert.equal(journal.ingest(rawNormalized).duplicate, true);
      assert.throws(() => journal.ingest({ ...rawNormalized, outcome: 'failure' }), /EVENT_ID_CONFLICT/);
    } finally { await f.cleanup(); }
  });
});

test('event builder rejects stale snapshot and missing evidence before normalization', async () => {
  const scope = { scope_id: 'repo', snapshot_digest: 'a'.repeat(64), paths: ['a.mjs'], source_paths: ['a.mjs'], evidence_paths: ['evidence.json'] };
  const truth = [{ kind: 'source', path: 'a.mjs', sha256: 'b'.repeat(64), bytes: 1, snapshot_digest: scope.snapshot_digest }];
  const evidence = [{ kind: 'evidence', path: 'evidence.json', sha256: 'c'.repeat(64), bytes: 1, snapshot_digest: scope.snapshot_digest }];
  assert.throws(() => buildEphemeraObservationEvent({ scope: { ...scope, snapshot_digest: 'd'.repeat(64) }, current_truth_refs: truth, evidence_refs: evidence }), /STALE_SCOPE/);
  assert.throws(() => buildEphemeraObservationEvent({ scope, current_truth_refs: truth, evidence_refs: [] }), /MISSING_EVIDENCE/);
});

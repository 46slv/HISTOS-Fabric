import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSourceIndex, searchSourceIndex } from '../index/source-index.mjs';
import { captureMemory } from '../memory/evidence-memory.mjs';
import {
  PROVIDER_RESULT_SCHEMA,
  ProviderRegistry,
  admitProvider,
  createProviderDescriptor,
} from './provider-boundary.mjs';
import { createNativeMemoryProvider, createNativeRetrievalProvider } from './native-providers.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

function metadata(overrides = {}) {
  return {
    provider_id: 'fixture-provider',
    provider_kind: 'RetrievalProvider',
    version: 'fixture-v1',
    capabilities: ['read', 'search'],
    privacy: { egress: 'none', classification: 'project' },
    grounding: { mode: 'deterministic', preserves_lineage: true, requires_evidence_refs: false, output_classes: ['retrieved_candidate'] },
    scope_requirements: { required_fields: ['scope_id'] },
    status: 'experimental',
    ...overrides,
  };
}

test('provider metadata is explicit and host admission is capability/privacy bounded', () => {
  const descriptor = createProviderDescriptor(metadata());
  assert.equal(descriptor.schema, 'histos.provider/v1');
  assert.deepEqual(descriptor.privacy, { egress: 'none', classification: 'project', secrets_allowed: false });
  assert.equal(descriptor.grounding.authority, 'none');
  assert.equal(descriptor.grounding.current_truth, false);
  assert.equal(admitProvider(descriptor, { scope: { scope_id: 'project-alpha' } }).admission.status, 'admitted');
  assert.throws(() => admitProvider(metadata({ privacy: { egress: 'external', classification: 'project' } })), /PROVIDER_EGRESS_NOT_ALLOWED/);
  assert.throws(() => admitProvider(metadata({ capabilities: ['admin'] })), /PROVIDER/);
  assert.throws(() => createProviderDescriptor(metadata({ grounding: { mode: 'provider', preserves_lineage: false } })), /PROVIDER_GROUNDING_LINEAGE_REQUIRED/);
});

test('registry fails closed for unsupported operations, scope escape and unsafe authority output', async () => {
  const registry = new ProviderRegistry({ scope: { scope_id: 'project-alpha', paths: ['src/a.md'] } });
  registry.register({
    descriptor: metadata(),
    search: async input => ({ schema: 'fixture/search/v1', scope_id: input.scope.scope_id, candidates: [{ path: 'src/a.md' }] }),
  });
  const result = await registry.invoke('fixture-provider', 'search', { query: 'alpha' });
  assert.equal(result.schema, PROVIDER_RESULT_SCHEMA);
  assert.equal(result.authority, 'none');
  assert.equal(result.current_truth, false);
  assert.equal(result.result.scope_id, 'project-alpha');
  await assert.rejects(() => registry.invoke('fixture-provider', 'distill', {}), /PROVIDER_OPERATION_UNSUPPORTED/);
  await assert.rejects(() => registry.invoke('fixture-provider', 'search', { scope: { scope_id: 'other' }, query: 'alpha' }), /PROVIDER_SCOPE_MISMATCH/);
  const unsafe = new ProviderRegistry({ scope: { scope_id: 'project-alpha' } });
  unsafe.register({ descriptor: metadata({ provider_id: 'unsafe-provider' }), search: () => ({ verified: true }) });
  await assert.rejects(() => unsafe.invoke('unsafe-provider', 'search', {}), /PROVIDER_AUTHORITY_MUTATION/);
  const escaped = new ProviderRegistry({ scope: { scope_id: 'project-alpha', paths: ['src/a.md'] } });
  escaped.register({ descriptor: metadata({ provider_id: 'escaped-provider' }), search: () => ({ paths: ['outside.md'] }) });
  await assert.rejects(() => escaped.invoke('escaped-provider', 'search', {}), /PROVIDER_SCOPE_OUT_OF_BOUNDS/);
});

test('native H01 retrieval candidate passes through boundary without changing payload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-provider-h01-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.md'), '# Alpha\nProvider boundary test.\n');
    const indexRoot = path.join(root, 'index');
    const built = await buildSourceIndex({ root, indexRoot, scopeId: 'project-alpha', paths: ['src/a.md'] });
    const scope = built.index.scope;
    const provider = createNativeRetrievalProvider({ index: built.index, sourceRoot: root });
    const expected = searchSourceIndex({ index: built.index, query: 'boundary', scope, maxCandidates: 5 });
    assert.deepEqual(provider.search({ query: 'boundary', scope, maxCandidates: 5 }), expected);
    const registry = new ProviderRegistry({ scope });
    registry.register(provider);
    const wrapped = await registry.invoke(provider.descriptor.provider_id, 'search', { query: 'boundary', maxCandidates: 5 });
    assert.deepEqual(wrapped.result, expected);
    assert.equal(wrapped.provenance.provider_id, 'native-h01');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native H03 memory read remains host-verified and is not promoted by provider wrapper', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-provider-h03-'));
  try {
    const sourceRoot = path.join(root, 'source');
    const evidenceRoot = path.join(root, 'evidence');
    const memoryRoot = path.join(root, 'memory');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(evidenceRoot, { recursive: true });
    await mkdir(memoryRoot, { recursive: true });
    const sourceBytes = Buffer.from('durable provider memory\n');
    const evidenceBytes = Buffer.from('independent test receipt\n');
    await writeFile(path.join(sourceRoot, 'source.md'), sourceBytes);
    await writeFile(path.join(evidenceRoot, 'test.txt'), evidenceBytes);
    const sourceSha = await digest(sourceBytes);
    const evidenceSha = await digest(evidenceBytes);
    const scope = { scope_id: 'project-memory', source_paths: ['source.md'], evidence_paths: ['test.txt'] };
    const record = {
      id: 'memory-1', kind: 'semantic', status: 'verified', title: 'Provider memory', summary: 'A host verified memory', details: 'Details', confidence: 1,
      created_at: '2026-09-09T00:00:00.000Z', last_verified_at: '2026-09-09T00:00:00.000Z',
      references: [
        { kind: 'source', path: 'source.md', sha256: sourceSha, bytes: sourceBytes.length, lineage_id: 'source-lineage', provenance_kind: 'source', supports_claim: true },
        { kind: 'evidence', path: 'test.txt', sha256: evidenceSha, bytes: evidenceBytes.length, lineage_id: 'test-lineage', provenance_kind: 'independent_test', supports_claim: true },
      ],
      relations: { contradicts: [], supersedes: [] },
    };
    const verifyProvenance = async request => ({ ...request, provenance_kind: request.reference.kind === 'source' ? 'source' : 'independent_test', origin_sha256: request.reference.sha256, lineage_id: request.reference.kind === 'source' ? 'source-lineage' : 'test-lineage', supports_claim: true });
    await captureMemory({ memoryRoot, scope, sourceRoot, evidenceRoot, verifyProvenance, record });
    const provider = createNativeMemoryProvider({ memoryRoot, sourceRoot, evidenceRoot, verifyProvenance, scope });
    const direct = await provider.read({ scope, id: 'memory-1' });
    assert.equal(direct.authority, 'none');
    assert.equal(direct.current_truth, false);
    const registry = new ProviderRegistry({ scope: { scope_id: scope.scope_id } });
    registry.register(provider);
    const wrapped = await registry.invoke(provider.descriptor.provider_id, 'read', { id: 'memory-1' });
    assert.deepEqual(wrapped.result, direct);
    assert.equal(wrapped.current_truth, false);
    assert.equal(wrapped.authority, 'none');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provider metadata rejects attempts to claim Mission or verification authority', () => {
  assert.throws(() => createProviderDescriptor(metadata({ authority: 'system' })), /PROVIDER_AUTHORITY_MUTATION/);
  assert.throws(() => createProviderDescriptor(metadata({ current_truth: true })), /PROVIDER_TRUTH_MUTATION/);
  assert.throws(() => createProviderDescriptor(metadata({ verified: true })), /PROVIDER_AUTHORITY_MUTATION/);
  assert.throws(() => createProviderDescriptor(metadata({ grounding: { mode: 'native', preserves_lineage: true, authority: 'system' } })), /PROVIDER_GROUNDING_AUTHORITY_INVALID/);
});

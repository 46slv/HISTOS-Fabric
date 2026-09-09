import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTypedRelationshipIndex,
  evaluateHeldOut,
  lexicalBaseline,
  queryTypedRelationships,
  sealRecord,
  sha256,
  validateTypedRelationshipIndex,
} from './typed-retrieval.mjs';

const scope = { scope_id: 'project-h06', source_paths: ['alpha.md', 'beta.md', 'gamma.md'] };
const sources = [
  { kind: 'source', path: 'alpha.md', sha256: sha256('alpha source'), bytes: Buffer.byteLength('alpha source') },
  { kind: 'source', path: 'beta.md', sha256: sha256('beta source'), bytes: Buffer.byteLength('beta source') },
  { kind: 'source', path: 'gamma.md', sha256: sha256('gamma source'), bytes: Buffer.byteLength('gamma source') },
];

function record(id, title, ref, relations = {}, status = 'verified') {
  return {
    id,
    kind: 'semantic',
    scope_id: scope.scope_id,
    title,
    summary: `${title} summary`,
    details: `${title} details`,
    status,
    confidence: 1,
    references: [ref],
    relations,
    created_at: '2026-09-08T01:00:00.000Z',
    last_verified_at: '2026-09-08T01:01:00.000Z',
    verification: { claim_sha256: sha256(`claim:${id}`) },
    authority: 'none',
    current_truth: false,
  };
}

const refs = Object.fromEntries(sources.map((source) => [source.path, source]));

test('H06 builds a deterministic scoped typed index and explains relationship inclusion', () => {
  const records = [
    sealRecord(record('alpha', 'Alpha procedure', refs['alpha.md'], { contradicts: ['beta'] })),
    sealRecord(record('beta', 'Beta correction', refs['beta.md'])),
    sealRecord(record('gamma', 'Gamma unrelated', refs['gamma.md'])),
  ];
  const first = buildTypedRelationshipIndex({ scope, records, sources });
  const second = buildTypedRelationshipIndex({ scope, records: structuredClone(records), sources: structuredClone(sources) });
  assert.deepEqual(first.index, second.index);
  const result = queryTypedRelationships({ index: first.index, query: 'Alpha' });
  assert.deepEqual(result.results.map((item) => item.record_id), ['alpha', 'beta']);
  assert.equal(result.results[1].why_included[0].kind, 'relationship');
  assert.equal(result.results[1].provenance.scope_id, scope.scope_id);
  assert.equal(result.results[1].record.current_truth, false);
  assert.equal(result.results[1].record.authority, 'none');
  assert.equal(validateTypedRelationshipIndex(first.index).index.derived_digest, first.index.derived_digest);
});

test('H06 refuses forged, stale, cross-scope, unknown and unsupported relations', () => {
  const base = sealRecord(record('alpha', 'Alpha', refs['alpha.md']));
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [{ ...base, record_sha256: sha256('forged') }], sources }), /RECORD_CHECKSUM_MISMATCH/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(record('alpha', 'Alpha', { ...refs['alpha.md'], bytes: 999 }))], sources }), /RELATION_REFERENCE_STALE_OR_FORGED/);
  assert.throws(() => buildTypedRelationshipIndex({ scope: { ...scope, scope_id: 'other' }, records: [base], sources }), /INVALID_RELATION_RECORD/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(record('alpha', 'Alpha', refs['alpha.md'], { contradicts: ['missing'] }))], sources }), /UNKNOWN_RELATION_TARGET/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(record('alpha', 'Alpha', refs['alpha.md'], { contradicts: ['alpha'] }))], sources }), /SELF_RELATION/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(record('alpha', 'Alpha', refs['alpha.md'], { references: ['beta'] }))], sources }), /UNSUPPORTED_RELATION/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(record('alpha', 'Alpha', refs['alpha.md']))], sources: [{ ...sources[0], sha256: sha256('changed') }, sources[1], sources[2]] }), /SOURCE_SNAPSHOT_MISMATCH|RELATION_REFERENCE_STALE_OR_FORGED/);
});

test('H06 bounds cycles, depth, fanout and query visits without hanging', () => {
  const cycleRecords = [
    sealRecord(record('a', 'A topic', refs['alpha.md'], { contradicts: ['b'] })),
    sealRecord(record('b', 'B topic', refs['beta.md'], { contradicts: ['c'] })),
    sealRecord(record('c', 'C topic', refs['gamma.md'], { contradicts: ['a'] })),
  ];
  const index = buildTypedRelationshipIndex({ scope, records: cycleRecords, sources, limits: { max_depth: 1, max_fanout: 4 } }).index;
  const result = queryTypedRelationships({ index, query: 'A', maxDepth: 99, maxVisited: 2 });
  assert.ok(result.results.length <= 2);
  assert.ok(result.receipt.truncated || result.receipt.max_depth === 1);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: cycleRecords, sources, limits: { max_fanout: 1 } }), /RELATION_FANOUT_BUDGET/);
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: cycleRecords, sources, limits: { max_edges: 1 } }), /RELATION_EDGE_BUDGET/);
});

test('H06 treats excluded candidate and deprecated records as traversal barriers', () => {
  const records = [
    sealRecord(record('seed', 'Seed topic', refs['alpha.md'], { contradicts: ['bridge'] })),
    sealRecord(record('bridge', 'Bridge topic', refs['beta.md'], { contradicts: ['target'] }, 'candidate')),
    sealRecord(record('target', 'Target topic', refs['gamma.md'])),
  ];
  const index = buildTypedRelationshipIndex({ scope, records, sources }).index;
  const excluded = queryTypedRelationships({ index, query: 'Seed' });
  assert.deepEqual(excluded.results.map((item) => item.record_id), ['seed']);
  assert.equal(excluded.receipt.visited_nodes, 1);
  const optedIn = queryTypedRelationships({ index, query: 'Seed', includeCandidates: true });
  assert.deepEqual(optedIn.results.map((item) => item.record_id), ['seed', 'bridge', 'target']);
});

test('H06 requires an exact canonical expected scope and rejects unsafe query limits', () => {
  const index = buildTypedRelationshipIndex({
    scope,
    records: [sealRecord(record('alpha', 'Alpha', refs['alpha.md']))],
    sources,
  }).index;
  assert.doesNotThrow(() => validateTypedRelationshipIndex(index, { scope: index.scope }));
  assert.throws(() => validateTypedRelationshipIndex(index, { scope: { ...index.scope, source_paths: [] } }), /SCOPE_MISMATCH/);
  assert.throws(() => validateTypedRelationshipIndex(index, { scope: { ...index.scope, evidence_paths: ['evidence.md'] } }), /SCOPE_MISMATCH/);
  assert.throws(() => validateTypedRelationshipIndex(index, { scope: { ...index.scope, source_snapshot_digest: '0'.repeat(64) } }), /SCOPE_MISMATCH/);
  assert.throws(() => validateTypedRelationshipIndex(index, { scope: { scope_id: index.scope.scope_id, source_paths: index.scope.source_paths, evidence_paths: index.scope.evidence_paths } }), /SCOPE_MISMATCH/);
  for (const [field, value] of [['maxDepth', Number.NaN], ['maxDepth', -1], ['maxDepth', 1.5], ['maxDepth', Number.POSITIVE_INFINITY], ['maxResults', -1], ['maxVisited', Number.NaN]]) {
    assert.throws(() => queryTypedRelationships({ index, query: 'Alpha', [field]: value }), /INVALID_RELATION_QUERY_LIMIT/);
  }
  const bounded = queryTypedRelationships({ index, query: 'Alpha', maxVisited: 0 });
  assert.deepEqual(bounded.results, []);
  assert.equal(bounded.receipt.visited_nodes, 0);
  assert.equal(bounded.receipt.truncated, true);
});

test('H06 keeps candidate and current-truth authority separate', () => {
  const candidate = sealRecord(record('candidate', 'Candidate alpha', refs['alpha.md'], {}, 'candidate'));
  const verified = sealRecord(record('verified', 'Verified alpha', refs['beta.md']));
  const index = buildTypedRelationshipIndex({ scope, records: [candidate, verified], sources }).index;
  assert.deepEqual(queryTypedRelationships({ index, query: 'alpha' }).results.map((item) => item.record_id), ['verified']);
  assert.deepEqual(queryTypedRelationships({ index, query: 'alpha', includeCandidates: true }).results.map((item) => item.record_id), ['candidate', 'verified']);
  const currentTruth = { ...record('truth', 'Current alpha', refs['gamma.md']), current_truth: true };
  assert.throws(() => buildTypedRelationshipIndex({ scope, records: [sealRecord(currentTruth)], sources }), /AUTHORITY_BOUNDARY_VIOLATION/);
});

test('H06 held-out report compares fixed lexical baseline honestly', () => {
  const records = [
    sealRecord(record('alpha', 'Alpha incident', refs['alpha.md'], { contradicts: ['beta'] })),
    sealRecord(record('beta', 'Beta correction', refs['beta.md'])),
    sealRecord(record('gamma', 'Gamma independent', refs['gamma.md'])),
  ];
  const report = evaluateHeldOut({
    scope,
    records,
    sources,
    cases: [
      { id: 'relation-case', kind: 'relation', query: 'Alpha', expected_ids: ['alpha', 'beta'] },
      { id: 'lexical-case', kind: 'control', query: 'Gamma', expected_ids: ['gamma'] },
      { id: 'no-answer', kind: 'control', query: 'not-present', expected_ids: [] },
    ],
  });
  assert.equal(report.schema, 'histos.relationship-evaluation/v0');
  assert.equal(report.aggregate.relation_cases, 1);
  assert.equal(report.aggregate.non_relation_cases, 2);
  assert.equal(report.aggregate.expected_hits_lexical, 2);
  assert.equal(report.aggregate.expected_hits_relationship, 3);
  assert.equal(report.aggregate.relationship_gain_on_relation_cases, 1);
  assert.equal(report.aggregate.relationship_gain_on_non_relation_cases, 0);
  assert.ok(report.maintenance.records_scanned === 3);
  assert.ok(report.maintenance.rebuild_elapsed_ms >= 0);
  assert.ok(report.index.bytes > 0 && report.index.edges === 1);
  assert.ok(report.cases.every((item) => item.lexical_latency_ms >= 0 && item.relationship_latency_ms >= 0));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POLICY_SCHEMA,
  REPORT_SCHEMA,
  canonical,
  evaluatePolicyExperiment,
  rollbackToBaseline,
  sealPolicy,
  selectPolicy,
  sha256,
  validateCandidate,
  validatePolicy,
} from './retrieval-policy-experiment.mjs';

const scope = {
  scope_id: 'a01-fixture',
  source_snapshot_digest: 'a'.repeat(64),
  source_paths: ['alpha.md', 'beta.md', 'gamma.md', 'delta.md'],
  evidence_paths: ['evidence/alpha.json', 'evidence/beta.json', 'evidence/gamma.json', 'evidence/delta.json'],
};

const source = (path, content) => ({ kind: 'source', path, sha256: sha256(content), bytes: Buffer.byteLength(content) });
const evidence = (path, content) => ({ kind: 'evidence', path, sha256: sha256(content), bytes: Buffer.byteLength(content) });
const refs = {
  alpha: source('alpha.md', 'alpha source'),
  beta: source('beta.md', 'beta source'),
  gamma: source('gamma.md', 'gamma source'),
  delta: source('delta.md', 'delta source'),
  alphaEvidence: evidence('evidence/alpha.json', 'alpha evidence'),
  betaEvidence: evidence('evidence/beta.json', 'beta evidence'),
  gammaEvidence: evidence('evidence/gamma.json', 'gamma evidence'),
  deltaEvidence: evidence('evidence/delta.json', 'delta evidence'),
};
const evidenceCatalog = Object.values(refs);

const document = (id, text, sourceRef, related_ids = []) => ({ id, text, related_ids, source_ref: sourceRef });
const binding = (document_id, ref) => ({ document_id, ref });

const cases = [
  {
    id: 'dev-alpha-lexical', split: 'development', query: 'alpha', expected_ids: ['alpha'],
    documents: [document('alpha', 'Alpha implementation procedure', refs.alpha), document('beta', 'Beta correction', refs.beta)],
    evidence_refs: [binding('alpha', refs.alphaEvidence)],
  },
  {
    id: 'held-relation-recovery', split: 'held_out', query: 'alpha', expected_ids: ['alpha', 'beta'],
    documents: [document('alpha', 'Alpha incident', refs.alpha, ['beta']), document('beta', 'Beta correction', refs.beta)],
    evidence_refs: [binding('alpha', refs.alphaEvidence), binding('beta', refs.betaEvidence)],
  },
  {
    id: 'held-control-pair', split: 'held_out', query: 'pair', expected_ids: ['gamma', 'delta'],
    documents: [document('gamma', 'Gamma pair control', refs.gamma), document('delta', 'Delta pair control', refs.delta)],
    evidence_refs: [binding('gamma', refs.gammaEvidence), binding('delta', refs.deltaEvidence)],
  },
  {
    id: 'held-no-answer', split: 'held_out', query: 'unseen-token', expected_ids: [],
    documents: [document('gamma', 'Gamma pair control', refs.gamma)], evidence_refs: [],
  },
];

const baseline = sealPolicy({
  schema: POLICY_SCHEMA,
  policy_id: 'baseline-lexical-v1', version: 1, kind: 'baseline', label: 'Fixed lexical baseline',
  scope,
  provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true },
  authority: 'none', current_truth: false,
  safety: { authority: 'none', current_truth: false, max_results: 3, max_tokens: 512, max_depth: 2, max_cache_age_ms: 60_000, budget_unit: 'result-count-and-rendered-tokens' },
  parameters: {
    retrieval: { lexical_weight: 1, relationship_weight: 0, expansion_depth: 0 },
    budget: { result_limit: 3, token_share: 1 },
    cache: { enabled: false, max_age_ms: 0 },
  },
});

const candidate = (policy_id, parameters) => sealPolicy({
  schema: POLICY_SCHEMA, policy_id, version: 1, kind: 'candidate', label: policy_id,
  parent_policy_sha256: baseline.policy_sha256,
  scope: structuredClone(scope), provenance: { mode: 'evidence-linked', source_identity_required: true, evidence_identity_required: true },
  authority: 'none', current_truth: false,
  safety: { authority: 'none', current_truth: false, max_results: 3, max_tokens: 512, max_depth: 2, max_cache_age_ms: 60_000, budget_unit: 'result-count-and-rendered-tokens' },
  parameters,
});

const gain = candidate('candidate-relation-v1', {
  retrieval: { lexical_weight: 1, relationship_weight: 1, expansion_depth: 1 },
  budget: { result_limit: 3, token_share: 1 },
  cache: { enabled: false, max_age_ms: 0 },
});
const noGain = candidate('candidate-cache-no-gain-v1', {
  retrieval: { lexical_weight: 1, relationship_weight: 0, expansion_depth: 0 },
  budget: { result_limit: 3, token_share: 1 },
  cache: { enabled: true, max_age_ms: 60_000 },
});
const regression = candidate('candidate-regression-v1', {
  retrieval: { lexical_weight: 1, relationship_weight: 0, expansion_depth: 0 },
  budget: { result_limit: 1, token_share: 1 },
  cache: { enabled: false, max_age_ms: 0 },
});

test('A01 validates a versioned policy and seals deterministic identity', () => {
  const checked = validatePolicy(baseline.policy);
  assert.equal(checked.schema, POLICY_SCHEMA);
  assert.equal(baseline.policy_sha256, sha256(canonical(checked)));
  assert.equal(validateCandidate({ baseline, candidate: gain }).candidate.policy.parent_policy_sha256, baseline.policy_sha256);
});

test('A01 compares a fixed baseline with held-out evidence and deterministically selects a gain', () => {
  const first = evaluatePolicyExperiment({ baseline, candidates: [gain, noGain, regression], cases, evidence: evidenceCatalog });
  const second = evaluatePolicyExperiment({ baseline: structuredClone(baseline), candidates: structuredClone([gain, noGain, regression]), cases: structuredClone(cases), evidence: structuredClone(evidenceCatalog) });
  assert.deepEqual(first, second);
  assert.equal(first.schema, REPORT_SCHEMA);
  assert.equal(first.baseline.splits.held_out.hits, 3);
  const selected = first.candidates.find((item) => item.policy.policy_id === 'candidate-relation-v1');
  assert.equal(selected.decision.eligible, true);
  assert.equal(selected.decision.held_out_delta.hits, 1);
  assert.equal(first.selection.decision, 'CANDIDATE_SELECTED');
  assert.equal(first.selection.policy_id, 'candidate-relation-v1');
  assert.equal(selectPolicy(first).active, false);
});

test('A01 reports an intentionally regressing candidate and never selects it', () => {
  const report = evaluatePolicyExperiment({ baseline, candidates: [regression], cases, evidence: evidenceCatalog });
  const item = report.candidates[0];
  assert.equal(item.decision.eligible, false);
  assert.ok(item.decision.regressions.includes('HELD_OUT_RECALL_REGRESSION'));
  assert.equal(report.selection.decision, 'BASELINE_ROLLBACK');
  assert.equal(report.selection.policy_sha256, baseline.policy_sha256);
  const restored = rollbackToBaseline(report, baseline);
  assert.equal(restored.policy_sha256, baseline.policy_sha256);
  assert.equal(restored.rollback.disposition, 'BASELINE_RESTORED');
});

test('A01 records a no-gain cache candidate without treating cache as quality evidence', () => {
  const report = evaluatePolicyExperiment({ baseline, candidates: [noGain], cases, evidence: evidenceCatalog });
  const item = report.candidates[0];
  assert.equal(item.decision.eligible, true);
  assert.equal(item.decision.held_out_delta.hits, 0);
  assert.equal(item.policy.parameters.cache.enabled, true);
  assert.equal(item.rows.every((row) => row.receipt.cache.hit === false), true);
});

test('A01 rejects forged, stale, malformed, out-of-scope and authority-changing policies', () => {
  assert.throws(() => validatePolicy({ ...baseline.policy, authority: 'system' }), /POLICY_AUTHORITY_BOUNDARY_VIOLATION/);
  assert.throws(() => validatePolicy({ ...baseline.policy, parameters: { ...baseline.policy.parameters, cache: { enabled: false, max_age_ms: 1 } } }), /INVALID_CACHE_PARAMETER/);
  assert.throws(() => validateCandidate({ baseline, candidate: { ...gain, policy_sha256: '0'.repeat(64) } }), /POLICY_CHECKSUM_MISMATCH/);
  const changedScope = structuredClone(gain);
  changedScope.policy.scope.source_paths.push('forged.md');
  changedScope.policy = validatePolicy(changedScope.policy);
  changedScope.policy_sha256 = sha256(canonical(changedScope.policy));
  assert.throws(() => validateCandidate({ baseline, candidate: changedScope }), /IMMUTABLE_POLICY_FIELD_CHANGED:scope/);
  const staleCases = structuredClone(cases);
  staleCases[1].evidence_refs[0].ref.sha256 = '0'.repeat(64);
  assert.throws(() => evaluatePolicyExperiment({ baseline, candidates: [gain], cases: staleCases, evidence: evidenceCatalog }), /POLICY_EVIDENCE_STALE_OR_FORGED/);
  const outsideEvidence = structuredClone(evidenceCatalog);
  outsideEvidence.push({ kind: 'evidence', path: 'other-project.json', sha256: 'b'.repeat(64), bytes: 1 });
  assert.throws(() => evaluatePolicyExperiment({ baseline, candidates: [gain], cases, evidence: outsideEvidence }), /POLICY_EVIDENCE_OUT_OF_SCOPE/);
});

test('A01 does not mutate candidate, baseline, cases, or evidence inputs', () => {
  const input = { baseline: structuredClone(baseline), candidates: structuredClone([gain]), cases: structuredClone(cases), evidence: structuredClone(evidenceCatalog) };
  const before = structuredClone(input);
  evaluatePolicyExperiment(input);
  assert.deepEqual(input, before);
});

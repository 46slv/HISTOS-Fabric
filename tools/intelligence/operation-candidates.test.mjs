import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateCandidate,
  advanceCandidate,
  buildAutomationCandidate,
  createOperationSignature,
  digest,
  executeQualifiedCandidate,
  rollbackCandidate,
  runShadowEvaluation,
  selectQualifiedCandidate,
  validateAutomationCandidate,
  verifyAutomationCandidate,
} from './operation-candidates.mjs';

const scope = { scope_id: 'fixture-project', source_snapshot_sha256: 'a'.repeat(64) };
const sourceEvidence = (id = 'evidence-a') => ({
  evidence_id: id,
  scope_id: scope.scope_id,
  source_snapshot_sha256: scope.source_snapshot_sha256,
  state: 'fresh',
  kind: 'independent_test',
  references: [{ kind: 'source', path: 'fixtures/operation.json', sha256: 'b'.repeat(64), bytes: 32 }],
});
const signature = createOperationSignature({
  operation_id: 'repair-index', name: 'repair-index', version: '1', scope,
  semantic_steps: ['read', 'repair', 'verify'],
  input_contract: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: false },
  output_contract: { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string' }, status: { enum: ['repaired'] } }, additionalProperties: false },
});
const observations = [
  { observation_id: 'obs-1', scope_id: scope.scope_id, source_snapshot_sha256: scope.source_snapshot_sha256, sequence: ['read', 'repair', 'verify'], input: { id: 'x' }, output: { id: 'x', status: 'repaired' }, cost: { model_calls: 1, tool_calls: 2, tokens: 20, elapsed_ms: 4 }, evidence: [sourceEvidence('evidence-1')] },
  { observation_id: 'obs-2', scope_id: scope.scope_id, source_snapshot_sha256: scope.source_snapshot_sha256, sequence: ['read', 'repair', 'verify'], input: { id: 'y' }, output: { id: 'y', status: 'repaired' }, cost: { model_calls: 0, tool_calls: 2, tokens: 16, elapsed_ms: 3 }, evidence: [sourceEvidence('evidence-2')] },
];
const counterexamples = [{
  counterexample_id: 'counterexample-unknown', input: { id: 7 }, expected: { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' }, evidence: sourceEvidence('evidence-counter'),
}];
const transitionEvidence = id => sourceEvidence(id);

function candidateAtShadow() {
  let candidate = buildAutomationCandidate({ signature, observations, producer_id: 'histos-a00', counterexamples });
  candidate = advanceCandidate(candidate, 'REPEATED', transitionEvidence('transition-repeated'));
  candidate = advanceCandidate(candidate, 'CANDIDATE', transitionEvidence('transition-candidate'));
  return advanceCandidate(candidate, 'SHADOW', { ...transitionEvidence('transition-shadow'), shadow_plan: { cases: 2 } });
}

test('positive deterministic fixture derives metrics and reaches VERIFIED only through shadow and independent verifier', async () => {
  const observed = buildAutomationCandidate({ signature, observations, producer_id: 'histos-a00', counterexamples });
  assert.equal(observed.state, 'OBSERVED');
  assert.equal(observed.metrics.occurrence_count, 2);
  assert.equal(observed.metrics.stable_sequence_ratio, 1);
  assert.equal(observed.metrics.failure_frequency, 0);

  const shadowCandidate = candidateAtShadow();
  const shadow = await runShadowEvaluation({
    candidate: shadowCandidate,
    cases: [
      { case_id: 'known', input: { id: 'fixture' }, expected: { kind: 'output', output: { id: 'fixture', status: 'repaired' } } },
      { case_id: 'unknown', input: { id: 'fixture-unknown' }, expected: { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' } },
    ],
    execute: async input => input.id.endsWith('unknown') ? { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' } : { kind: 'output', value: { id: input.id, status: 'repaired' } },
  });
  assert.equal(shadow.status, 'PASSED');
  const verified = await verifyAutomationCandidate({
    candidate: shadowCandidate,
    shadowResult: shadow,
    verifier: {
      verifier_id: 'independent-a00-verifier', implementation_sha256: 'c'.repeat(64), independent: true, deterministic: true,
      verify: ({ candidate, shadow: result }) => ({ pass: true, verifier_id: 'independent-a00-verifier', deterministic: true, checked_candidate_sha256: candidate.candidate_sha256, checked_shadow_digest: result.shadow_digest }),
    },
    evidence: transitionEvidence('transition-verified'),
  });
  assert.equal(verified.state, 'VERIFIED');
  assert.equal(verified.metrics.deterministic_verifier_available, true);
  validateAutomationCandidate(verified);
  const selection = selectQualifiedCandidate({ candidates: [verified], signature_sha256: signature.signature_sha256, scope_id: scope.scope_id });
  assert.equal(selection.selected_candidate_sha256, verified.candidate_sha256);
  assert.equal(selection.activation.authorized, false);
  const output = await executeQualifiedCandidate({ candidate: verified, input: { id: 'selected' }, execute: input => ({ kind: 'output', value: { id: input.id, status: 'repaired' } }) });
  assert.deepEqual(output.value, { id: 'selected', status: 'repaired' });
});

test('stable signatures and metrics are deterministic and bind the source snapshot', () => {
  const again = createOperationSignature({
    operation_id: 'repair-index', name: 'repair-index', version: '1', scope,
    semantic_steps: ['read', 'repair', 'verify'], input_contract: signature.input_contract, output_contract: signature.output_contract,
  });
  assert.equal(again.signature_sha256, signature.signature_sha256);
  const candidate = buildAutomationCandidate({ signature, observations, producer_id: 'histos-a00', counterexamples });
  const body = { ...candidate };
  delete body.candidate_sha256;
  assert.equal(candidate.candidate_sha256, digest(body));
});

test('forged, stale, and out-of-scope evidence are refused', () => {
  const candidate = buildAutomationCandidate({ signature, observations, producer_id: 'histos-a00', counterexamples });
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('bad-snapshot'), source_snapshot_sha256: 'd'.repeat(64) }), /EVIDENCE_STALE/);
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('bad-scope'), scope_id: 'other-project' }), /EVIDENCE_OUT_OF_SCOPE/);
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('forged'), evidence_sha256: 'e'.repeat(64) }), /EVIDENCE_FORGED/);
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('stale'), state: 'stale' }), /EVIDENCE_STALE/);
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('windows-absolute'), references: [{ kind: 'source', path: 'C:\\outside\\file.json', sha256: 'b'.repeat(64), bytes: 1 }] }), /EVIDENCE_REFERENCE_INVALID/);
  assert.throws(() => advanceCandidate(candidate, 'REPEATED', { ...sourceEvidence('unc'), references: [{ kind: 'source', path: '\\\\server\\share\\file.json', sha256: 'b'.repeat(64), bytes: 1 }] }), /EVIDENCE_REFERENCE_INVALID/);
});

test('lifecycle skips, unsafe authority, and activation are fail-closed', () => {
  const candidate = buildAutomationCandidate({ signature, observations, producer_id: 'histos-a00', counterexamples });
  assert.throws(() => advanceCandidate(candidate, 'SHADOW', transitionEvidence('skip')), /LIFECYCLE_TRANSITION_REJECTED/);
  assert.throws(() => validateAutomationCandidate({ ...candidate, authority: 'system' }), /CANDIDATE_AUTHORITY_UNSAFE/);
  assert.throws(() => activateCandidate({ candidate }), /EXTERNAL_AUTHORITY_REQUIRED/);
});

test('typed output and abstention are stable and control fields cannot be returned', async () => {
  const candidate = candidateAtShadow();
  await assert.rejects(runShadowEvaluation({ candidate, cases: [{ case_id: 'bad', input: { id: 'x' }, expected: { kind: 'output', output: { id: 'x', status: 'repaired' } } }], execute: () => ({ kind: 'output', value: { id: 'x', status: 'repaired', authority: 'system' } }) }), /IO_ADDITIONAL_PROPERTY/);
  await assert.rejects(runShadowEvaluation({ candidate, cases: [{ case_id: 'mission', input: { id: 'x' }, expected: { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' } }], execute: () => ({ kind: 'abstain', reason_code: 'UNKNOWN_INPUT', mission_state: 'COMPLETE' }) }), /EXECUTION_CONTROL_MUTATION/);
  const shadow = await runShadowEvaluation({ candidate, cases: [{ case_id: 'abstain', input: { id: 'x' }, expected: { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' } }], execute: () => ({ kind: 'abstain', reason_code: 'UNKNOWN_INPUT' }) });
  assert.equal(shadow.status, 'PASSED');
});

test('failed counterexample and nondeterministic shadow cannot be verified', async () => {
  const candidate = candidateAtShadow();
  const failed = await runShadowEvaluation({ candidate, cases: [{ case_id: 'wrong', input: { id: 'x' }, expected: { kind: 'abstain', reason_code: 'UNKNOWN_INPUT' } }], execute: () => ({ kind: 'output', value: { id: 'x', status: 'repaired' } }) });
  assert.equal(failed.status, 'FAILED');
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: failed, verifier: { verifier_id: 'v', implementation_sha256: 'c'.repeat(64), independent: true, deterministic: true, verify: () => ({ pass: true }) }, evidence: transitionEvidence('failed-verify') }), /SHADOW_NOT_PASSED/);
  let attempt = 0;
  const nondeterministic = await runShadowEvaluation({ candidate, cases: [{ case_id: 'random', input: { id: 'x' }, expected: { kind: 'output', output: { id: 'x', status: 'repaired' } } }], execute: () => ({ kind: 'output', value: { id: attempt++ ? 'y' : 'x', status: 'repaired' } }) });
  assert.equal(nondeterministic.status, 'FAILED');
});

test('verifier identity and deterministic gates are mandatory', async () => {
  const candidate = candidateAtShadow();
  const shadow = await runShadowEvaluation({ candidate, cases: [{ case_id: 'known', input: { id: 'x' }, expected: { kind: 'output', output: { id: 'x', status: 'repaired' } } }], execute: input => ({ kind: 'output', value: { id: input.id, status: 'repaired' } }) });
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: shadow, verifier: { verifier_id: 'histos-a00', implementation_sha256: 'c'.repeat(64), independent: true, deterministic: true, verify: () => ({ pass: true }) }, evidence: transitionEvidence('same-owner') }), /VERIFIER_NOT_INDEPENDENT/);
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: shadow, verifier: { verifier_id: 'v', implementation_sha256: 'c'.repeat(64), independent: false, deterministic: true, verify: () => ({ pass: true }) }, evidence: transitionEvidence('not-independent') }), /VERIFIER_NOT_INDEPENDENT/);
});

test('shadow receipt is recomputed and forged counts, reports, or digest are refused', async () => {
  const candidate = candidateAtShadow();
  const shadow = await runShadowEvaluation({ candidate, cases: [{ case_id: 'known', input: { id: 'x' }, expected: { kind: 'output', output: { id: 'x', status: 'repaired' } } }], execute: input => ({ kind: 'output', value: { id: input.id, status: 'repaired' } }) });
  const verifier = { verifier_id: 'shadow-verifier', implementation_sha256: 'c'.repeat(64), independent: true, deterministic: true, verify: ({ candidate: c, shadow: s }) => ({ pass: true, verifier_id: 'shadow-verifier', deterministic: true, checked_candidate_sha256: c.candidate_sha256, checked_shadow_digest: s.shadow_digest }) };
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: { ...shadow, reports: [], case_count: 0, passed_count: 0, failed_count: 0, counterexamples_checked: 0, case_digests: [], shadow_digest: 'c'.repeat(64) }, verifier, evidence: transitionEvidence('forged-shadow-empty') }), /SHADOW_RESULT_INVALID/);
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: { ...shadow, shadow_digest: 'c'.repeat(64) }, verifier, evidence: transitionEvidence('forged-shadow-digest') }), /SHADOW_RESULT_INVALID/);
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: { ...shadow, status: 'PASSED', passed_count: 0, failed_count: 1 }, verifier, evidence: transitionEvidence('forged-shadow-counts') }), /SHADOW_RESULT_INVALID/);
  const forgedPassReports = [{ case_id: 'known', disposition: 'PASS' }];
  const forgedPassDigests = shadow.case_digests;
  const forgedPass = { ...shadow, reports: forgedPassReports, case_count: 1, passed_count: 1, failed_count: 0, counterexamples_checked: 1, case_digests: forgedPassDigests, shadow_digest: digest({ candidate_sha256: shadow.candidate_sha256, case_digests: forgedPassDigests, reports: forgedPassReports }) };
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: forgedPass, verifier, evidence: transitionEvidence('forged-shadow-pass') }), /SHADOW_RESULT_INVALID/);
  const evilValue = { id: 'evil', status: 'repaired' };
  const forgedOutcomeReport = {
    ...shadow.reports[0], input: { id: 'x' }, expected: { kind: 'output', output_sha256: digest(evilValue) },
    actual: { kind: 'output', value: evilValue, output_sha256: digest(evilValue) }, disposition: 'PASS',
  };
  const forgedOutcome = { ...shadow, reports: [forgedOutcomeReport], shadow_digest: digest({ candidate_sha256: shadow.candidate_sha256, case_digests: shadow.case_digests, reports: [forgedOutcomeReport] }) };
  await assert.rejects(verifyAutomationCandidate({ candidate, shadowResult: forgedOutcome, verifier, evidence: transitionEvidence('forged-shadow-outcome') }), /SHADOW_RESULT_INVALID/);
});

test('rollback requires prior qualified path, exact scope/signature, and preserves authority boundary', async () => {
  const candidate = candidateAtShadow();
  const shadow = await runShadowEvaluation({ candidate, cases: [{ case_id: 'known', input: { id: 'x' }, expected: { kind: 'output', output: { id: 'x', status: 'repaired' } } }], execute: input => ({ kind: 'output', value: { id: input.id, status: 'repaired' } }) });
  const verify = details => verifyAutomationCandidate({ candidate, shadowResult: shadow, verifier: { verifier_id: 'v', implementation_sha256: 'c'.repeat(64), independent: true, deterministic: true, verify: ({ candidate: c, shadow: s }) => ({ pass: true, verifier_id: 'v', deterministic: true, checked_candidate_sha256: c.candidate_sha256, checked_shadow_digest: s.shadow_digest }) }, evidence: transitionEvidence(details) });
  const prior = await verify('prior-verify');
  assert.throws(() => rollbackCandidate({ candidate, priorCandidate: candidate, reason: 'failed', evidence: transitionEvidence('rollback-invalid') }), /ROLLBACK_PRIOR_NOT_QUALIFIED/);
  const receipt = rollbackCandidate({ candidate: prior, priorCandidate: prior, reason: 'new path regressed', evidence: transitionEvidence('rollback-valid') });
  assert.equal(receipt.rollback_integrity, true);
  assert.equal(receipt.authority, 'none');
});

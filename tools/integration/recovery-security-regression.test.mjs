import assert from 'node:assert/strict';
import test from 'node:test';

import { RECOVERY_SECURITY_SCHEMA, runRecoverySecurityRegression } from './recovery-security-regression.mjs';

test('R10 recovery/security regression keeps R2-R9 fail-closed gates executable', async () => {
  const report = await runRecoverySecurityRegression();
  assert.equal(report.schema, RECOVERY_SECURITY_SCHEMA);
  assert.equal(report.status, 'PASS');
  assert.deepEqual(Object.keys(report.probes).sort(), ['ephemera', 'events', 'kura', 'providers', 'service', 'skill', 'telemetry']);
  for (const [name, probe] of Object.entries(report.probes)) assert.equal(probe.status, 'PASS', name);
  assert.equal(report.probes.service.recovered, true);
  assert.equal(report.probes.events.duplicate, true);
  assert.equal(report.probes.providers.retry.failed, 1);
  assert.equal(report.probes.kura.raw_store_unchanged, true);
  assert.equal(report.probes.telemetry.a01.byte_equivalent, true);
  assert.equal(report.probes.ephemera.transition_calls, 0);
});


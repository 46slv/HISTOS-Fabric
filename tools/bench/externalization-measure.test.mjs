import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { measureExternalization } from './externalization-measure.mjs';

async function withStore(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-externalization-measure-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function largePayload() {
  const filler = Array.from({ length: 2400 }, (_, index) => `noise-${String(index).padStart(4, '0')} ${'x'.repeat(64)}`);
  filler.splice(1733, 0, 'VERIFICATION_MARKER exact reopen evidence');
  return `${filler.join('\n')}\n`;
}

test('oversized payload preserves exact verification while reducing observed active bytes', async () => {
  await withStore(async (root) => {
    const report = await measureExternalization({
      root,
      payload: largePayload(),
      query: 'VERIFICATION_MARKER',
      thresholdBytes: 1024,
      previewBytes: 96,
    });

    assert.equal(report.schema, 'histos.externalization-measure/v0');
    assert.equal(report.externalized, true);
    assert.equal(report.correctness_preserved, true);
    assert.equal(report.evidence.search_total_matches, 1);
    assert.ok(report.evidence.reopened_end_byte_exclusive > report.evidence.reopened_start_byte);
    assert.ok(report.externalized_active_bytes < report.baseline_active_bytes);
    assert.ok(report.reduction_bytes > 0);
    assert.ok(report.reduction_ratio > 0.9);
  });
});

test('missing evidence does not become a false correctness pass', async () => {
  await withStore(async (root) => {
    const report = await measureExternalization({
      root,
      payload: largePayload(),
      query: 'ABSENT_MARKER',
      thresholdBytes: 1024,
      previewBytes: 64,
    });

    assert.equal(report.externalized, true);
    assert.equal(report.correctness_preserved, false);
    assert.equal(report.evidence.search_total_matches, 0);
    assert.equal(report.evidence.reopened_start_byte, null);
  });
});

test('inline and externalized paths use the same case-insensitive verification semantics', async () => {
  await withStore(async (root) => {
    const report = await measureExternalization({
      root,
      payload: 'Prefix Verification_Marker suffix',
      query: 'verification_marker',
      thresholdBytes: 4096,
      previewBytes: 32,
    });

    assert.equal(report.externalized, false);
    assert.equal(report.correctness_preserved, true);
    assert.equal(report.evidence.disposition, 'INLINE');
  });
});

test('identical payload measurement remains content-address stable', async () => {
  await withStore(async (root) => {
    const options = {
      root,
      payload: largePayload(),
      query: 'VERIFICATION_MARKER',
      thresholdBytes: 1024,
      previewBytes: 96,
    };
    const first = await measureExternalization(options);
    const second = await measureExternalization(options);

    assert.equal(first.correctness_preserved, true);
    assert.equal(second.correctness_preserved, true);
    assert.equal(first.evidence.artifact_sha256, second.evidence.artifact_sha256);
    assert.equal(first.evidence.artifact_bytes, second.evidence.artifact_bytes);
    assert.equal(first.baseline_active_bytes, second.baseline_active_bytes);
  });
});

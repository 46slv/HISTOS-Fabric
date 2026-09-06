import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runBenchmarkWithExternalization } from './benchmark-externalization.mjs';

async function withFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-bench-externalization-'));
  try {
    await mkdir(path.join(root, 'corpus'), { recursive: true });
    const source = 'alpha line\nVERIFICATION evidence line\nomega line\n';
    await writeFile(path.join(root, 'corpus', 'source.txt'), source, 'utf8');
    await writeFile(path.join(root, 'suite.json'), JSON.stringify({
      schema: 'histos.benchmark-suite/v0',
      suite_id: 'fixture',
      profiles: [{ id: '2k', max_bytes: 2048 }],
      cases: [
        { id: 'hit', query: 'VERIFICATION', corpus: ['corpus/source.txt'], required_evidence_groups: [] },
        { id: 'empty', query: 'absent', corpus: ['corpus/source.txt'], required_evidence_groups: [], expect_no_answer: true },
      ],
    }), 'utf8');
    return await fn(root, source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function makeFakeLexical(source, sha) {
  return {
    schema: 'histos.lexical-baseline-report/v0',
    suite_id: 'fixture',
    scoring: { kind: 'fake' },
    reports: [{
      profile: '2k',
      max_bytes: 2048,
      aggregate: { required_evidence_group_recall: 1 },
      cases: [
        {
          case_id: 'hit',
          query: 'VERIFICATION',
          expect_no_answer: false,
          profile: '2k',
          max_bytes: 2048,
          corpus: [{ path: 'corpus/source.txt', sha256: sha, bytes: Buffer.byteLength(source) }],
          selection: {
            rendered_bytes: 32,
            fragments: [{
              path: 'corpus/source.txt',
              start_line: 1,
              end_line: 3,
              source_sha256: sha,
              text: source.trimEnd(),
              matched_lines: [2],
              gold_overlap: false,
            }],
          },
          metrics: {
            required_evidence_groups_total: 0,
            required_evidence_groups_hit: 0,
            raw_source_bytes_exposed: Buffer.byteLength(source),
          },
        },
        {
          case_id: 'empty',
          query: 'absent',
          expect_no_answer: true,
          profile: '2k',
          max_bytes: 2048,
          corpus: [{ path: 'corpus/source.txt', sha256: sha, bytes: Buffer.byteLength(source) }],
          selection: { rendered_bytes: 0, fragments: [] },
          metrics: { required_evidence_groups_total: 0, required_evidence_groups_hit: 0, raw_source_bytes_exposed: 0 },
        },
      ],
    }],
  };
}

test('joins lexical report with real externalize-search-reopen evidence without gold-driven probe selection', async () => {
  await withFixture(async (root, source) => {
    const crypto = await import('node:crypto');
    const sha = crypto.createHash('sha256').update(Buffer.from(source)).digest('hex');
    const fakeLexical = makeFakeLexical(source, sha);

    const report = await runBenchmarkWithExternalization(path.join(root, 'suite.json'), {
      storeRoot: path.join(root, 'store'),
      thresholdBytes: 0,
      previewBytes: 16,
      runSuiteFn: async () => fakeLexical,
    });

    const measured = report.reports[0].cases[0].externalization;
    assert.equal(report.schema, 'histos.benchmark-externalization-report/v0');
    assert.equal(measured.status, 'MEASURED');
    assert.equal(measured.probe, 'VERIFICATION evidence line');
    assert.equal(measured.measurement.externalized, true);
    assert.equal(measured.measurement.correctness_preserved, true);
    assert.equal(measured.measurement.evidence.search_total_matches, 1);
    assert.equal(report.reports[0].cases[1].externalization.status, 'NOT_APPLICABLE_EMPTY_SELECTION');
    assert.equal(report.reports[0].externalization_aggregate.measured_cases, 1);
    assert.equal(report.reports[0].externalization_aggregate.correctness_preserved_cases, 1);
  });
});

test('fails closed if corpus bytes move after lexical report', async () => {
  await withFixture(async (root, source) => {
    const fakeLexical = makeFakeLexical(source, '0'.repeat(64));

    await assert.rejects(
      () => runBenchmarkWithExternalization(path.join(root, 'suite.json'), {
        storeRoot: path.join(root, 'store'),
        thresholdBytes: 0,
        runSuiteFn: async () => fakeLexical,
      }),
      /SOURCE_MOVED/,
    );
  });
});

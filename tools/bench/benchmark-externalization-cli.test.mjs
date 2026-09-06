import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';

import { formatText, main, parseArgs, summarizeReport } from './benchmark-externalization-cli.mjs';

function fakeReport({ preserved4k = 2 } = {}) {
  const profile = (id, maxBytes, recall, measured, preserved) => ({
    profile: id,
    max_bytes: maxBytes,
    aggregate: {
      required_evidence_group_recall: recall,
      selected_fragment_gold_precision: 0.75,
      raw_source_bytes_exposed: maxBytes / 2,
      rendered_bytes: maxBytes / 4,
      no_answer_cases_pass: 1,
      no_answer_cases_total: 1,
    },
    externalization_aggregate: {
      measured_cases: measured,
      correctness_preserved_cases: preserved,
      baseline_active_bytes: maxBytes * 10,
      externalized_active_bytes: maxBytes,
      reduction_bytes: maxBytes * 9,
      reduction_ratio: 0.9,
    },
  });
  return {
    schema: 'histos.benchmark-externalization-report/v0',
    suite_id: 'fixture',
    measurement_semantics: { tokenizer_metric: 'NOT_IMPLEMENTED' },
    reports: [
      profile('2k', 2048, 1, 2, 2),
      profile('4k', 4096, 0.5, 2, preserved4k),
      profile('8k', 8192, 1, 0, 0),
    ],
  };
}

function capture() {
  let value = '';
  return {
    stream: { write(chunk) { value += String(chunk); } },
    read() { return value; },
  };
}

test('parses explicit store/report and bounded numeric options, rejecting ambiguous input', () => {
  assert.deepEqual(parseArgs(['bench/suite.json', '--store', 'tmp/artifacts', '--report', 'tmp/report.json', '--profile', '4k', '--threshold', '0', '--preview', '64', '--json']), {
    suitePath: 'bench/suite.json',
    storeRoot: 'tmp/artifacts',
    reportPath: 'tmp/report.json',
    profileId: '4k',
    thresholdBytes: 0,
    previewBytes: 64,
    json: true,
    help: false,
  });
  assert.throws(() => parseArgs(['bench/suite.json']), /--store required/);
  assert.throws(() => parseArgs(['bench/suite.json', '--store', 'x', '--threshold', '-1']), /non-negative integer/);
  assert.throws(() => parseArgs(['bench/suite.json', '--store', 'x', '--wat']), /unknown option/);
  assert.throws(() => parseArgs(['a.json', 'b.json', '--store', 'x']), /unexpected positional/);
});

test('summarizes retrieval and externalization metrics for every budget profile', () => {
  const summary = summarizeReport(fakeReport());
  assert.equal(summary.schema, 'histos.benchmark-joint-summary/v0');
  assert.equal(summary.profiles.length, 3);
  assert.deepEqual(summary.profiles.map((entry) => entry.profile), ['2k', '4k', '8k']);
  assert.equal(summary.profiles[0].required_evidence_group_recall, 1);
  assert.equal(summary.profiles[1].raw_source_bytes_exposed, 2048);
  assert.equal(summary.profiles[1].externalized_active_bytes, 4096);
  assert.equal(summary.profiles[2].externalization_correctness_pass, null);
  assert.equal(summary.all_externalization_correctness_preserved, true);
  assert.match(formatText(summary), /profile=4k .*recall=0\.500000 .*externalized=2\/2 .*reduction_ratio=0\.900000/);
});

test('main emits JSON and forwards all execution options to the joint runner', async () => {
  const out = capture();
  const err = capture();
  let received = null;
  const code = await main([
    'bench/synthetic-v0.json', '--store', '.tmp/histos', '--profile', '2k', '--threshold', '512', '--preview', '32', '--json',
  ], {
    run: async (suitePath, options) => {
      received = { suitePath, options };
      return fakeReport();
    },
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(code, 0);
  assert.deepEqual(received, {
    suitePath: 'bench/synthetic-v0.json',
    options: { profileId: '2k', storeRoot: '.tmp/histos', thresholdBytes: 512, previewBytes: 32 },
  });
  assert.equal(err.read(), '');
  assert.equal(JSON.parse(out.read()).suite_id, 'fixture');
});

test('explicit report path publishes one durable no-overwrite evidence envelope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'histos-cli-evidence-'));
  const reportPath = join(root, 'nested', 'evidence.json');
  const out = capture();
  const err = capture();
  const args = ['bench/synthetic-v0.json', '--store', join(root, 'store'), '--report', reportPath, '--profile', '4k'];
  const run = async () => fakeReport();

  const first = await main(args, { run, stdout: out.stream, stderr: err.stream });
  assert.equal(first, 0);
  assert.equal(err.read(), '');
  const before = await readFile(reportPath);
  const evidence = JSON.parse(before);
  assert.equal(evidence.schema, 'histos.benchmark-joint-evidence/v0');
  assert.equal(evidence.suite_id, 'fixture');
  assert.deepEqual(evidence.execution_options, { profile: '4k', threshold_bytes: 256, preview_bytes: 64 });
  assert.equal(evidence.report.schema, 'histos.benchmark-externalization-report/v0');
  assert.equal(evidence.summary.schema, 'histos.benchmark-joint-summary/v0');

  const secondOut = capture();
  const secondErr = capture();
  const second = await main(args, { run, stdout: secondOut.stream, stderr: secondErr.stream });
  assert.equal(second, 1);
  assert.equal(secondOut.read(), '');
  assert.match(secondErr.read(), /REPORT_EXISTS: refusing to overwrite/);
  assert.deepEqual(await readFile(reportPath), before);
});

test('failed correctness gate still publishes the exact failing evidence before returning nonzero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'histos-cli-failure-evidence-'));
  const reportPath = join(root, 'failed.json');
  const out = capture();
  const err = capture();
  const code = await main(['bench/synthetic-v0.json', '--store', join(root, 'store'), '--report', reportPath], {
    run: async () => fakeReport({ preserved4k: 1 }),
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(code, 1);
  assert.equal(err.read(), '');
  const evidence = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(evidence.summary.all_externalization_correctness_preserved, false);
  assert.match(out.read(), /profile=4k .*externalized=1\/2/);
});

test('main fails the measurement gate when any measured case loses reopen correctness', async () => {
  const out = capture();
  const err = capture();
  const code = await main(['bench/synthetic-v0.json', '--store', '.tmp/histos'], {
    run: async () => fakeReport({ preserved4k: 1 }),
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(code, 1);
  assert.equal(err.read(), '');
  assert.match(out.read(), /profile=4k .*externalized=1\/2/);
});

test('help is side-effect free and does not require a suite or store', async () => {
  const out = capture();
  const err = capture();
  let called = false;
  const code = await main(['--help'], {
    run: async () => { called = true; return fakeReport(); },
    stdout: out.stream,
    stderr: err.stream,
  });
  assert.equal(code, 0);
  assert.equal(called, false);
  assert.match(out.read(), /usage:.*--report/);
  assert.equal(err.read(), '');
});

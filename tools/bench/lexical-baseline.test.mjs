import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSuite, validateRelativePath } from './lexical-baseline.mjs';

const fixtureSuite = path.resolve('bench/synthetic-v0.json');

test('refuses absolute and parent-traversal corpus paths', () => {
  assert.throws(() => validateRelativePath('../secret.txt'), /parent traversal refused/);
  assert.throws(() => validateRelativePath('/tmp/secret.txt'), /absolute path refused/);
  assert.equal(validateRelativePath('fixtures/tiny-repo/src/snapshot.mjs'), 'fixtures/tiny-repo/src/snapshot.mjs');
});

test('synthetic suite is deterministic and exact-reopenable', async () => {
  const first = await runSuite(fixtureSuite, { profileId: '4k' });
  const second = await runSuite(fixtureSuite, { profileId: '4k' });
  assert.deepEqual(first, second);

  const report = first.reports[0];
  assert.equal(report.aggregate.required_evidence_group_recall, 1);
  assert.equal(report.aggregate.no_answer_cases_total, 1);
  assert.equal(report.aggregate.no_answer_cases_pass, 1);
  assert.ok(report.cases.every((item) => item.metrics.exact_reopen_coordinates));
  assert.ok(report.cases.every((item) => item.selection.rendered_bytes <= item.max_bytes));
});

test('smaller byte budget cannot be exceeded', async () => {
  const result = await runSuite(fixtureSuite, { profileId: '2k' });
  for (const item of result.reports[0].cases) {
    assert.ok(item.selection.rendered_bytes <= 2048);
  }
});


test('gold labels cannot influence lexical selection', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'histos-bench-gold-'));
  await mkdir(path.join(dir, 'fixtures'), { recursive: true });
  await writeFile(path.join(dir, 'fixtures', 'a.txt'), 'alpha beta\n', 'utf8');
  await writeFile(path.join(dir, 'fixtures', 'b.txt'), 'alpha beta\n', 'utf8');

  const base = {
    schema: 'histos.benchmark-suite/v0',
    suite_id: 'gold-independence',
    profiles: [{ id: 'tiny', max_bytes: 180 }],
    cases: [{
      id: 'case',
      query: 'alpha beta',
      corpus: ['fixtures/a.txt', 'fixtures/b.txt'],
      required_evidence_groups: [],
    }],
  };
  const suiteA = structuredClone(base);
  suiteA.cases[0].required_evidence_groups = [{ id: 'gold', ranges: [{ path: 'fixtures/a.txt', start_line: 1, end_line: 1 }] }];
  const suiteB = structuredClone(base);
  suiteB.cases[0].required_evidence_groups = [{ id: 'gold', ranges: [{ path: 'fixtures/b.txt', start_line: 1, end_line: 1 }] }];
  const pathA = path.join(dir, 'a.json');
  const pathB = path.join(dir, 'b.json');
  await writeFile(pathA, JSON.stringify(suiteA), 'utf8');
  await writeFile(pathB, JSON.stringify(suiteB), 'utf8');

  const resultA = await runSuite(pathA, { profileId: 'tiny' });
  const resultB = await runSuite(pathB, { profileId: 'tiny' });
  const selectionA = resultA.reports[0].cases[0].selection.fragments.map(({ gold_overlap, ...fragment }) => fragment);
  const selectionB = resultB.reports[0].cases[0].selection.fragments.map(({ gold_overlap, ...fragment }) => fragment);
  assert.deepEqual(selectionA, selectionB);
});

test('realpath containment refuses a symlinked corpus escape', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'histos-bench-symlink-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'histos-bench-outside-'));
  await mkdir(path.join(dir, 'fixtures'), { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'secret alpha\n', 'utf8');
  // Directory junctions exercise the same realpath escape on Windows without
  // requiring global Developer Mode or symlink privileges.
  // Packaged Windows processes can map LocalAppData to a physical LocalCache
  // path. Point the junction at that canonical physical target so the fixture
  // exercises a real readable escape instead of a dangling logical target.
  await symlink(await realpath(outside), path.join(dir, 'fixtures', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const suite = {
    schema: 'histos.benchmark-suite/v0',
    suite_id: 'symlink-escape',
    profiles: [{ id: 'tiny', max_bytes: 100 }],
    cases: [{
      id: 'case',
      query: 'alpha',
      corpus: ['fixtures/linked/secret.txt'],
      required_evidence_groups: [],
    }],
  };
  const suitePath = path.join(dir, 'suite.json');
  await writeFile(suitePath, JSON.stringify(suite), 'utf8');
  await assert.rejects(() => runSuite(suitePath), /escaped suite directory after realpath/);
});

test('unknown profile fails closed', async () => {
  await assert.rejects(() => runSuite(fixtureSuite, { profileId: 'missing' }), /UNKNOWN_PROFILE/);
});

test('suite validation rejects evidence outside explicit corpus', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'histos-bench-'));
  await mkdir(path.join(dir, 'fixtures'), { recursive: true });
  await writeFile(path.join(dir, 'fixtures', 'a.txt'), 'alpha\n', 'utf8');
  const suite = {
    schema: 'histos.benchmark-suite/v0',
    suite_id: 'bad-evidence-path',
    profiles: [{ id: 'tiny', max_bytes: 100 }],
    cases: [{
      id: 'case',
      query: 'alpha',
      corpus: ['fixtures/a.txt'],
      required_evidence_groups: [{ id: 'g', ranges: [{ path: 'fixtures/b.txt', start_line: 1, end_line: 1 }] }],
    }],
  };
  const suitePath = path.join(dir, 'suite.json');
  await writeFile(suitePath, JSON.stringify(suite), 'utf8');
  await assert.rejects(() => runSuite(suitePath), /not in corpus/);
});

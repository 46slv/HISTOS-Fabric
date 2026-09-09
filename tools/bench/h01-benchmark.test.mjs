import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runH01Benchmark } from './h01-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('real frozen H01 retrieval preserves complete ranges and reduces public source exposure', async () => {
  const report = await runH01Benchmark(
    path.join(root, 'bench/public-gold-v1.json'),
    path.join(root, 'bench/public-gold-freeze-v1.json'),
    path.join(root, 'bench/evidence/public-baseline-v1-portable.json'),
  );
  assert.equal(report.freeze.gold_sha256, '146cc45d9ba119376fa7ec8feec838966bfcc9472e5da55da8127857f7a90ad6');
  assert.equal(report.index.cold.parsed_files, 3);
  assert.equal(report.index.warm.reused_files, 3);
  assert.equal(report.index.warm.parsed_files, 0);
  for (const profile of report.reports) {
    assert.equal(profile.cases.length, 7);
    assert.ok(profile.cases.every((item) => item.capsule.budget.rendered_tokens <= profile.max_tokens));
    assert.ok(profile.cases.every((item) => item.capsule.source_fragments.every((fragment) => fragment.why_included.length > 0 && fragment.reopen.snapshot_digest === item.capsule.scope.snapshot_digest)));
    assert.ok(profile.aggregate.all.complete_evidence_group_recall >= profile.frozen_baseline.all.complete_evidence_group_recall);
    assert.equal(profile.aggregate.held_out.complete_evidence_groups_hit, 6);
    assert.equal(profile.aggregate.held_out.no_answer_cases_pass, 1);
    assert.ok(profile.aggregate.all.raw_source_bytes_exposed < profile.frozen_baseline.all.raw_source_bytes_exposed);
    assert.ok(profile.aggregate.all.raw_source_bytes_exposed < profile.aggregate.all.whole_file_raw_source_bytes);
  }
});

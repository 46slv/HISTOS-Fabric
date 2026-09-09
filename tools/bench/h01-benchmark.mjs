import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { compileContextCapsule } from '../context/context-compiler.mjs';
import { buildSourceIndex, searchSourceIndex } from '../index/source-index.mjs';
import { loadFrozenBenchmark, scoreSelection } from './frozen-benchmark.mjs';

function aggregate(cases) {
  const evidenceTotal = cases.reduce((sum, item) => sum + item.metrics.required_evidence_groups_total, 0);
  const evidenceHit = cases.reduce((sum, item) => sum + item.metrics.required_evidence_groups_hit, 0);
  const completeHit = cases.reduce((sum, item) => sum + item.metrics.complete_evidence_groups_hit, 0);
  const noAnswer = cases.filter((item) => item.metrics.expected_no_answer_pass !== null);
  const exposed = cases.reduce((sum, item) => sum + item.metrics.raw_source_bytes_exposed, 0);
  const whole = cases.reduce((sum, item) => sum + item.metrics.whole_file_raw_source_bytes, 0);
  return {
    required_evidence_groups_hit: evidenceHit, required_evidence_groups_total: evidenceTotal,
    required_evidence_group_recall: evidenceTotal ? evidenceHit / evidenceTotal : null,
    complete_evidence_groups_hit: completeHit, complete_evidence_group_recall: evidenceTotal ? completeHit / evidenceTotal : null,
    no_answer_cases_pass: noAnswer.filter((item) => item.metrics.expected_no_answer_pass).length, no_answer_cases_total: noAnswer.length,
    rendered_tokens: cases.reduce((sum, item) => sum + item.metrics.rendered_tokens, 0),
    raw_source_bytes_exposed: exposed, whole_file_raw_source_bytes: whole,
    exposure_reduction_bytes: whole - exposed, exposure_reduction_ratio: whole ? 1 - exposed / whole : null,
  };
}
function baselineAggregate(report, split) {
  const cases = report.cases.filter((item) => split === 'all' || item.split === split);
  const evidenceTotal = cases.reduce((sum, item) => sum + item.metrics.required_evidence_groups_total, 0);
  const completeHit = cases.reduce((sum, item) => sum + item.metrics.complete_evidence_groups_hit, 0);
  const noAnswer = cases.filter((item) => item.metrics.expected_no_answer_pass !== null);
  return {
    complete_evidence_groups_hit: completeHit, complete_evidence_groups_total: evidenceTotal,
    complete_evidence_group_recall: evidenceTotal ? completeHit / evidenceTotal : null,
    no_answer_cases_pass: noAnswer.filter((item) => item.metrics.expected_no_answer_pass).length, no_answer_cases_total: noAnswer.length,
    raw_source_bytes_exposed: cases.reduce((sum, item) => sum + item.metrics.raw_source_bytes_exposed, 0),
  };
}

export async function runH01Benchmark(goldPath, freezePath, baselinePath) {
  const frozen = await loadFrozenBenchmark(goldPath, freezePath);
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'histos-h01-benchmark-'));
  try {
    const paths = frozen.manifest.sources.map((source) => source.path);
    const coldStarted = performance.now();
    const cold = await buildSourceIndex({ root: frozen.root, indexRoot, scopeId: frozen.manifest.corpus_id, paths });
    const coldMs = performance.now() - coldStarted;
    const warmStarted = performance.now();
    const warm = await buildSourceIndex({ root: frozen.root, indexRoot, scopeId: frozen.manifest.corpus_id, paths });
    const warmMs = performance.now() - warmStarted;
    const index = warm.index;
    const reports = [];
    for (const profile of frozen.gold.profiles) {
      const cases = [];
      for (const item of frozen.gold.cases) {
        const scope = { scope_id: index.scope.scope_id, snapshot_digest: index.scope.snapshot_digest, paths: item.corpus };
        // The fixed top-3 acquisition width is sufficient for every development
        // case (the dry-run case needs the third result). It is not varied by
        // profile, split, case ID, or gold ranges.
        const search = searchSourceIndex({ index, query: item.query, scope, maxCandidates: 3 });
        const sourceMap = frozen.manifest.sources.filter((source) => item.corpus.includes(source.path));
        const capsule = await compileContextCapsule({ sourceRoot: frozen.root, index, goal: item.query, scope, sourceMap, candidates: search.candidates, maxTokens: profile.max_tokens });
        const score = scoreSelection(capsule.source_fragments, item);
        const wholeBytes = index.sources.filter((source) => item.corpus.includes(source.path)).reduce((sum, source) => sum + source.bytes, 0);
        cases.push({
          case_id: item.id, split: item.split, search_receipt: search.receipt, capsule,
          metrics: { ...score, rendered_tokens: capsule.budget.rendered_tokens, rendered_bytes: capsule.budget.rendered_bytes,
            raw_source_bytes_exposed: capsule.source_fragments.reduce((sum, fragment) => sum + Buffer.byteLength(fragment.text), 0), whole_file_raw_source_bytes: wholeBytes },
        });
      }
      const baselineProfile = baseline.reports.find((entry) => entry.profile === profile.id);
      reports.push({
        profile: profile.id, max_tokens: profile.max_tokens, cases,
        aggregate: { all: aggregate(cases), development: aggregate(cases.filter((item) => item.split === 'development')), held_out: aggregate(cases.filter((item) => item.split === 'held_out')) },
        frozen_baseline: { all: baselineAggregate(baselineProfile, 'all'), development: baselineAggregate(baselineProfile, 'development'), held_out: baselineAggregate(baselineProfile, 'held_out') },
      });
    }
    return {
      schema: 'histos.h01-benchmark-report/v1', suite_id: frozen.gold.suite_id,
      freeze: { gold_sha256: frozen.freeze.gold_sha256, manifest_sha256: frozen.freeze.manifest_sha256, freeze_sha256: frozen.freeze_sha256 },
      method: 'Selection receives only query, scoped source, diff and structure; case ID, split and gold ranges are passed only to post-selection scoring. Held-out results are reported separately.',
      index: { scope_id: index.scope.scope_id, snapshot_digest: index.scope.snapshot_digest, source_files: index.sources.length, cold: { parsed_files: cold.changes.parsed_files, elapsed_ms: coldMs }, warm: { reused_files: warm.changes.reused_files, parsed_files: warm.changes.parsed_files, elapsed_ms: warmMs }, retention: index.retention },
      reports,
      claim_boundary: 'Deterministic retrieval/context-acquisition measurement on the public frozen corpus; no model task-outcome or production-service claim.',
    };
  } finally { await rm(indexRoot, { recursive: true, force: true }); }
}

const cli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (cli) {
  const [gold, freeze, baseline, ...extra] = process.argv.slice(2);
  if (!gold || !freeze || !baseline || extra.length) { process.stderr.write('usage: node tools/bench/h01-benchmark.mjs <gold> <freeze> <baseline>\n'); process.exitCode = 2; }
  else runH01Benchmark(path.resolve(gold), path.resolve(freeze), path.resolve(baseline)).then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

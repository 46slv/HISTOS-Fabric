# HISTOS retrieval benchmark scaffold

Status: **H0 candidate / deterministic local tooling only**

This directory provides the first executable Phase-0 benchmark primitive from `docs/ROADMAP.md`: a frozen small corpus, explicit evidence labels, fixed byte-budget profiles, deterministic lexical selection, exact reopen coordinates, and machine-readable metrics.

It deliberately does **not** claim a Context Compiler, service runtime, MCP integration, tokenizer contract, production retrieval quality, or end-to-end model improvement.

## Run

```text
node --test tools/bench/lexical-baseline.test.mjs
node tools/bench/lexical-baseline.mjs bench/synthetic-v0.json
node tools/bench/lexical-baseline.mjs bench/synthetic-v0.json --profile 4k
npm run bench:joint -- --store .tmp/histos-bench
npm run bench:joint -- --store .tmp/histos-bench --json
npm run bench:joint -- --store .tmp/histos-bench --profile 4k
npm run bench:joint -- --store .tmp/histos-bench --report .tmp/histos-joint-evidence.json
```

No package install is required. The runner uses Node built-ins only; this does not settle the future HISTOS service language or dependency stack.

The joint benchmark requires an explicit artifact-store directory because Phase-1 externalization has `manual` retention in v0. The CLI does not create an implicit cleanup policy or delete retained artifacts.

Use `--report <file>` when a run should leave durable review evidence. It publishes a `histos.benchmark-joint-evidence/v0` envelope containing the full joint report, derived summary, and non-path execution options. Publication uses a private same-directory temporary file plus an atomic hard link and refuses an existing destination with `REPORT_EXISTS`; it never overwrites or deletes prior evidence. A correctness-failing run still publishes the failing evidence before returning nonzero. The envelope deliberately omits the suite path and artifact-store root.

## Suite format v0

A suite declares:

- `schema = histos.benchmark-suite/v0`;
- a stable `suite_id`;
- fixed profiles with exact `max_bytes` limits;
- cases with a query and an explicit corpus allowlist;
- zero or more `required_evidence_groups`, each containing one or more acceptable exact source ranges;
- optional `expect_no_answer=true` only when no evidence group is required.

Corpus paths are suite-relative and fail closed on absolute paths, parent traversal, duplicates, or evidence labels outside the explicit corpus.

## What is measured

The report records, per case/profile:

- immutable SHA-256 identity for every corpus file and one deterministic snapshot digest;
- selected file/line ranges and source digests for exact reopen;
- rendered UTF-8 bytes under the configured budget;
- required-evidence-group recall;
- selected-fragment gold precision;
- corpus files/bytes scanned by this simple baseline;
- raw source bytes exposed in selected fragments;
- no-answer behavior for explicitly labeled no-answer cases.

The first baseline is intentionally simple: exact normalized lexical token hits create two-line context windows, overlapping windows merge, and candidates are selected by deterministic score until the byte budget is exhausted.

## Externalization comparison seam

`tools/bench/benchmark-externalization.mjs` joins an existing lexical report to the Phase-1 externalization measurement without allowing gold labels to influence retrieval or probe choice.

For each case with at least one selected lexical hit it:

1. re-reads the exact allowed corpus and verifies every file still matches the lexical report SHA-256/byte identity;
2. serializes that allowed corpus into one deterministic benchmark payload;
3. chooses the first actual lexical matched line as the verification probe;
4. measures whole-payload exposure against `externalize -> literal search -> exact reopen` application bytes;
5. reports retrieval metrics and externalization metrics together under `histos.benchmark-externalization-report/v0`.

A source identity change fails closed as `SOURCE_MOVED`. A no-answer/empty-selection case is marked `NOT_APPLICABLE_EMPTY_SELECTION` rather than becoming a fake externalization correctness pass.

`tools/bench/benchmark-externalization-cli.mjs` turns that seam into one bounded command across the suite's 2k/4k/8k profiles. Its summary places retrieval recall/precision, raw selected-source exposure, rendered bytes, no-answer results, externalized application bytes, reduction, and reopen-correctness counts on the same per-profile line (or JSON object). The command exits nonzero when any measured externalization case loses exact search/reopen correctness; retrieval scores remain measurements rather than hard-coded pass thresholds.

This comparison is still an application-level byte experiment. It is not tokenizer accounting, automatic Codex/OpenCode interception, or evidence that model quality improved.

## Known H0 gaps

- `rendered_tokens` is intentionally `NOT_IMPLEMENTED`; byte budgeting must not be mislabeled as a provider tokenizer result.
- The included corpus is synthetic. Real/public reviewed cases and independently frozen gold remain required before reporting comparative retrieval quality.
- File scanning is direct and uncached. It is a repeatable baseline, not the future incremental index.
- Gold precision is only as good as the labels; related-but-unlabeled context can be penalized. Report numerators/denominators and inspect fragments when using the metric.
- No worker/model is run, so this is retrieval-only evidence.

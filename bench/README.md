# HISTOS retrieval benchmark scaffold

Status: **H0 candidate / deterministic local tooling only**

This directory provides the first executable Phase-0 benchmark primitive from `docs/ROADMAP.md`: a frozen small corpus, explicit evidence labels, fixed byte-budget profiles, deterministic lexical selection, exact reopen coordinates, and machine-readable metrics.

It deliberately does **not** claim a Context Compiler, service runtime, MCP integration, tokenizer contract, production retrieval quality, or end-to-end model improvement.

## Run

```text
node --test tools/bench/lexical-baseline.test.mjs
node tools/bench/lexical-baseline.mjs bench/synthetic-v0.json
node tools/bench/lexical-baseline.mjs bench/synthetic-v0.json --profile 4k
```

No package install is required. The runner uses Node built-ins only; this does not settle the future HISTOS service language or dependency stack.

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

## Known H0 gaps

- `rendered_tokens` is intentionally `NOT_IMPLEMENTED`; byte budgeting must not be mislabeled as a provider tokenizer result.
- The included corpus is synthetic. Real/public reviewed cases and independently frozen gold remain required before reporting comparative retrieval quality.
- File scanning is direct and uncached. It is a repeatable baseline, not the future incremental index.
- Gold precision is only as good as the labels; related-but-unlabeled context can be penalized. Report numerators/denominators and inspect fragments when using the metric.
- No worker/model is run, so this is retrieval-only evidence.

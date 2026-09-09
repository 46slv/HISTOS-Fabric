# Phase-0 source and Context Capsule contract v1

Status: **EXPERIMENTAL IMPLEMENTATION**, limited to the local frozen benchmark.

The executable contracts are `validateManifest`, `validateGold`, and
`loadFrozenBenchmark` in `tools/bench/frozen-benchmark.mjs`, plus
`compileCapsule` and `renderContext` in `tools/bench/context-capsule.mjs`.
They provide local retrieval material and audit metadata. They do not define
Mission authority, a service daemon, or a production general-purpose compiler.

## Source and provenance

`histos.source-manifest/v1` contains a corpus ID, status, public-source provenance,
and a source allowlist. Every source has a relative snapshot path, upstream HTTPS
repository, full Git commit, upstream path and URL, Git blob SHA-1, content
SHA-256, byte count, and line count. Source snapshots are exact `git show` bytes;
the original modules are data and are never executed by the benchmark.

Line coordinates are one-based and inclusive, using UTF-8 decoded text split on
LF or CRLF. The trailing empty split record counts as a line. Rendered fragments
join these records with LF. Thus SHA-256 always identifies original bytes, while
fragment text is an explicitly normalized line view, not a raw byte-range copy.
Reopen the original allowlisted snapshot or Git commit/path, verify its SHA-256,
and select the stated line interval. Externalization byte-range reads remain a
separate v0 contract in `EXTERNALIZATION_V0.md`.

Every run checks SHA-256, bytes, Git blob identity, valid UTF-8, and line count.
Unknown fields, path traversal, non-allowlisted labels, invalid line ranges,
duplicate identities, and realpath escapes fail closed. Frozen files have
`-text` Git attributes so a checkout does not change their line endings.
The snapshot cannot assert live current truth. Upstream source remains owned by
its repository, and source visibility does not imply a third-party license.
The included author-owned source has no license declaration at the pinned
revision; provenance records this without inventing a license.

## Frozen cases and independent annotation

`histos.benchmark-suite/v1` has exactly the 2k/4k/8k profiles with **2000, 4000,
8000 tokens**, a pinned tokenizer, queries, source allowlists, development or
held-out split, and relevant evidence groups. Each group contains alternative
acceptable line ranges and a reviewer rationale. A no-answer case has no
evidence groups. `annotation_note` is optional explanatory metadata.

`histos.gold-freeze/v1` is a separate receipt with `status: FROZEN`, reviewer,
method, SHA-256 of the exact manifest and gold files, and every reviewed case ID.
The runner refuses missing, mismatched, or incomplete receipts. The reviewer is
an independently attested process identity, not cryptographically authenticated
by a JSON string. Merely writing one's own receipt does not constitute review.
Any corpus, query, or label change requires a new independent review and freeze.

The published v1 annotations were independently corrected and frozen before
benchmark scoring. Held-out cases are held out from tuning, not encrypted or
hidden from source review. Fixed lexical v0 score, windows, ordering, and query
normalization are unchanged. Gold never enters candidate selection. Future
policy tuning needs fresh held-out evaluation; the seven public cases are too
small for broad quality claims.

## Capsule envelope and counted surface

`histos.context-capsule/v1` contains:

| Field | Meaning |
| --- | --- |
| `goal`, `scope` | Query, corpus ID, exact manifest snapshot SHA-256 |
| `current_truth_refs` | Empty: a frozen snapshot makes no live-current-truth claim |
| `source_map` | Complete source provenance for this request's allowed files |
| `source_fragments` | Source SHA-256, path, line interval, normalized text, inclusion reason |
| `memory`, `evidence_refs` | Empty: no synthesized memory or new supporting evidence |
| `open_questions` | Explicit incompleteness and upstream-authority boundary |
| `rendered_context` | The exact string intended as model input |
| `budget` | Requested token limit, actual tokens and bytes, tokenizer, counted surface |
| `selection_receipt` | Fixed algorithm, candidate/selected counts, omitted ranges/reasons, rendered SHA-256 |

Only **`rendered_context`** is the delivery surface. It includes the query,
snapshot identity, non-authority/incompleteness warning, every selected range
header and source SHA, and source text. The rest of the envelope is audit data.
Sending the entire JSON envelope to a model requires independently counting
that serialization; its size is not covered by `budget.rendered_tokens`.

The runner uses `js-tiktoken@1.0.21`, `cl100k_base`, exact-pinned in the local npm
lockfile. Special-token-looking source strings are encoded as ordinary text.
This is an explicit tokenizer contract, not a claim about every provider's
message overhead or billing. No paid API is called. The dependency has no
runtime network fetch; rank data is bundled in the package. Existing synthetic
v0 byte profiles remain bytes and retain their old output contract.

Candidates arrive in fixed lexical v0 order. Each complete candidate is admitted
only if counting the entire proposed rendered string fits the profile. No
window splitting, gold-guided ranking, or baseline optimization is performed.
An oversized mandatory preamble fails rather than exceeding the budget.

## Measurement vocabulary

Reports include source/freeze/code/lockfile identities and the following fields:

| Dimension | v1 measurement |
| --- | --- |
| Recall | Overlapping evidence-group recall, plus complete-range group recall; both with counts |
| Precision | Selected-fragment overlap and selected-line relevance precision, with counts |
| Rendered tokens / bytes | Exact `rendered_context` token and UTF-8 byte counts |
| Raw source bytes / lines | Sum of selected normalized fragment bytes and inclusive line intervals |
| Tool / search calls | Zero external agent tools; one direct lexical corpus scan per request |
| Whole-file reads / rereads | Actual full source reads per request; no duplicate read within a request |
| Retrieval latency | Fresh read, hash, lexical selection and token compilation wall time |
| Cold / warm latency | `NOT_MEASURED`: OS page cache uncontrolled; no derived cache implemented |
| Cache hit rate | `NOT_APPLICABLE`, 0 lookups and null rate; no fake zero-percent cache experiment |
| Incremental update cost | `NOT_MEASURED`: no incremental index in this baseline |
| Stale-context harm | `NOT_MEASURED`: digest drift is rejected, but no stale task-outcome experiment |
| Verified task outcome | `NOT_MEASURED`: no model, worker, or patch-generation task run |

Preflight validation reads every source once and is separately accounted.
Each case/profile then makes one fresh retrieval request. Across requests these
are deliberately repeated whole-file reads, not warm-cache hits. Runtime import
and tokenizer initialization are excluded from request latency. Timing varies;
selection, tokens and source identity are deterministic.

Whole-file reference counts render all the same already-loaded source. This is
a counterfactual input exposure comparison without a budget, not an additional
IO run or an end-to-end model experiment. A no-answer miss remains a measured
failure; the runner does not pretend lexical matches prove answerability.

Tests: `node --test tools/bench/frozen-benchmark.test.mjs`; full regression:
`npm test`. The real frozen run is `npm run bench:frozen`. The v0 joint byte
benchmark remains available separately as `npm run bench:joint -- --store <dir>`.

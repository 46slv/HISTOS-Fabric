# Phase 1-3 public evaluation

Status: **BOUNDED PUBLIC CORPUS RESULT**

The candidate was measured against the independently frozen H00 corpus without
changing the corpus, gold, freeze receipt, or portable baseline:

| File | SHA-256 |
| --- | --- |
| `bench/public-corpus-v1.json` | `fa4d2f0ecc33aef32720f38a40489e4166e2854dd25695a921db091a3ba377d2` |
| `bench/public-gold-v1.json` | `146cc45d9ba119376fa7ec8feec838966bfcc9472e5da55da8127857f7a90ad6` |
| `bench/public-gold-freeze-v1.json` | `3eea13213ead69b52b6b7e3b11c4690b77ccebdaf2be1ea6e0d11faa1c0c2903` |
| `bench/evidence/public-baseline-v1-portable.json` | `e65cfaf10b80b3b7a824a2f023ee266f85ac9dae8c31dfb1c4eb12dc9cd608f5` |

The fixed candidate acquisition width is three. This is the smallest width
that preserves all three development cases: the development dry-run case needs
the third ranked candidate. The rule is identical for every case and budget;
case IDs, splits and gold ranges never enter indexing, ranking or compilation.
Held-out results remain reported separately. Because the labels are public,
this is a regression benchmark rather than proof of a hidden evaluation.

All three profiles produced the same selection because it fit within 2,000
tokens per case; larger profiles did not add lower-ranked source.

| Metric | Lexical v0 baseline | Hybrid H01 | Whole-file reference |
| --- | ---: | ---: | ---: |
| Complete evidence groups, all | 6/9 | 9/9 | 9/9 by construction |
| Complete evidence groups, development | 2/3 | 3/3 | 3/3 by construction |
| Complete evidence groups, held-out | 4/6 | 6/6 | 6/6 by construction |
| Held-out no-answer | 0/1 | 1/1 | 0/1 |
| Total rendered tokens | 6,047 | 6,047 | 15,094 |
| Raw source bytes exposed | 16,705 | 15,935 | 52,129 |

Hybrid H01 exposes 770 fewer raw source bytes than the baseline (4.61% less)
while recovering three additional complete evidence groups and the no-answer
case. Relative to whole-file input it exposes 36,194 fewer bytes (69.43% less)
and 9,047 fewer rendered tokens (59.94% less). This is context acquisition and
exposure evidence, not an end-to-end model correctness measurement.

The public corpus index cold build parses 3/3 files. An immediate unchanged
build reuses 3/3 derived records and parses 0. Synthetic lifecycle tests cover
one-file modification, addition, deletion, corrupt-index refusal and explicit
rebuild. Wall-clock timings are emitted by `bench:h01` but are not published as
stable performance claims because OS caching is uncontrolled.

The no-answer improvement comes from a general scope rule: when a query names a
source filename that is absent from the allowed inventory, retrieval returns
`EXPLICIT_SOURCE_NOT_IN_SCOPE` instead of lexical matches from other files. No
question text, case ID, gold line, or repository-specific symbol is hardcoded.

Limitations: the corpus contains three small public JavaScript modules and seven
queries. JavaScript/TypeScript outlining is lightweight syntax scanning rather
than a full parser. There is no automatic file watcher; each compile instead
reopens current source and refuses digest drift or deletion, while callers must
run an incremental build to acquire a new snapshot. No model or patch-generation
task was run. MCP/native Codex and OpenCode usage belongs to Phase 4 and is not
claimed here.

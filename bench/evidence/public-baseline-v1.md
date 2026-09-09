# Frozen public baseline v1

Status: **MEASURED RETRIEVAL BASELINE; QUALITY FAILURES RETAINED**.

The [portable raw report](public-baseline-v1-portable.json) is the canonical
reproduction evidence. The [first run](public-baseline-v1.json) is also retained
unchanged. After the first run, mixed CRLF/LF in the pre-existing lexical source
and CRLF in the npm lockfile were normalized to LF so exact implementation
fingerprints survive checkout. No logic, corpus, query or gold was changed.
All 21 case/profile capsules and non-timing metrics were compared for equality
between the two runs and matched. Implementation and npm lockfile byte hashes
appear in each report. Reproduce with `npm ci --ignore-scripts --no-audit --no-fund`, then
`npm run bench:frozen`. Timing will vary; sources, selections and token counts
should match with the recorded implementation and frozen inputs.

| Metric across seven cases | 2k tokens | 4k tokens | 8k tokens |
| --- | ---: | ---: | ---: |
| Evidence-group overlap recall | 9/9 | 9/9 | 9/9 |
| Complete evidence-group range recall | 6/9 | 6/9 | 6/9 |
| Selected fragment gold precision | 7/21 | 7/21 | 7/21 |
| Missing-source no-answer success | 0/1 | 0/1 | 0/1 |
| Total rendered tokens | 6047 | 6047 | 6047 |
| Counterfactual whole-file rendered tokens | 15094 | 15094 | 15094 |

The budgets apply **per case**, not to the seven-case total. Individual selected
contexts range from 235 to 1534 tokens. All selected windows already fit 2000
tokens, so increasing this corpus's budget changes nothing. Artificially large
Unicode inputs in the contract tests separately exercise actual budget refusal.

The missing-source negative retrieves caller branches even though the requested
internal decision implementation is absent. The dry-run and descendant-leaf
questions retrieve partial relevant evidence but miss complete annotated ranges.
The broad overlap recall must not be presented as complete answer support.

The whole-file column is a counterfactual input rendering using the same loaded
source, not a second IO trial or a model experiment. No output quality or model
gain was measured. Cold/warm cache behavior, incremental index cost, stale-task
harm, and verified model task outcomes remain explicitly unmeasured. The fixed
baseline has no derived cache, and all repeated requests scan full source files.

Independent gold review certifies the annotations and source identities only.
Full implementation acceptance belongs to the independent program verifier.

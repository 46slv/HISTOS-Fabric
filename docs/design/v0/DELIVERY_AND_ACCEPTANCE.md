# Delivery slices and acceptance

Status: **DRAFT PLAN / NO IMPLEMENTATION OR RUN AUTHORIZATION**  
Updated: 2026-09-06

## 1. Plan boundary

The existing [roadmap](../../ROADMAP.md) is the long-term capability map. The slices below refine it into shippable vertical increments. User approval of this design document is not proof that code, integrations, automatic capture or deployment already exist. Each implementation PR reports exact commit, focused tests and outstanding host gates.

Do not make the first usable tool wait for memory graphs, self-improvement or a complete cross-harness platform. Conversely, do not weaken provenance/access controls merely to make a demo look successful.

## 2. Dependency order and deliverables

| Slice | Depends on | Deliverable / finish line |
| --- | --- | --- |
| H0 — contracts and fixture freeze | None | Versioned wire subset, public synthetic corpus, reviewed gold, local packaging spike; choose/pin runtime, SQLite binding and tokenizer. |
| H1 — artifact/read boundary | H0 | Streaming capture, immutable refs, exact reopen, integrity/expiry tests, scoped authorization and idempotent publication. |
| H2 — first useful context compiler | H1 | Approved project snapshots, lexical + one structural provider, bounded compile/search/read/explain; no mandatory models/embeddings. |
| H3 — daily-use clients | H2 | Codex and OpenCode grade-A MCP on the same contract with EPHEMERA stopped; baseline-vs-assisted measurements and reversible setup. |
| H4 — evidence-linked memory | H3 | Narrow capture candidates, provenance dedupe, reviewed revision acceptance, scoped recall and Markdown export/import proposals. |
| H5 — compiled understanding and sleep | H4 | Dependency-aware cached views; fenced/coalesced maintenance with cost/resource budgets and crash-resume evidence. |
| H6 — EPHEMERA integration and Console | H3; H4/H5 only for memory features | Replace one context-discovery path, preserve Context Firewall, show receipts/budgets/deferred work in the existing Console lineage. |
| H7 — optional graph/document/semantic providers | H2 + benchmark evidence | Add each provider independently only when incremental value exceeds its measured maintenance/runtime cost. |
| H8 — automation candidates | H4 + external verifier owner | Repetition ledger, isolated shadow evidence, externally owned activation/rollback; no new Mission authority. |
| H9 — context-policy learning | H5/H7 + frozen holdout | Bounded tuning, untouched holdout, automatic regression rollback; never tune access rules. |

The first daily-use release is H0–H3. H6 may start from H3 without waiting for all memory functions. Each slice may land a smaller reviewable change without claiming the entire phase is complete.

## 3. H0/H1 concrete next implementation boundary

H0 should settle the exact renderer/tokenizer count contract; capture/result caps; SQLite/package feasibility on target Windows and Linux test environments; source snapshot strategy; supported first language; and reference authorization semantics. Pin actual versions when installed, rather than copying changing versions from this design.

H1 implements only registry/artifact primitives and their fixture tests. No model calls, auto-start, broad filesystem crawler, EPHEMERA canary, UI or external publication. Test crash points before/after object publication and DB commit, same-key retries, different-input conflicts, denied refs and corrupted payloads. Proposed schema files remain drafts until they align with implementation tests.

## 4. Benchmark protocol

Do not compare a lossy single truncation baseline against a multi-turn HISTOS system and call it an end-to-end improvement. Compare equivalent tasks, source snapshots, total acquisition budgets, model/harness versions and verification criteria. A baseline may page/search intelligently within the same budget.

Keep two experiments separate:

- **Retrieval-only:** no answer-generation model required; evaluate selected ranges/files against reviewed relevance labels and required-evidence groups.
- **End-to-end:** run the same worker/harness and native verifier; measure verified completion and total tokens, retries, elapsed time and human intervention.

Use a frozen pre-task snapshot. Do not leak post-fix code, hidden gold, annotation documents or benchmark explanations into the retrieval corpus. Historical final imports are only seed evidence, not ground truth by themselves. Related behavioral tests/docs can be relevant without being direct imports; latest-file distractors are not universally irrelevant.

The five EPHEMERA seed cases remain development cases until independent exact-base annotation review. They are too small for general product rankings. A public benchmark must not depend on access to a private repository; start with synthetic/publicly licensed fixtures and keep separately authorized private evaluation outside public exports.

Task families: exact symbol, trace/error to code, edit ripple, behavior/test contract, architecture orientation, long document section, stale working-tree context, memory contradiction, no-answer, and forbidden cross-scope lure. Initial languages should cover JavaScript/TypeScript and Markdown; Python/Lua/PowerShell remain explicit coverage tests or unsupported fallback until their providers are proven.

## 5. Metrics and reporting

Report counts and numerators/denominators, not just percentages. Required-evidence group recall is separate from incidental filename matches. A signature-only hit is not full recall when the task needs implementation behavior.

Track: required-evidence recall, selected-range precision, unsupported/incorrect claims, authorized no-answer behavior, exact source reopen, raw bytes exposed, rendered tokens, tool declarations, repeated calls/re-reads, compaction events, reader/reranker tokens, cold setup, warm latency, cache invalidation work and background cost.

For model experiments, use repeated paired trials and disclose variance. Do not present one run as proof of a stable improvement. Cost ledger:

```text
total = foreground acquisition + worker + verification/repair
        + ingestion/embedding/reader models + amortized maintenance
```

Include initial setup separately and disclose the amortization horizon. Token billing and cache discounts do not erase context exposure. Use model-visible payload measurement, not only API response text size. No absolute performance percentages or p95 latency guarantees are promised before measurements.

H2/H3 gate: hard scope/integrity checks all pass; exact evidence is recoverable; mandatory evidence is not lost compared with the equally budgeted baseline on the frozen development set; lower total context/acquisition cost is demonstrated on named representative tasks. If results regress, retain a working baseline route and classify HISTOS as experimental, rather than lowering labels to force a pass.

## 6. Runtime conformance cases

The machine-readable [case ledger](conformance-cases.json) is a test specification, not a test run. IDs are grouped by boundary:

- C01–C08: rendering, pagination, exact reopen and partial results.
- D01–D08: snapshot drift, concurrency, publication, invalidation and backup.
- S01–S08: scopes, provider egress, sandbox escape, injection and privacy.
- M01–M06: evidence identity, conflict, coalescing and automation.
- I01–I04: daily clients, disconnect, unsupported hooks and Console read models.

Release gates depend on the slice. Later memory cases do not block a correctly bounded read-only H3 release, but their capabilities remain disabled/unimplemented. No `NOT_RUN` case may be advertised as PASS because its schema is valid.

## 7. Operational fallback and rollout

Start per-project opt-in with no background inference. Provide one read-only adapter first, then both daily clients, then candidate capture, then separately enabled consolidation. Installation/upgrade must preserve settings and report diffs; no credential capture, proxy rewriting or model change is implied.

| Failure | Allowed response |
| --- | --- |
| HISTOS unavailable | Grade A: use existing native workflow with unchanged user/harness scope; grade C: stop or runner-mediated bounded fallback, never widen access. |
| Vector/model provider unavailable | Local lexical/structural mode with missing capability shown; no silent remote replacement. |
| Snapshot moves | New snapshot/recompile or explicit stale error; no different bytes under an old ref. |
| Disk full / capture fails | Reject/defer capture, preserve existing evidence, signal no exact replay guarantee for uncaptured output. |
| Maintenance over quota | Defer/coalesce; foreground retrieval may continue if its guarantees hold. |
| Invalid policy/registry integrity | Refuse affected operations; operator recovery, not guessed permissions. |

## 8. Existing Console, not a second authority

Expose read models for scopes/index health, one current capsule, source/derived provenance, memory conflicts, candidate evidence, deferred jobs and foreground/background costs. Start with list/detail views. Graph visualization is later optional, bounded to a selected neighborhood; never load the full memory graph into UI or model by default.

Every control action identifies the data/authority owner, expected revision and receipt. Approval buttons call authorized owner APIs; the UI cannot synthesize approval from a local toggle. Direct HISTOS CLI/MCP remains usable without the Console.

## 9. Open decisions with closure points

| Decision | Resolve by | Safe default until resolved |
| --- | --- | --- |
| Runtime/SQLite binding, packaging | H0 packaging spike | TypeScript service proposal only; no preselected installed dependency. |
| Tokenizer/renderer per client | H0 then H3 probes | Byte limits + honest estimate, no exact whole-window guarantee. |
| First parser and supported languages | H2 benchmark | Lexical + explicit unsupported/incomplete coverage. |
| Codex/OpenCode pre-delivery hooks | Separate H3 grade-B probe | Grade A only. |
| Retention durations / quotas | H1 owner configuration | Conservative explicit caps; no indefinite raw capture or automatic purge. |
| Remote/cloud clients | After local auth/recovery evidence | Disabled; local service only. |
| Live two-way Obsidian editing | H4 import conflict tests | Export + staged proposals. |
| Graph/vector vendor | H7 incremental-value test | No mandatory backend. |

No additional product naming, scheduler hierarchy or microservice is required to begin H0–H3.

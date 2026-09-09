# HISTOS autonomous continuation plan

Status: **PREFLIGHT_REQUIRED**  
Goal ID: `HISTOS-V1-OPERATIONAL-LOOP`  
Coordinator: **Luna Max**  
Starting implementation lineage: `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30`

## 1. Outcome

Advance the existing HISTOS implementation candidates into one coherent, locally usable shared Context/Memory substrate that ordinary Codex and OpenCode can use without an active EPHEMERA Mission, while preserving provider-neutrality, exact provenance, bounded context, narrow writes, recovery, and EPHEMERA's external Mission authority.

The run is intentionally broader than one component repair. It may continue through all READY tasks below until `PROGRAM_DONE`, a true stop condition, or execution budget/context exhaustion with a durable checkpoint.

### FIRST_USABLE user flow

`FIRST_USABLE: PASS` requires the **same accepted candidate lineage** to prove:

1. start/restart one owned local HISTOS profile/service;
2. Codex and OpenCode independently connect through the supported read-only path;
3. both can `search -> compile -> exact reopen -> explain` against the same source snapshot with scope refusal outside the allowlist;
4. both can recall one evidence-linked HISTOS memory under the same project scope without treating it as current truth;
5. service/client restart preserves committed HISTOS state and stale source is refused until explicit refresh/new snapshot;
6. no global/user harness configuration is required for the proof unless the operator explicitly chooses it; setup is reversible;
7. repository-wide tests for all present suites pass on the actual execution host.

A component test or prior native observation alone does not establish this new end-to-end PASS.

### PROGRAM_DONE user flow

`PROGRAM_DONE` additionally requires:

- provider-capable Evidence Event -> memory/distillation path, with native H03 as the baseline provider;
- a read-only Kura provider comparison against the native/baseline path under frozen scopes/budgets;
- one standards-compliant procedural projection proven in both Codex and OpenCode with update/uninstall ownership;
- bounded provider distillation feeding H03-style acceptance rather than bypassing provenance/authority;
- friction-trigger replay evaluated against known useful/non-useful sessions, including a smooth-positive path so friction is not the only capture signal;
- A00/A01 consume the new telemetry only through their existing non-authoritative/held-out gates;
- one fresh EPHEMERA-System compatibility/integration proof through contracts, without moving Mission authority into HISTOS;
- recovery/security regression for the newly integrated surfaces;
- fresh independent verification of the final candidate and a ready-to-review delivery branch/PR.

Merge, release, protected-branch changes, public publication, extra paid-provider use, or credential changes are not silently added to `PROGRAM_DONE` unless current repo/user authority explicitly includes them.

## 2. Invariants

These cannot be weakened to manufacture PASS:

1. current live source/runtime/System truth outranks remembered or compiled material;
2. retrieval/model restatement is not independent evidence;
3. `authority: none` / `current_truth: false` remains structural for HISTOS memories, compiled understanding, relationship results, operation candidates and policy experiments where their current contracts require it;
4. exact evidence/source can be reopened and identity-checked;
5. scope and provider-egress policy are enforced before retrieval/provider use, not only after rendering;
6. large stores/graphs are selection surfaces, not default prompt payloads;
7. native H01/H02/H03/H04 candidates are the parity/benchmark floor, not disposable prototypes;
8. H04 remains the bounded maintenance/recovery control; model-assisted distillation does not become an unbounded sleep loop;
9. A00 has no `ACTIVE` authority; A01 does not install policy by itself;
10. EPHEMERA-System remains Mission/Goal/Task transition and consequential-action authority;
11. a standardized Agent Skill is a projection of a verified procedure, not a permission grant or canonical memory store;
12. worker self-report never substitutes for tests/readback/runtime evidence.

## 3. Task graph

### R0 — execution preflight and candidate reconciliation

**depends_on:** none  
**owner:** Luna Max Coordinator  
**write_scope:** execution branch/state only until candidate identity is fixed.

Actions/outcome:

- verify local checkout, current remote refs, dirty worktrees and ownership;
- verify the actual Coordinator runtime/model is Luna Max from runtime/session metadata; do not trust role text/self-identification;
- inventory all `*.test.mjs` on the chosen candidate and run/review the PR #3 aggregate-test repair. Incorporate the one-file change only if the full host run and structural coverage pass;
- fresh-read PR #4 research synthesis and classify every proposed change as `NEW CAPABILITY`, `PROVIDER/ADAPTER`, `HARDENING`, or `BENCHMARK`; do not duplicate existing H01-H06/A00/A01 code;
- establish one integration branch/worktree and record exact base SHA in `STATE.json`.

**done_when/evidence:** actual Luna Max identity proven; exact base/candidate chosen; full current test command defined; no unresolved branch/writer collision.  
**on_fail:** isolate branch/worktree conflicts; if Luna Max routing cannot be proven, continue only as one verified Luna Max root if possible. Do not silently substitute another coordinator model.

### R1 — native baseline qualification

**depends_on:** R0  
**owner:** fresh Luna Max Worker + independent Verifier  
**scope:** existing H01/H02/H03/H04/H06/A00/A01; fixes may touch only the failing bounded owner surface and tests.

- run all repository tests on the host;
- run frozen/public H01 benchmark and record exact candidate, tokenizer, source identities and results;
- requalify H02 one-daemon/two-client Codex/OpenCode read path, all four tools, scope refusal, source drift/refresh and controlled restart;
- prove one H03 candidate/verified-memory recall path with current-truth separation and one H04 bounded queue/recovery path;
- record baseline latency/context/bytes where contracts already support them.

**done_when:** no unexplained test failure; baseline evidence packet exists and is sufficient for later provider comparisons.  
**on_fail:** repair the smallest owner component and re-run focused + repository regression; do not redesign provider architecture before the native floor is green.

### R2 — first-class Evidence Event boundary

**depends_on:** R1  
**owner:** Luna Max Worker; fresh Verifier  
**scope:** new event contract/normalizers plus bounded adapters to H03/H04/A00 telemetry.

Implement a provider-neutral event envelope for useful harness observations such as user correction, verifier result, deterministic test result, tool failure/retry, denial, successful procedure and repeated operation. Bind producer/origin, scope, source snapshot, exact artifact refs, event identity/replay identity, outcome and routing features.

Requirements:

- duplicate/replayed source events do not create independent evidence;
- friction/recall counts are routing/utility features only;
- raw transcript storage is not the default contract;
- a smooth successful discovery can still be selected without friction;
- no event body can mint `verified`, authority, permission or current truth;
- events can feed H03/H04/A00 without creating a second evidence authority.

**done_when:** schema/module + positive/negative/replay/lineage/scope tests; one synthetic Codex and OpenCode event path reaches the same normalized contract.

### R3 — provider interfaces over existing candidates

**depends_on:** R1, R2  
**owner:** Luna Max Worker  
**scope:** provider registry/contracts/adapters; preserve existing public H01/H03 interfaces or provide explicit compatibility layer.

Define minimal capability boundaries for `RetrievalProvider`, `MemoryProvider`, `DistillationProvider`, and `ProjectionProvider`. Treat native H01/H03 as provider candidate zero. Provider admission must expose capability/version/privacy/grounding metadata and fail closed on unsupported operations.

**done_when:** native behavior passes unchanged through provider boundary; no Mission authority moves; no required Kura dependency yet.

### R4 — read-only Kura provider bake-off

**depends_on:** R3  
**owner:** Luna Max Research/Implementation Worker; independent benchmark Verifier  
**scope:** isolated Kura adapter/store and benchmark fixtures only. No direct model write tool.

- pin and record the exact upstream Kura commit/version actually used;
- expose Kura recall as an alternate `MemoryProvider` read path;
- mechanically enforce read-only at call boundary, not only tool discovery;
- bind store/scope explicitly and preserve source/grounding descent available from Kura;
- compare Kura, native H03/file/lexical baseline on the same reviewed cases/budgets: recall, false recall/abstention, evidence descent, context bytes/tokens, latency, restart, stale/echo behavior.

**done_when:** machine-readable comparative report with equal task/scope budget and explicit limitations.  
**on_fail:** Kura remains `BENCHMARK_TARGET`; native provider continues. Do not block unrelated projection/event work.

### R5 — portable Agent Skill projection

**depends_on:** R3  
**owner:** Luna Max Worker  
**scope:** one non-destructive reviewed procedure, isolated/project-local Codex/OpenCode Skill destinations, projection manifest.

- use one accepted/synthetic-reviewed procedural revision; do not derive it from unverified memory;
- render one standards-compliant core `SKILL.md` package with focused references/scripts only as needed;
- target adapters may add harness-specific metadata/path handling without changing the core procedure;
- prove positive and negative activation behavior in Codex and OpenCode;
- measure startup/discovery overhead and loaded context;
- prove drift detection, update and uninstall remove only managed files.

**done_when:** same core procedural body works in both clients; installation/update/uninstall receipts and trigger/non-trigger evidence exist.

### R6 — bounded provider distillation into H03 semantics

**depends_on:** R2, R3, R4  
**owner:** Luna Max Worker + fresh Verifier  
**scope:** DistillationProvider adapter + H04 scheduling seam + H03 acceptance adapter.

Use Kura as the first model-assisted distillation experiment only if the read-only qualification is healthy. H04 owns queue/coalescing/retry/budgets. The provider returns candidates/grounding receipts; H03-style host trust/claim binding decides admissibility. Provider confidence or memory-store presence never equals verification.

Test quote/evidence survival, store-echo contamination, duplicate lineage, unsupported numbers/claims where applicable, provider failure, rate limit/cost exhaustion, restart and stale input.

**done_when:** at least one grounded candidate is accepted through the native trust boundary and negative/echo cases are rejected without bypass.

### R7 — friction/capture-selection replay

**depends_on:** R2  
**owner:** Luna Max Research Worker  
**write_scope:** benchmark/replay fixtures and policy experiment only.

Replay authorized session/event traces with independently labeled reusable outcomes. Compare: distill-all, friction-only, friction+verification/correction, and a channel that catches smooth high-value discoveries. Measure trigger precision/recall, avoided work, missed useful events and downstream candidate quality/cost.

**done_when:** held-out report establishes whether friction should be a default routing feature; no epistemic weight is assigned from frequency alone.

### R8 — integrate signals with A00/A01

**depends_on:** R2, R7; R4/R6 if provider signals are used  
**owner:** Luna Max Worker  
**scope:** existing A00/A01 public contracts/tests.

- Evidence Events may populate operation observations only after identity/scope checks;
- projection candidates may use A00 `VERIFIED` as one prerequisite but still require external activation;
- retrieval/provider utility features enter A01 only as bounded candidate parameters/cases inside the existing fixed safety/provenance envelope and held-out rollback gate.

**done_when:** no new uncontrolled self-improvement engine; regression candidate rolls back to baseline in tests.

### R9 — EPHEMERA compatibility/integration

**depends_on:** FIRST_USABLE, R2, R3  
**owner:** Luna Max Coordinator + bounded integration Worker  
**scope:** fresh-read current EPHEMERA-System/HISTOS adapters only.

Fresh-check EPHEMERA-System current canonical/accepted state before any integration. Do not assume it is finished from chat history. Prefer attaching HISTOS through existing provider-neutral/context/evidence seams. Prove one role-scoped Context request/result and one evidence/event return without moving Mission transition authority into HISTOS. Add Console read models only if the current Console contract has a clear compatible seam; UI is not required to validate the core substrate.

**done_when:** fresh System/HISTOS contract proof and no duplicated Mission/evidence authority.  
**on_fail:** record exact compatibility blocker; HISTOS standalone program may still be FIRST_USABLE.

### R10 — recovery/security/long-run hardening

**depends_on:** R2-R9 applicable completed surfaces  
**owner:** parallel Luna Max Workers only for independent surfaces; independent Verifier  
**scope:** tests/guards/recovery docs and the specific failing component.

Cover service crash/restart, source drift, corrupt indices/artifacts, provider unavailable, duplicate/replayed events, Kura read/write isolation, projection drift, H04 retry/defer, scope/secret/path escapes, stale policy and backup/restore behavior that is actually in scope. Promote repeated prose failures into tests/validators/scripts.

### R11 — final acceptance and delivery

**depends_on:** all required program tasks  
**owner:** Luna Max Coordinator + fresh independent Verifier  

- execute complete regression and named user flows on the exact final candidate;
- compare final state against baseline and invariants;
- ensure docs/status distinguish implementation candidate, accepted behavior and remaining external gates;
- update `STATE.json`, create/update a bounded Draft PR, and leave compact evidence/readback links;
- run the Learning Gate: reusable findings must be in owner docs or mechanical guards; otherwise record `NO_REUSABLE_DELTA`.

`PROGRAM_DONE` is permitted only when all required items are evidence-backed. Otherwise checkpoint with exact remaining blocker and READY task.

## 4. Dependency summary

```text
R0 -> R1 -> R2 -> R3 -> R4 -> R6 ----┐
                 |      |             |
                 |      +-> R5        +-> R8
                 +-> R7 --------------+
R1 first usable evidence -------------+-> R9
R2-R9 -------------------------------> R10 -> R11
```

R4, R5 and R7 may run in parallel after their dependencies and isolated worktrees are established. R9 should not consume unfinished provider experiments unless the integration task explicitly needs them.

## 5. Required reporting

At final return or checkpoint, report at minimum:

```text
PROGRAM_STATUS
FIRST_USABLE
FINAL_CANDIDATE / HEAD
COORDINATOR_MODEL_PROOF
COMPLETED_TASKS
USER_FLOW evidence
TEST / BENCH / HOST evidence
INVARIANTS
BLOCKERS (local vs program-wide)
READY_NEXT
UNMERGED / EXTERNAL_AUTHORITY actions
LEARNING_GATE
```

# HISTOS × Codex live canary plan

Plan ID: `HISTOS_CODEX_LIVE_CANARY_20260909`  
Goal ID: `HISTOS-CODEX-DAILY-CAPTURE-V11`  
Status: **READY_FOR_PREFLIGHT**

## Goal

Prove and, where necessary, minimally complete the real daily-use path:

```text
ordinary Codex task
  -> HISTOS context use
  -> observable usage
  -> bounded Evidence Event capture
  -> durable restart-safe record
  -> new Codex session readback/recall
  -> compact doctor proof
```

The run must use one explicitly supplied ChatGPT conversation as a runtime-only Supervisor/continuation surface through the current Codex/ChatGPT browser or Web Bridge capability. The target must never be copied into tracked project files.

## Why this is a new gate

V1 proved the component and bounded native user-flow contracts. This V1.1 canary asks a different question: if the user simply runs Codex on a normal task with HISTOS enabled, can we later prove what HISTOS saw, what was persisted, what can be recovered after restart, and whether a fresh Codex session can reuse the result without raw transcript capture?

## Acceptance user flow

A run is `PROGRAM_DONE` only when all criteria below are independently verified on one exact candidate SHA.

1. **Fresh live baseline** — current local/remote HISTOS main, Node/Codex versions, relevant repo instructions and runtime capabilities are read back. The Coordinator model is proven as Luna Max from runtime/session metadata.
2. **Real Codex + HISTOS** — a fresh Codex session performs a bounded useful task with HISTOS configured per invocation and demonstrably calls the shared HISTOS service. Search/compile/read/explain and a refusal or stale-path gate are exercised where applicable.
3. **Exact ChatGPT continuation** — Codex opens/uses the runtime-supplied exact ChatGPT conversation through the current browser/Web Bridge path, proves conversation identity, sends only compact non-secret task status/evidence, and receives a correlated continuation or verification response. No fallback to another conversation.
4. **Usage observation** — H02 telemetry proves the Codex client used HISTOS, with operation/outcome/hashes/bytes but no query/source transcript.
5. **Evidence capture** — relevant Codex tool/test/checkpoint observations are normalized as HISTOS Evidence Events with producer=`codex`, exact scope/snapshot/lineage and no raw transcript/secret/control fields.
6. **Durable persistence** — Evidence Events needed for the canary survive service/process restart in a host-owned durable store. If current main has only in-memory journaling, implement the smallest append-only/idempotent persistence seam and tests rather than claiming persistence from telemetry.
7. **Daily capture path** — ordinary Codex use has a supported launcher/adapter/hook that performs capture automatically. If the host exposes no reliable native hook, provide an explicit wrapper/launcher and document that boundary; do not scrape hidden/private transcripts.
8. **Doctor/readback** — one operator command or equivalent deterministic report distinguishes at least `USED`, `OBSERVED`, `PERSISTED`, `RECALLABLE`, `GROUNDED`, plus gaps/refusals. It binds each claim to exact event/receipt/source identities.
9. **Restart/new-session proof** — stop/restart the owned HISTOS service/store, then start a fresh Codex session and prove the canary record is still discoverable or recallable by the supported interface. Do not reuse the original model context as proof.
10. **Authority/privacy** — all HISTOS-derived memory/event outputs remain `authority=none` / `current_truth=false` unless exact source truth is separately referenced. No credential, cookie, raw ChatGPT transcript, raw Codex transcript, local private path or browser/session identifier enters Git.
11. **Regression/independent acceptance** — repository tests, focused new tests, `git diff --check`, secret/publication scan and a fresh independent verifier all pass on the final candidate. A reviewable remote branch/PR exists. Main merge is not part of this run.

`FIRST_USABLE` is reached after criteria 1–8 pass in one live run. The Coordinator must continue through restart/new-session and final independent acceptance instead of stopping at FIRST_USABLE.

## Task graph

### R0 — live preflight and exact bindings

- Fresh-read repo instructions, README, H02/H03/Evidence Event contracts/tests and current runtime.
- Prove Luna Max Coordinator metadata.
- Verify the runtime-supplied ChatGPT target exactly; keep it out of tracked files.
- Determine the currently supported Codex browser/Web Bridge route by live probe, not assumption.
- Freeze exact source branch/worktree and canary scope.

Done: exact identities, runtime route and non-secret canary workspace are recorded in run evidence.

### R1 — native baseline without new implementation

Run one bounded Codex task using current HISTOS as-is. Collect H02 telemetry and current Evidence Event/H03 evidence. Determine exactly which acceptance criteria already pass.

Done: capability matrix uses `PASS / GAP / NOT_APPLICABLE` with evidence; no feature is implemented before the gap is observed.

### R2 — capture/persistence gap closure

For each real gap found in R1, implement the smallest repository-owned solution. Expected likely work, only if proven missing:

- durable append-only Evidence Event store with replay/id conflict refusal, atomic publication/recovery and bounded retention semantics;
- capture ingest CLI/API/adapter that accepts normalized bounded events, not transcripts;
- Codex run wrapper or supported hook adapter that emits tool/test/checkpoint Evidence Events automatically;
- exact scope/snapshot/watermark handling.

Do not create a second Mission state machine or replace H03/H04 authority semantics.

### R3 — doctor/readback

Implement a deterministic operator-facing health/readback surface that can answer:

```text
USED?       H02 telemetry proves HISTOS was called
OBSERVED?   normalized Evidence Event exists
PERSISTED?  durable store readback after process boundary
RECALLABLE? supported fresh-session retrieval/readback can find it
GROUNDED?   surviving exact source/evidence refs descend from the record
GAPS?       missing stage / stale scope / refusal / replay conflict
```

The doctor must not turn missing evidence into success and must not infer memory from telemetry alone.

### R4 — exact ChatGPT browser/Supervisor canary

Use the exact runtime-only ChatGPT target supplied at launch. Codex may send compact canary status/questions to that conversation and use the response as Supervisor guidance/verification input.

Required checks:

- exact conversation ID/URL correlation;
- no cross-chat fallback;
- no ambiguous auto-resend;
- no secrets/private paths/transcripts in outbound message;
- one bounded marker such as `HISTOS-CODEX-CANARY-001` correlated to the run evidence.

### R5 — FIRST_USABLE live pass

Run an ordinary bounded Codex task end-to-end with capture enabled. Doctor must show criteria 2–8 as PASS from real evidence. Use fresh verifier review before declaring FIRST_USABLE.

### R6 — restart and fresh Codex session

- Controlled stop/restart of owned HISTOS runtime/store.
- Fresh Codex session, no prior model context.
- Re-open/readback the canary lineage using supported HISTOS interfaces.
- Prove replay/dedup/idempotency behavior.

### R7 — failure/privacy hardening

Probe at least: duplicate/replay, stale snapshot, out-of-scope path, malformed event, secret-shaped payload, transcript-shaped payload, corrupt/truncated durable record, concurrent ingest or crash boundary appropriate to the chosen store.

### R8 — full regression and publication scan

Run focused tests + full `npm test`, aggregate test inventory, `git diff --check`, and scan changed files for secrets/private absolute paths/runtime identifiers/temp evidence leakage. Fix any candidate-identity-changing defect and requalify affected evidence.

### R9 — remote independent acceptance

Push only to a non-protected branch, update/create the review PR, read back exact remote SHA/tree, and run a fresh independent verifier against that remote identity. Stop with `READY_FOR_MAIN_MERGE=true` only if all acceptance criteria pass.

## Invariants

- ChatGPT target URL/ID is runtime configuration and must not be committed.
- User explicitly authorizes task-related use of the supplied exact ChatGPT conversation for this canary; no other conversation is authorized.
- No raw ChatGPT/Codex/OpenCode transcript capture.
- No cookie/token/credential capture or publication.
- Prefer per-invocation Codex/HISTOS configuration; do not silently mutate global Codex configuration. Any necessary temporary host change must be bounded, read back and restored.
- HISTOS is not Mission/Goal/Task authority. EPHEMERA integration is not required to pass this Codex-focused canary and must not be used to hide a HISTOS capture gap.
- Kura is out of scope for the primary pass; do not use Kura as proof that HISTOS persistence works. A later parallel-provider canary may reuse the durable Evidence Event seam.
- No force-push, protected/main merge, release/tag/package publication, credential/permission change or destructive cleanup.
- Ordinary failures are repairable work, not stop conditions. Do not repeat an identical failure fingerprint without changing evidence or approach.

## Final report

```text
PROGRAM_STATUS
FIRST_USABLE
FINAL_CANDIDATE
COORDINATOR_MODEL_PROOF
CODEX_RUNTIME
CHATGPT_TARGET_PROOF
BASELINE_MATRIX
LIVE_CODEX_TASK
H02_USAGE
EVIDENCE_CAPTURE
DURABLE_PERSISTENCE
DOCTOR
RESTART_NEW_SESSION
AUTHORITY_PRIVACY
REGRESSION
SECRET_SCAN
REMOTE_ACCEPTANCE
BLOCKERS
READY_FOR_MAIN_MERGE
UNMERGED_OR_EXTERNAL_ACTIONS
LEARNING_GATE
```

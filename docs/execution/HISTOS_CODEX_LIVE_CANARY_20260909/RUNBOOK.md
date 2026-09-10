# HISTOS × Codex live canary runbook

Status: **ACTIVE EXECUTION CONTRACT**

## Coordinator topology

Use a verified Luna Max root Coordinator for the full run. Prefer one shared integration writer and fresh bounded Workers/Verifiers. Parallelize only independent read/probe/test work with separate worktrees/profile roots/state roots.

The Coordinator owns:

- exact candidate/ref identity;
- task dependency/state transitions in `STATE.json`;
- conflict resolution and integration;
- evidence sufficiency;
- context rollover/checkpointing;
- final acceptance decision.

Workers do bounded tasks and return compact Evidence Packets. A Worker self-report never closes a gate by itself.

## Opening protocol

1. Fresh-read this README/PLAN/RUNBOOK/STATE from the current execution branch.
2. Fresh-read current local/remote `main`, repo instructions, README, package tests, H02/H03/Evidence Event code/contracts.
3. Prove actual Coordinator model/runtime metadata is Luna Max; prompt text/self-identification is not proof.
4. Verify current Codex runtime and available browser/ChatGPT Web Bridge capability by live probe.
5. Bind the runtime-only exact ChatGPT conversation supplied by the launch prompt. Never write the URL/ID into repo state, commits, receipts intended for publication, or source logs.
6. Use a run-scoped canary workspace/profile/store. Do not reset or clean unrelated/dirty worktrees.
7. Update `STATE.json` only after evidence-backed task transitions.

## ChatGPT conversation rule

The user has explicitly authorized this canary to use one exact ChatGPT conversation supplied at runtime. Use that exact target only.

If the current environment exposes the Dev Exec/ChatGPT Web Bridge, prefer exact task-bound routing and correlation. If Codex instead exposes a direct internal browser surface, prove the final loaded conversation identity before sending. Do not silently switch mechanisms when delivery identity becomes ambiguous.

Outbound ChatGPT messages must be compact and may contain only:

- canary marker/run ID;
- public/non-secret repo/ref identities when necessary;
- PASS/FAIL/gap summary;
- bounded question or requested verification;
- hashes/receipt IDs safe for publication.

Never send credentials, cookies, local absolute paths, machine fingerprints, raw source bodies that are not needed, raw transcripts or unrelated user data.

Ambiguous delivery is not success. Do not auto-resend until durable correlation state proves the first attempt was not delivered.

## Codex/HISTOS daily-use rule

The canary must resemble ordinary Codex use rather than a test that directly calls every HISTOS function by hand.

Preferred structure:

1. start Codex with per-invocation HISTOS configuration;
2. give it one bounded useful repo/canary task;
3. allow normal reasoning/tool use;
4. observe whether HISTOS is selected and used;
5. capture only structured tool/test/checkpoint evidence through supported seams;
6. independently read H02 telemetry/event store/doctor after the task.

If automatic capture cannot be achieved from a reliable supported host seam, implement an explicit launcher/wrapper. Label it honestly; do not claim transparent global capture.

## Evidence Packet

Every completed task should leave a compact packet with as applicable:

```text
task_id
candidate_sha/tree
runtime versions
scope_id/snapshot digest
commands/tests + exit status
H02 telemetry refs/counts
Evidence Event ids/hashes
store/doctor receipt hash
ChatGPT delivery/correlation result with target redacted
privacy/authority assertions
known gaps
next task
```

Private host details may remain in a run-local evidence root but must be redacted from tracked/public artifacts.

## Implementation policy

Observe before mutating. R1 must establish the actual gap matrix before R2 adds code.

When implementation is required:

- use current H03/H04/A00 authority boundaries rather than duplicate state machines;
- keep event persistence host-owned, bounded and recovery-oriented;
- store structured events/refs, not transcripts;
- make ingest idempotent and conflict-visible;
- fail closed on stale scope, forged hash, secret/transcript payload and corrupt durable bytes;
- prefer deterministic local code before model-dependent maintenance;
- add focused tests for each discovered failure class;
- run full regression before acceptance.

## Recovery

Ordinary failures should be repaired and retried with changed evidence/approach. Typical recoverable cases:

- HISTOS service not installed/running;
- stale source snapshot;
- missing capture adapter;
- browser bridge not bound yet;
- event-store crash/corrupt-tail handling defect;
- duplicate/replay conflict;
- test or publication-scan failure;
- branch divergence or stale remote ref.

Do not repeat the same failure fingerprint unchanged.

Stop/checkpoint only when:

- the exact authorized ChatGPT conversation cannot be accessed without user login/approval;
- required host permission/credential action is genuinely outside current authority;
- a destructive/irreversible action is the only remaining route;
- protected/main merge is the only remaining action;
- execution budget/time is exhausted after leaving a deterministic resumable checkpoint.

## Context rollover

If Coordinator context becomes large, checkpoint `STATE.json`, exact branch SHA/tree, evidence refs and `ready_next`, then start a fresh Luna Max Coordinator. Do not rely on prior model context as the durable state.

## Acceptance discipline

`FIRST_USABLE` requires a real live Codex run through doctor criterion 8. Continue after FIRST_USABLE.

`PROGRAM_DONE` additionally requires controlled restart, fresh Codex session, failure/privacy hardening, full regression, secret scan and fresh remote independent verification.

The final verifier should inspect raw code/tests/receipts first, before reading the Coordinator's conclusion where practical.

## Authority

Authorized without further confirmation for this run:

- read/write in the run branch/worktrees;
- non-protected branch push;
- Draft/Ready PR creation/update;
- run-scoped local profile/store/process lifecycle;
- per-invocation Codex/HISTOS config;
- task-related messages to the exact runtime-supplied ChatGPT conversation;
- tests, local read-only runtime probes, browser navigation needed for that target;
- reversible implementation needed to satisfy PLAN.

Not authorized:

- force-push;
- protected/main merge;
- release/tag/package publication;
- paid-provider enablement or new charges;
- credential/permission changes;
- destructive cleanup of unrelated/previous evidence;
- messages to any other ChatGPT conversation or external recipient.

## Final status format

Use exactly the fields listed at the end of `PLAN.md`. `PROGRAM_DONE` means the implementation candidate is complete and remotely accepted; it does not mean `main` was merged.

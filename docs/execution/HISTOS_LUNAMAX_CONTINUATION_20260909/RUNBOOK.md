# HISTOS Luna Max orchestration runbook

Status: **EXECUTION CONTRACT / PREFLIGHT_REQUIRED**

## 1. Coordinator topology

The root execution role is **Luna Max Coordinator**. Its job is not to personally perform every edit. It owns Goal/queue continuity, task readiness, writer ownership, integration, evidence quality, recovery and final acceptance.

Before mutation, prove the actual root runtime/model from authoritative session/runtime metadata or a bounded routing probe. Model name in a prompt, role file or self-report is not proof. If Luna Max child routing cannot be proven, keep the verified Luna Max root and execute sequentially rather than silently delegating to another model.

Default roles:

| Role | Default | Responsibility |
| --- | --- | --- |
| Coordinator | Luna Max | select READY task, freeze work package, own `STATE.json`, integrate, adjudicate blockers, final acceptance |
| Worker | fresh Luna Max context by default | implement/research one bounded task and return candidate + compact Evidence Packet |
| Verifier | fresh independent Luna Max context and/or deterministic runner | verify exact candidate against acceptance; never fix the candidate while acting as verifier |
| Deterministic runner | tests/bench/validators/host readback | mechanical facts outrank model assertions |

Other validated workers/tools may be used only where they materially help and preserve the task's cost/privacy/capability requirements. Do not make a stronger/different model the sticky Coordinator without explicit authority.

## 2. Work-package contract

Coordinator -> Worker:

```text
TASK_ID / outcome
exact candidate/base
owned write scope / worktree
necessary references only
invariants + non-goals
acceptance / verifier entrypoint
known blocker/failure fingerprint if any
stop/escalation condition
return Evidence Packet schema
```

Do not forward the entire Coordinator conversation, raw research transcript or all project docs. Workers first read the local owner contract named in PLAN.

Worker -> Coordinator Evidence Packet:

```text
TASK_ID
BASE / HEAD / worktree
CHANGED_SURFACE
OBSERVED_BEHAVIOR
TESTS / BENCH / HOST evidence
SOURCE / PROVIDER identities when relevant
INVARIANTS checked
OUT_OF_SCOPE gaps
BLOCKER + failure fingerprint + attempt count
LEARNING_DELTA
```

Self-report without deterministic/runtime evidence is insufficient for acceptance.

## 3. Parallelism and writer ownership

Start with one Worker. Raise parallelism only for genuinely independent READY tasks. Maximum recommended concurrent write Workers for this plan is **3**, each in a separate worktree/branch or disjoint proven write surface.

Never let two Workers mutate the same state file, package manifest, shared provider registry, benchmark gold, service profile, external store or client configuration concurrently. The Coordinator is the only `STATE.json` writer and the only integration-branch writer.

Useful parallel window after R3:

- R4 Kura provider bake-off;
- R5 Agent Skill projection;
- R7 friction replay.

They must use separate fixtures/state roots and must not share mutable client/profile configuration.

## 4. Read/write authority

Normal autonomous scope:

- read the complete HISTOS repo and relevant current upstream primary sources;
- create isolated worktrees/branches;
- edit HISTOS implementation/tests/docs within the selected task;
- create scratch fixtures and local isolated profiles/stores;
- run repository tests, benchmark tools and reversible local host probes;
- configure **process-local or project-local** Codex/OpenCode integration for validation when supported;
- commit/checkpoint/push to an authorized feature/execution branch and create/update Draft PRs;
- refine task order when new evidence changes dependencies but Goal/invariants remain unchanged.

Requires separate explicit/standing authority and must not be inferred from this runbook:

- protected/main merge if not already authorized;
- release/deploy/publication beyond normal feature-branch push/PR;
- deleting user data or unrelated branches/worktrees;
- modifying user/global Codex/OpenCode config when process/project-local proof suffices;
- paid-provider use not already authorized;
- credential creation/rotation/export;
- sending external messages, publishing packages, or making consequential external side effects;
- weakening EPHEMERA Mission authority or HISTOS provenance/scope gates.

## 5. Failure/recovery rules

A task failure is not automatically a program stop.

| Failure | Autonomous recovery | Stop/wait condition |
| --- | --- | --- |
| test/build fail | localize, focused fix, focused test, full relevant regression | requires invariant/Goal relaxation or unrelated destructive change |
| same failure fingerprint | one retry only if hypothesis/evidence changes; then Coordinator changes approach/fresh Worker | no new evidence after changed diagnostic path and bounded budget exhausted |
| dirty/parallel tree | preserve unrelated changes, move to isolated worktree, compare exact refs | ownership/candidate cannot be established without destructive reset/stash |
| remote advanced | fresh fetch/compare, rebase/cherry-pick only when causal surface is understood; rerun impacted evidence | competing authority/accepted lineage cannot be reconciled safely |
| provider unavailable | preserve native baseline; continue independent R5/R7/etc.; mark provider task waiting | required PROGRAM_DONE provider proof cannot be obtained |
| Kura recall/distill regression | retain report, native H03 remains baseline, repair adapter if within scope | would require weakening H03 trust/authority or unsupported upstream mutation |
| Codex/OpenCode integration fail | verify current binaries/config docs, use bounded process-local probe, inspect stderr/transport | host capability/authorization genuinely absent; do not claim FIRST_USABLE |
| EPHEMERA integration unavailable | finish standalone HISTOS tasks; fresh-check System later | only R9 waits; FIRST_USABLE can remain independent |
| context/session ends | commit/checkpoint, update `STATE.json`, start a fresh Luna Max Coordinator and resume from READY task | no redispatch path: leave exact durable handoff, do not claim running |
| quota/privacy/cost | use already authorized local/native path, reduce experiment, checkpoint | would require unapproved paid/cloud data path |
| ambiguous external side effect | read back exact state/receipt before retry | cannot establish outcome; never blindly replay |

The Coordinator may split or reorder tasks but may not downgrade a required acceptance item to optional to obtain PASS.

## 6. Verification policy

For every nontrivial code change:

1. Worker runs focused tests and records exact result.
2. Coordinator inspects diff and acceptance mapping.
3. Fresh Verifier reads exact candidate and runs/rechecks relevant tests/host behavior.
4. A shared-contract change runs repository-wide regression.
5. Version-sensitive client/provider claims are rechecked against current primary docs/runtime metadata.
6. Learning Gate runs before DONE: a reusable failure/correctness rule goes into a test/validator/script/owner doc rather than only into the prompt.

Benchmark fairness:

- same task/corpus/snapshot/budget between compared retrieval/memory providers;
- no gold label in retrieval inputs;
- report numerators/denominators and no-answer behavior;
- separate retrieval quality from final model task success;
- account foreground acquisition, worker/verification repair, and background/provider maintenance separately;
- do not present synthetic byte reduction as end-to-end token or quality proof.

## 7. Luna Max context rollover

The Coordinator should avoid becoming an ever-growing project transcript.

When context is materially large or one milestone closes:

- update `STATE.json` with exact HEAD, completed tasks, evidence refs and READY task;
- commit durable changes;
- produce a compact Coordinator handoff containing only Goal, exact live refs, current task, blocker/failure fingerprint and must-read owner docs;
- start a fresh verified Luna Max Coordinator context;
- fresh-read live state before dispatch.

Workers are disposable by default. Do not preserve worker reasoning transcripts as project state.

## 8. STATE.json rules

`STATE.json` is the single execution-status authority for this continuation branch unless an existing later canonical state owner supersedes it explicitly.

Coordinator updates it only after readback of the candidate/evidence being recorded. Legal high-level states:

```text
PLANNED
PREFLIGHT
RUNNING
CHECKPOINTED
BLOCKED
PROGRAM_DONE
```

Task states:

```text
PENDING
READY
RUNNING
WAITING
DONE
SUPERSEDED
```

`DONE` requires the task's evidence contract. `CHECKPOINTED` means safely saved, not completed. If external evidence is missing, use `WAITING`, not `DONE`.

## 9. Finish/stop rules

Continue while at least one required task is READY and within authority/budget. Do not stop merely because another task is waiting.

Program-wide stop is justified only by:

- explicit user STOP;
- irreconcilable target/authority ambiguity;
- required input/credential/host/permission unavailable with no independent READY tasks;
- safety/privacy boundary requiring new authority;
- execution budget/context ends and no actual redispatch path exists.

At a human handoff, report the single next decision/action needed, what was still completed independently, and the exact resume task.

## 10. Final report schema

```text
PROGRAM_STATUS: RUNNING | CHECKPOINTED | BLOCKED | PROGRAM_DONE
FIRST_USABLE: PASS | NOT_YET
FINAL_CANDIDATE: <ref/SHA>
COORDINATOR: Luna Max / <runtime proof>

USER_FLOW:
- step -> PASS/NOT_YET -> evidence

TASKS:
- DONE / WAITING / READY

INVARIANTS:
- maintained / exact exception if any

BLOCKERS:
- local or program-wide / resume_when

READY_NEXT:
- exact next authorized task

UNMERGED_OR_EXTERNAL_ACTIONS:
- what remains outside this execution authority

LEARNING_GATE:
- CAPTURED_OR_MECHANIZED | NO_REUSABLE_DELTA
```

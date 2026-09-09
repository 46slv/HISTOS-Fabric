# HISTOS Evidence Event Contract

Status: **PROPOSED / NOT IMPLEMENTED**

Updated: 2026-09-09

## Purpose

Create one provider-neutral input boundary between everyday harness activity and durable Memory/Skill learning. HISTOS should not ask every model to summarize its whole session and then guess which statements were observations.

## 1. Core model

```text
Codex / OpenCode / EPHEMERA / verifier / operator
        |
        v
raw bounded event + exact artifacts
        |
        v
HISTOS Evidence Event
        |
        +--> Context/evidence retrieval
        +--> low-cost learning trigger
        +--> Distillation Provider
        +--> repetition telemetry
```

The event journal records what was observed/reported by a producer. It is not automatically semantic Memory.

## 2. Proposed event envelope

A future typed event should carry at least:

```text
event_id                 stable, replay-safe identity
scope_id                 project/user/System scope
producer                  harness/adapter + version
session_or_run_ref        opaque producer correlation
occurred_at               producer time
observed_at               HISTOS ingest time
event_kind                typed class
operation_signature       optional normalized operation identity
source_snapshot_refs      exact applicable source/worktree identities
input_artifact_refs       retained exact/approved inputs
output_artifact_refs      retained exact/approved outputs
outcome                   success/failure/blocked/cancelled/unknown
verification_refs         independent verifier/test receipts where present
lineage                   replay_of / derived_from / parent event
privacy_class             egress/retention classification
friction                  optional routing features
```

Do not put raw secrets or whole transcripts into the envelope. Large payloads remain artifacts behind authorized refs.

## 3. Event kinds and evidence classes

Initial useful classes:

```text
user_instruction_or_correction
tool_call
tool_result
command_or_test_result
verifier_result
authority_denial
retry_or_repair
checkpoint_or_handoff
explicit_memory_request
explicit_operator_review
```

Each event also labels claim origin/evidence class, for example:

```text
USER      direct user statement/instruction
TOOL      observed tool/runtime output
ACT       action/result receipt
SELF      model judgement/inference
RECALL    memory/context returned from HISTOS/provider
```

The exact names may change; the invariant does not: **RECALL and SELF are not independent corroboration of the source they repeat.**

Kura's current deterministic gate is useful prior art here because it verifies candidate quotations against raw classes and suppresses text already echoed from the store.

## 4. Friction is a trigger, not truth

Candidate routing fields include:

```text
user_interrupt_count
user_correction_count
tool_denial_count
tool_error_retry_count
repair_iteration_count
verifier_failure_count
knowledge_gap_signal
```

TeamAI's current implementation strongly weights interruptions, corrections, denied calls and tool errors while intentionally preventing scale alone from triggering contribution. HISTOS should test that approach, but add other routes so a smooth session with a genuinely novel verified result can still be selected.

`friction_score` may answer “should we inspect/distill this session?” It must not answer “is this memory true?” or “should this Skill become active?”.

## 5. Replay, dedup and watermarks

Adapters maintain source-specific cursor/watermark state so restart/re-ingest does not create new support. Event identity should be based on producer-stable identifiers when available; otherwise use a documented composite identity plus exact artifact hashes.

Duplicate delivery is idempotent. A re-run of a test is a new event only when it is actually a new execution; whether it counts as independent support is a later evidence-policy decision.

A model summarizing Event A produces a derived event or candidate linked to A. It does not become independent Event B evidence merely because another harness produced the summary.

## 6. Capture authority

Ordinary agent adapters may submit bounded event/candidate data within configured scope. They cannot set `verified`, increase proof count, change retention policy or broaden scope in their payload.

Write authority is server-side. Read-only integrations must reject write calls even if a host caches an old tool schema or a model guesses a hidden method name.

## 7. Distillation handoff

The trigger selects an event set under a byte/time/token budget. The Distillation Provider receives the event/artifact refs it is allowed to read and returns candidate abstractions plus grounding receipts.

Candidate admission then checks:

- referenced events/artifacts still exist and are authorized;
- quoted/claimed support maps to the retained evidence class;
- recall/self-origin material has not been counted as independent support;
- applicable source/runtime identity is preserved;
- contradiction/supersession candidates are explicit;
- unsupported numbers/attributions are rejected or marked judgement.

No distillation result becomes current project truth.

## 8. First experiments

1. Normalize the existing shared Kura PoC journal into this envelope without losing its evidence/watermark semantics.
2. Normalize the same small task from Codex and OpenCode and prove semantically equivalent operations can be compared without sharing raw chat history.
3. Replay sessions with known reusable outcomes and compare friction-trigger selection against “distill every session”.
4. Inject a recalled memory into tool output and prove the next capture cannot count it as new evidence.
5. Capture a genuine new test result in tool output and prove it remains eligible evidence rather than being discarded wholesale.

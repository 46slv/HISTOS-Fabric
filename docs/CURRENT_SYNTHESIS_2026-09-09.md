# HISTOS current synthesis — 2026-09-09

Status: **RESEARCH SYNTHESIS / PROPOSED DESIGN DELTAS**

## Executive result

The core HISTOS thesis survives the latest research: keep large source/memory/evidence spaces outside disposable model context, preserve exact provenance/current-truth boundaries, and compile bounded task-specific context. The main change is **component strategy**, not purpose.

HISTOS should expose provider-neutral boundaries around the parts that need replacement or comparison, but the work is **not greenfield**. An advanced program-delivery branch already contains experimental candidates for externalization/indexing/Context compilation, a shared Codex/OpenCode MCP service, evidence memory, compiled understanding, bounded sleep, typed relationships, operation candidates and retrieval-policy experiments. New Kura/TeamAI/Agent Skills work should integrate with and benchmark those candidates rather than redesign them from scratch.

See [`IMPLEMENTATION_CANDIDATE_MAP_2026-09-09.md`](IMPLEMENTATION_CANDIDATE_MAP_2026-09-09.md) before starting implementation work.

## Live HISTOS lines checked

- canonical `main`: `d500d9c672afbe3cce6b7c76b9ec8488fbd7acdb` — research/docs line containing Kura and TeamAI targets;
- older detailed design: Draft PR #1 at `3a5465b3e1ccb1a9da9533bf4b72e9e43f353dea` — carried forward into the current synthesis branch;
- H0/H1 executable line: Draft PR #2 at `e0cbdc2197ba3055ce02f030a2e93a03f1467b6f`;
- advanced program-delivery candidate: `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30`, a direct descendant of PR #2 head by 8 commits;
- test-aggregation repair over that program branch: Draft PR #3;
- current research/design reconciliation: Draft PR #4.

Branch/status separation is intentional: presence on the program branch is implementation evidence, not automatic acceptance into canonical `main` or EPHEMERA production authority.

## New upstream source inspections

### distill-kura

Checked upstream `lna-lab/distill-kura` master at `33aec61dcd28076848bfdfa9dfdf5902300fe109`.

Concrete mechanisms relevant to HISTOS:

- deterministic candidate quotation verification against raw classed material;
- echo suppression when text already exists in the memory store;
- evidence classes constrain what a candidate may claim;
- model-written final surfaces mechanically rechecked for unsupported numbers, dead links and invented quotations;
- MCP bridge defaults read-only, hides the write tool **and** rejects a guessed write call server-side;
- bound-store mode reduces disclosure and prevents per-call store switching;
- upstream comments report inconsistent MCP initialize-instruction handling across clients, so a large resident map is exposed as explicit retrieval rather than assumed startup context.

Design implication: Kura is worth testing early as an **alternate Memory/Distillation provider**, particularly for model-assisted extraction and grounding. It should not replace H03's existing host-owned provenance/revision/supersession semantics merely because Kura has its own store.

### Tencent TeamAI CLI

Checked upstream `Tencent/teamai-cli` main at `a396244967bd0e2bfb0c26c1f078ba7a9d7c8997`.

Concrete mechanisms relevant to HISTOS:

- Git-backed learnings plus local derived search index;
- current recall exposes term coverage, scope, snippets/code anchors and bounded related files;
- recall/use feedback is recorded;
- `contribute-check` strongly weights interruptions, denied tool calls, user corrections and repeated tool errors as **friction** signals while preventing scale alone from triggering contribution;
- SessionStart auto-recall was superseded in its design by active recall;
- current history includes fixes for recursive self-output/auto-recall behavior.

Design implication: friction is a useful **event-routing/distillation trigger**, and recall/use is a utility signal. Neither is independent epistemic support. H03/A01 already provide stronger trust and bounded policy surfaces; TeamAI informs inputs/adapter/projection design rather than replacing them.

### Agent Skills + current Codex/OpenCode support

Checked the Agent Skills specification at `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`, current OpenAI Codex skill-creator guidance, and current OpenCode Agent Skills documentation.

The open format uses `SKILL.md` plus optional `scripts/`, `references/` and `assets/`, and is explicitly progressive: small discovery metadata, body on activation, resources on demand. Current Codex guidance independently emphasizes cheap discovery, progressive disclosure and deterministic scripts for repeated logic. Current OpenCode loads Skills on demand through its native skill mechanism and supports `.agents/skills` compatibility locations.

Design implication: **portable procedural projection** should first target Agent Skills where semantics fit. A00/H03 evidence and consumer-owned activation remain upstream gates; standard packaging is not permission.

## Updated system model

```text
                     HISTOS shared kernel/contracts

 Source/worktree identity      Evidence/provenance/revision rules
 Context budget/compiler       Scope/egress/capability rules
 Maintenance bounds            Selection/evaluation receipts
             |
     +-------+-------------+----------------+
     |                     |                |
 Native candidates      External        Projection
 H01/H02/H03/H04        providers       providers
 H06/A00/A01            Kura/...        Agent Skills/...
     |                     |                |
     +---------------------+----------------+
                           |
                    bounded outputs
                           |
          Codex / OpenCode / EPHEMERA Harness
```

Providerization is used where it creates replaceability and measurable comparison. It is not a reason to split every native module into a network service.

## Stable decisions that should not be relaxed

1. **Current truth is not memory.** Fresh repository/runtime/System state wins when freshness is required.
2. **Retrieval is not evidence.** Recalled text and model restatement do not create independent support.
3. **Source is not context.** Large stores/indexes remain selection surfaces, not default prompt payloads.
4. **Exact evidence remains reopenable.** Summaries/compiled views carry source/evidence descent paths.
5. **Context is explicitly budgeted.** Include aggregate acquisition and maintenance cost, not only one capsule size.
6. **HISTOS is not Mission authority.** EPHEMERA keeps Mission/Goal transitions and consequential activation policy.
7. **Read/write/admin are separate capabilities.** Hiding a tool is not enforcement.
8. **Background work is bounded/coalesced.** Small deltas cannot fan out into unbounded model refreshes.
9. **Existing experimental candidates are baselines.** Replacement/provider claims must demonstrate parity or incremental value rather than resetting the project to design-only state.

## Architecture changes proposed now

### 1. First-class Evidence Event layer

Normalize Codex/OpenCode/EPHEMERA events before model-assisted memory extraction. Preserve producer/origin, exact artifacts, outcome, source snapshot and replay identity. This should feed the existing H03 trust boundary and H04 delta queue rather than bypass them.

See [`EVIDENCE_EVENT_CONTRACT.md`](EVIDENCE_EVENT_CONTRACT.md).

### 2. Provider architecture over native candidates

Define Source/Retrieval/Memory/Distillation/Projection provider boundaries where replacement is valuable. Treat H01/H02/H03/H04 as native candidate implementations and Kura as an alternate experimental path. Provider qualification is capability-specific.

See [`PROVIDER_PROJECTION_ARCHITECTURE.md`](PROVIDER_PROJECTION_ARCHITECTURE.md).

### 3. Procedural projection

Treat Skills/Rules/Docs as outputs of reviewed knowledge, not primary truth. Prefer a portable Agent Skills projection where supported, likely sourced from an accepted procedure revision and/or an externally verified A00 candidate. Installation/update ownership stays explicit.

See [`AGENT_SKILLS_RESEARCH_TARGET.md`](AGENT_SKILLS_RESEARCH_TARGET.md).

## Revised experimental priority

1. use the program-delivery candidate as the native benchmark baseline, after checking its exact acceptance status;
2. freeze the Evidence Event/provider compatibility layer without weakening H02/H03/H04 invariants;
3. add a **read-only Kura adapter experiment** and compare it with the native H03/lexical path under the same scopes and context budgets;
4. prove one reviewed procedure can be projected as the same core Agent Skill to Codex and OpenCode;
5. replay real session traces to measure friction-trigger precision/recall versus processing every session;
6. use existing A01 held-out/rollback mechanics rather than inventing a second retrieval-policy learner;
7. only replace a native component when the provider demonstrates measurable value and preserves provenance/authority/recovery boundaries.

The target is:

> **Own the invariants and compilation boundary; reuse replaceable mechanisms where they improve the verified native baseline.**

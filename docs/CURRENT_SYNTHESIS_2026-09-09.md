# HISTOS current synthesis — 2026-09-09

Status: **RESEARCH SYNTHESIS / PROPOSED DESIGN DELTAS**

## Executive result

The core HISTOS thesis survives the latest research: keep large source/memory/evidence spaces outside disposable model context, preserve exact provenance/current-truth boundaries, and compile bounded task-specific context. The main change is **component strategy**, not purpose.

HISTOS should be a small provider-neutral kernel around scope, source snapshots, evidence/event lineage, context compilation, selection receipts and policy. Memory storage/distillation, semantic retrieval and procedural projection should be replaceable providers behind that kernel. This lets HISTOS use mature existing mechanisms without granting them Mission authority or making one backend irreversible.

## Live HISTOS state checked

- `main`: `d500d9c672afbe3cce6b7c76b9ec8488fbd7acdb`
- main already contains Kura and TeamAI research targets.
- the older detailed v0 design existed on Draft PR #1 at `3a5465b3e1ccb1a9da9533bf4b72e9e43f353dea`, so this documentation pass carries that design forward onto the newer research baseline rather than treating the two branches as competing specifications.

## New upstream source inspections

### distill-kura

Checked upstream `lna-lab/distill-kura` master at `33aec61dcd28076848bfdfa9dfdf5902300fe109`.

Important concrete mechanisms:

- `distill_kura/distill/gate.py` verifies candidate quotations against raw classed material by deterministic substring checks;
- echoes already present in the memory store are suppressed, directly addressing self-recollection loops;
- surviving evidence classes constrain what a candidate may claim;
- downstream model-written surfaces are mechanically rechecked for unsupported numeric tokens, dead links and invented quotations;
- its MCP bridge defaults to read-only, removes the write tool from discovery **and** rejects a guessed write call server-side;
- bound-store mode reduces disclosure and prevents a call argument from switching memory stores;
- the bridge itself warns that MCP initialize instructions are not a reliable way to deliver a large resident map across clients, so the map remains an explicit tool/read surface.

Design implication: HISTOS should require a provider to expose deterministic grounding/capability receipts rather than accepting only a model-written confidence statement. Kura is now worth testing early as a Memory/Distillation Provider.

### Tencent TeamAI CLI

Checked upstream `Tencent/teamai-cli` main at `a396244967bd0e2bfb0c26c1f078ba7a9d7c8997`.

Important concrete mechanisms:

- Git-backed learnings with a local search index keep synchronized knowledge human-readable while the index stays local/derived;
- current recall code records recall/use feedback and surfaces term coverage, scope, snippets, codebase anchors and bounded related files;
- `contribute-check` uses interruptions, denied tool calls, user corrections and repeated tool errors as primary **friction** signals; scale/number of tools alone is intentionally insufficient;
- the design superseded SessionStart auto-recall in favor of active recall through an agent/rule path;
- current code has had to fix recursive auto-recall/self-output behavior, reinforcing the need for explicit origin/lineage boundaries.

Design implication: friction is a good low-cost **distillation trigger**, but recall/popularity is a utility signal, not epistemic support. HISTOS should not auto-promote a fact because it was frequently retrieved.

### Agent Skills + current Codex/OpenCode support

Checked the Agent Skills specification at `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`, current OpenAI Codex skill-creator guidance, and current OpenCode Agent Skills documentation.

The open format uses:

```text
skill-name/
  SKILL.md
  scripts/       optional
  references/    optional
  assets/        optional
```

and explicitly encourages progressive disclosure: small metadata at discovery, the main SKILL body on activation, and references/resources only when needed. Current Codex guidance independently emphasizes cheap discovery, progressive disclosure and deterministic scripts for repeated logic. Current OpenCode supports on-demand `SKILL.md` loading and common skill locations, including `.agents/skills`.

Design implication: verified procedural knowledge does not need a unique HISTOS-only distribution format. HISTOS should first test a standards-compliant **Agent Skill Projection**, then add thin harness-specific installation/UI adapters where needed.

## Updated system model

```text
                    HISTOS Kernel

 Scope / auth / egress policy
 Source + worktree snapshot identity
 Artifact + Evidence Event lineage
 Provider registry + capability checks
 Context Compiler + budget + selection receipts
 Revision/projection ownership metadata
              |
      +-------+---------+----------------+
      |                 |                |
 Source/Retrieval   Memory/Distill   Projection
 providers          providers        providers
      |                 |                |
 structural/etc.       Kura?         Agent Skills
 file/BM25/etc.       native?        harness adapter
      +-----------------+----------------+
                        |
                 Context Capsule
                        |
       Codex / OpenCode / EPHEMERA Harness
```

The provider does the specialized work; HISTOS owns the contract under which its output may be recalled, cited, rejected, projected or passed into a model.

## Stable decisions that should not be relaxed

1. **Current truth is not memory.** Fresh repository/runtime/System state wins when freshness is required.
2. **Retrieval is not evidence.** Recalled text and model restatement do not create independent support.
3. **Source is not context.** Large stores/indexes remain selection surfaces, not default prompt payloads.
4. **Exact evidence remains reopenable.** Summaries/compiled views carry source/evidence descent paths.
5. **Context is explicitly budgeted.** Include aggregate acquisition and maintenance cost, not only one capsule size.
6. **HISTOS is not Mission authority.** EPHEMERA keeps Mission/Goal transitions and consequential activation policy.
7. **Read/write/admin are separate capabilities.** Hiding a tool is not enforcement.
8. **Background work is bounded/coalesced.** Small deltas cannot fan out into unbounded model refreshes.

## Architecture changes proposed now

### 1. First-class Evidence Event layer

Normalize Codex/OpenCode/EPHEMERA events before memory extraction. Preserve producer/origin, exact artifacts, outcome, source snapshot and replay identity. Friction, retries and corrections are routing features over those events.

See [`EVIDENCE_EVENT_CONTRACT.md`](EVIDENCE_EVENT_CONTRACT.md).

### 2. Provider architecture

Define `SourceProvider`, `RetrievalProvider`, `MemoryProvider`, `DistillationProvider` and `ProjectionProvider` capability boundaries. Kura can then be tested without making its storage format HISTOS authority.

See [`PROVIDER_PROJECTION_ARCHITECTURE.md`](PROVIDER_PROJECTION_ARCHITECTURE.md).

### 3. Procedural projection

Treat Skills/Rules/Docs as **outputs of verified knowledge**, not the primary truth store. Prefer a portable Agent Skills projection for procedural knowledge where supported. Use harness-specific resources only when their semantics cannot be represented by the shared format.

See [`AGENT_SKILLS_RESEARCH_TARGET.md`](AGENT_SKILLS_RESEARCH_TARGET.md).

## Revised experimental priority

1. preserve the existing Context Compiler/artifact work as first-useful functionality;
2. freeze Evidence Event and Provider contracts alongside H0;
3. run a **read-only Kura provider** early, alongside a simple lexical/file-native baseline;
4. prove the same reviewed Agent Skill procedure can be projected to Codex and OpenCode without duplicating its core instructions;
5. replay real session traces to evaluate friction-trigger precision/recall versus distilling everything;
6. only after those experiments decide whether HISTOS needs a native durable memory engine or mainly a provider-neutral memory envelope.

The target is no longer “build every memory mechanism inside HISTOS.” It is:

> **Own the invariants and compilation boundary; reuse replaceable mechanisms when they preserve those invariants.**

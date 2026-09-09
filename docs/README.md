# HISTOS-Fabric Documentation

Status: **BOOTSTRAP / RESEARCH ROUTER**

HISTOS documentation is split by authority. Research notes describe evidence and hypotheses; architecture documents describe target boundaries; detailed design describes proposed implementation contracts; none of those imply a runtime is implemented.

## Current synthesis — read this first

1. [`CURRENT_SYNTHESIS_2026-09-09.md`](CURRENT_SYNTHESIS_2026-09-09.md)
   - current interpretation after Kura, TeamAI and Agent Skills research;
   - which original HISTOS decisions remain stable;
   - which parts should become provider/plugin boundaries;
   - revised near-term experiments and implementation order.

2. [`PROVIDER_PROJECTION_ARCHITECTURE.md`](PROVIDER_PROJECTION_ARCHITECTURE.md)
   - HISTOS Kernel versus Source/Memory/Distillation/Projection providers;
   - capability and authority boundaries;
   - standard procedural projection before bespoke per-harness duplication.

3. [`EVIDENCE_EVENT_CONTRACT.md`](EVIDENCE_EVENT_CONTRACT.md)
   - provider-neutral event/evidence envelope for Codex, OpenCode, EPHEMERA and future harnesses;
   - friction as a routing signal, not evidence;
   - anti-self-corroboration and replay/dedup boundaries.

## Core architecture and relationships

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target Context Substrate, Context Capsule, progressive disclosure, provenance, indexing and bounded consolidation.
- [`ECOSYSTEM_RELATIONSHIPS.md`](ECOSYSTEM_RELATIONSHIPS.md) — HISTOS versus EPHEMERA-System/Harness, Codex/OpenCode, projects, Dev Exec, Git/Obsidian and Console.
- [`ROADMAP.md`](ROADMAP.md) — long-term capability map and acceptance direction.

## Detailed implementation design

Start with [`design/v0/README.md`](design/v0/README.md). The 2026-09-09 update folds the newer provider/event/projection research into the earlier detailed design without pretending that the runtime exists.

The package covers service/context, data/recovery, security/governance, memory/learning, delivery/acceptance, draft wire shapes, static fixtures and explicitly unexecuted runtime conformance cases.

## Research foundation and targets

- [`RESEARCH.md`](RESEARCH.md) — foundational prior-art map: ReMe, Hindsight, Letta, Aider, Serena, Continue, Graphiti/Zep, Mem0, MemOS/A-MEM, SkillsVote/SkillRL/EvolveMem, long-document retrieval and benchmarks.
- [`KURA_RESEARCH_TARGET.md`](KURA_RESEARCH_TARGET.md) — `lna-lab/distill-kura` as memory/distillation provider and benchmark target.
- [`TEAMAI_CLI_RESEARCH_TARGET.md`](TEAMAI_CLI_RESEARCH_TARGET.md) — Tencent TeamAI CLI as cross-harness distribution, retrieval, friction-trigger and promotion prior art.
- [`AGENT_SKILLS_RESEARCH_TARGET.md`](AGENT_SKILLS_RESEARCH_TARGET.md) — open Agent Skills format and current Codex/OpenCode support as a candidate portable procedural projection target.

Research targets are not adopted dependencies. A project README, issue or local PoC does not automatically become HISTOS architectural authority.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Exists in HISTOS code and has named tests/runtime evidence. |
| `DRAFT DESIGN` | Concrete proposal/contract fixture; not accepted or implemented. |
| `ACCEPTED DESIGN` | Approved design/contract; implementation may be incomplete. |
| `TARGET ARCHITECTURE` | Intended direction; implementation may be partial or absent. |
| `BOOTSTRAP` | Repository/contract setup before a stable runtime exists. |
| `RESEARCH` | Investigation/evaluation only; not runtime authority. |
| `EXPERIMENTAL` | Runnable candidate without stable/production authority. |
| `DEPRECATED` | Present but should not be selected for new work. |
| `SUPERSEDED` | Replaced by a named newer authority/source. |

## Source precedence

For current facts:

```text
fresh source repository/runtime/System state
  > immutable evidence / receipts
  > implemented HISTOS contracts/tests
  > accepted architecture
  > target architecture / draft design
  > research notes
```

Remembered, projected or compiled representations never override a required fresh read.

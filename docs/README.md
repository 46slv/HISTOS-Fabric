# HISTOS-Fabric Documentation

Status: **BOOTSTRAP / RESEARCH + IMPLEMENTATION-CANDIDATE ROUTER**

HISTOS documentation is split by authority. `main` is currently the research/docs landing line, while separate branches contain experimental implementation candidates. Do not infer canonical adoption from branch presence.

## Start here

1. [`CURRENT_SYNTHESIS_2026-09-09.md`](CURRENT_SYNTHESIS_2026-09-09.md)
   - current interpretation after Kura, TeamAI and Agent Skills source inspection;
   - stable invariants and proposed design deltas;
   - revised experiment priorities.

2. [`IMPLEMENTATION_CANDIDATE_MAP_2026-09-09.md`](IMPLEMENTATION_CANDIDATE_MAP_2026-09-09.md)
   - exact `main`, PR and program-branch refs;
   - H01/H02/H03/H04/H06/A00/A01 capability/status map;
   - what is already implemented as a candidate versus genuinely new research.

3. [`PROVIDER_PROJECTION_ARCHITECTURE.md`](PROVIDER_PROJECTION_ARCHITECTURE.md)
   - Kernel/native candidate versus Source/Memory/Distillation/Projection providers;
   - capability and authority boundaries;
   - Kura and Agent Skills integration shape.

4. [`EVIDENCE_EVENT_CONTRACT.md`](EVIDENCE_EVENT_CONTRACT.md)
   - provider-neutral event/evidence envelope;
   - friction as a routing signal, not evidence;
   - anti-self-corroboration and replay/dedup boundaries.

## Core architecture and relationships

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — target Context Substrate, Context Capsule, progressive disclosure, provenance, indexing and bounded consolidation.
- [`ECOSYSTEM_RELATIONSHIPS.md`](ECOSYSTEM_RELATIONSHIPS.md) — HISTOS versus EPHEMERA-System/Harness, Codex/OpenCode, projects, Dev Exec, Git/Obsidian and Console.
- [`ROADMAP.md`](ROADMAP.md) — long-term capability map. Read the implementation-candidate map before treating a roadmap phase as unstarted.

## Detailed design

Start with [`design/v0/README.md`](design/v0/README.md), then [`design/v0/UPDATE_2026-09-09.md`](design/v0/UPDATE_2026-09-09.md). The older v0 recovery/security/context material remains useful, but the update and implementation map take precedence for component strategy and current candidate status.

## Research foundation and targets

- [`RESEARCH.md`](RESEARCH.md) — foundational prior art: ReMe, Hindsight, Letta, Aider, Serena, Continue, Graphiti/Zep, Mem0, MemOS/A-MEM, SkillsVote/SkillRL/EvolveMem, long-document retrieval and benchmarks.
- [`KURA_RESEARCH_TARGET.md`](KURA_RESEARCH_TARGET.md) — `lna-lab/distill-kura` as memory/distillation provider and benchmark target.
- [`TEAMAI_CLI_RESEARCH_TARGET.md`](TEAMAI_CLI_RESEARCH_TARGET.md) — Tencent TeamAI CLI as cross-harness distribution, retrieval, friction-trigger and promotion prior art.
- [`AGENT_SKILLS_RESEARCH_TARGET.md`](AGENT_SKILLS_RESEARCH_TARGET.md) — open Agent Skills format/current Codex/OpenCode support as a portable procedural projection target.

Research targets are not adopted dependencies. Current source inspection and experiments must precede qualification.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Exists in the named exact code line and has named tests/runtime evidence. Does not imply main/production adoption. |
| `IMPLEMENTED CANDIDATE` | Runnable component candidate with bounded evidence; independent/host/System gates may remain. |
| `DRAFT DESIGN` | Concrete proposal/contract fixture; not accepted or implemented merely by documentation. |
| `ACCEPTED DESIGN` | Approved design/contract; implementation may be incomplete. |
| `TARGET ARCHITECTURE` | Intended direction; implementation may be partial or absent. |
| `BOOTSTRAP` | Repository/contract setup before a stable canonical runtime exists. |
| `RESEARCH` | Investigation/evaluation only; not runtime authority. |
| `EXPERIMENTAL` | Runnable candidate without stable/production authority. |
| `DEPRECATED` | Present but should not be selected for new work. |
| `SUPERSEDED` | Replaced by a named newer authority/source. |

## Source precedence

For current facts:

```text
fresh source repository/runtime/System state
  > exact implementation candidate + named tests/evidence for that candidate
  > immutable evidence / receipts
  > accepted architecture/contracts
  > target architecture / draft design
  > research notes
```

Candidate implementation does not outrank a newer canonical source for a different responsibility. Remembered, projected or compiled representations never override a required fresh read.

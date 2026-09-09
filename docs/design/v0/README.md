# HISTOS v0 detailed design

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Original revision: 2026-09-06  
Current research update: 2026-09-09

## Read the update first

[`UPDATE_2026-09-09.md`](UPDATE_2026-09-09.md) records the deltas introduced by newer Kura, TeamAI and Agent Skills research. The original v0 files remain useful for persistence, security, context budgets, recovery and acceptance detail unless the update explicitly changes their interpretation.

No daemon, MCP connection, retrieval score, memory promotion, provider adoption or production validation is claimed by this design. Static schema/fixture checks are not runtime evidence.

## Owner routing

| Question | Owner |
| --- | --- |
| Research-derived v0 deltas | [UPDATE_2026-09-09.md](UPDATE_2026-09-09.md) |
| Processes, interfaces, context compilation, integration limits | [SERVICE_AND_CONTEXT.md](SERVICE_AND_CONTEXT.md) |
| Identity, persistence, snapshots, concurrent updates, cache invalidation | [DATA_AND_RECOVERY.md](DATA_AND_RECOVERY.md) |
| Access, model egress, sandbox boundary, retention, privacy | [SECURITY_AND_GOVERNANCE.md](SECURITY_AND_GOVERNANCE.md) |
| Memory, sleep, experience-to-automation, future policy learning | [MEMORY_AND_LEARNING.md](MEMORY_AND_LEARNING.md) |
| Vertical slices, measurable gates, failure scenarios, remaining decisions | [DELIVERY_AND_ACCEPTANCE.md](DELIVERY_AND_ACCEPTANCE.md) |
| External facts checked in the original pass | [SOURCES_AND_REVIEW.md](SOURCES_AND_REVIEW.md) |
| Narrow proposed wire shapes | [contracts.schema.json](contracts.schema.json) |
| Synthetic shape fixtures | [contract-examples.json](contract-examples.json) |
| Runtime conformance cases, initially NOT_RUN | [conformance-cases.json](conformance-cases.json) |
| Original static checks | [STATIC_VALIDATION.md](STATIC_VALIDATION.md) |

Broader architecture remains in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) and the current system-level synthesis in [`../../CURRENT_SYNTHESIS_2026-09-09.md`](../../CURRENT_SYNTHESIS_2026-09-09.md).

## Stable v0 decisions

- one shared local service with thin clients rather than one mutable memory DB per harness;
- a small agent-facing interface rather than a giant tool catalogue;
- exact source/worktree identity and immutable refs;
- Source/Evidence/Memory/Derived State remain different authority classes;
- explicit scope/provider-egress authorization before delivery;
- MCP assistance is weaker than a managed adapter or isolated runner;
- context, task/session and maintenance costs are separate ledgers;
- Markdown/Obsidian views are projections, not parallel authorities;
- sleep produces bounded candidates, not authority;
- first usable delivery remains retrieval/context before the full memory stack.

## New interpretation

The main change is component strategy: HISTOS should own the provider-neutral contracts, evidence/event lineage, snapshot/provenance rules, Context Compiler and policy boundaries, while memory/distillation and procedural projection can be provided by replaceable backends. Kura is now an early experimental-provider candidate rather than something to evaluate only after a native memory subsystem exists. Agent Skills becomes a candidate portable projection format for verified procedures.

# HISTOS v0 detailed design

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Revision: 2026-09-06  
Baseline reviewed: HISTOS-Fabric `7430a822493a8bca17eb542230b0d6c5aa0fb116`

## Outcome

Make ordinary Codex/OpenCode work consume less redundant context, without requiring an EPHEMERA Mission, hiding evidence, or building a second orchestrator. This package turns the bootstrap vision into proposed implementation boundaries, protocols, failure behavior and acceptance work.

**No daemon, MCP connection, retrieval score, memory promotion or production validation is claimed by this design.** Schema checks prove fixture shape only. The initial five historical benchmark cases are not independently frozen gold.

## Read only the owner for the task

| Question | Owner |
| --- | --- |
| Processes, interfaces, context compilation, integration limits | [SERVICE_AND_CONTEXT.md](SERVICE_AND_CONTEXT.md) |
| Identity, persistence, snapshots, concurrent updates, cache invalidation | [DATA_AND_RECOVERY.md](DATA_AND_RECOVERY.md) |
| Access, model egress, sandbox boundary, retention, privacy | [SECURITY_AND_GOVERNANCE.md](SECURITY_AND_GOVERNANCE.md) |
| Memory, sleep, experience-to-automation, future policy learning | [MEMORY_AND_LEARNING.md](MEMORY_AND_LEARNING.md) |
| Vertical slices, measurable gates, failure scenarios, remaining decisions | [DELIVERY_AND_ACCEPTANCE.md](DELIVERY_AND_ACCEPTANCE.md) |
| External facts checked, interpretation limits, design audit | [SOURCES_AND_REVIEW.md](SOURCES_AND_REVIEW.md) |
| Narrow proposed wire shapes | [contracts.schema.json](contracts.schema.json) |
| Synthetic positive/negative shape examples | [contract-examples.json](contract-examples.json) |
| Runtime conformance cases, all initially NOT_RUN | [conformance-cases.json](conformance-cases.json) |
| Static checks performed and reproducible checker | [STATIC_VALIDATION.md](STATIC_VALIDATION.md) |

Existing [architecture](../../ARCHITECTURE.md), [ecosystem](../../ECOSYSTEM_RELATIONSHIPS.md), [roadmap](../../ROADMAP.md) and [research](../../RESEARCH.md) remain the broader vision. This package refines their implementation choices; it does not mark them accepted or migrated. If adopted, the property-specific owner documents above govern the v0 details rather than old illustrative snippets.

## Proposed decisions

| ID | Decision | Reason / rejected alternative |
| --- | --- | --- |
| D01 | Independent HISTOS repository; one local service with thin clients | Avoid embedding a separate mutable memory database into each harness. |
| D02 | Start with five agent-facing tools, no general shell executor | Avoid a new tool catalogue that consumes the context it is intended to save. |
| D03 | Source artifacts + transactional control metadata + rebuildable indices are distinct | A rebuildable search index is not a substitute for policy, deletion or commit history. |
| D04 | Per-worktree snapshots and immutable references | Branch name or file content alone does not identify the applicable environment. |
| D05 | Scope and provider-egress authorization precede retrieval and model use | Post-filtering cannot undo leakage to a reranker or embedding provider. |
| D06 | MCP-only assistance and managed context enforcement are different integration grades | An MCP server cannot, by itself, intercept every native tool result or rewrite the host's history. |
| D07 | Markdown/Obsidian is initially an export, with edits submitted as revision proposals | Avoid uncontrolled dual writers and silent changes to evidence/policy. |
| D08 | Memory consolidation produces candidates; activation remains outside HISTOS | Popularity, repetition and sleep do not grant execution authority. |
| D09 | Bounded maintenance queue with fencing, coalescing and cost accounting | Background computation can otherwise exceed the work it was meant to save. |
| D10 | First useful delivery is read-only retrieval, not the entire memory stack | Obtain daily-use evidence before adding optional backends and self-improvement. |

Implementation default to evaluate: a TypeScript local service/CLI with SQLite and an official MCP SDK, plus replaceable parser adapters. Versions, SQLite binding and packaging must be pinned and tested in slice H0; this is not an installed dependency decision. Keep third-party memory stacks behind adapters or use them only as references. Do not start with mandatory GPU inference, embeddings, a distributed database, or a desktop framework.

## First useful loop

```text
approved project + exact worktree snapshot
  -> HISTOS lexical/structural retrieval
  -> bounded capsule + exact source references
  -> ordinary Codex or OpenCode session
  -> native project verification, owned by that harness/project
  -> optional evidence-linked candidate capture
```

The same capsule API later serves EPHEMERA. HISTOS does not need EPHEMERA to authorize its own local user's configured scopes; EPHEMERA can delegate narrowly scoped privileges for its Missions without becoming a mandatory login or runtime dependency.

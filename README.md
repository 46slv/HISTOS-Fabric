# HISTOS-Fabric

**Shared local context substrate for EPHEMERA and other agent harnesses.**

Status: **BOOTSTRAP / RESEARCH** — repository created, architecture and goals being established; no production runtime is claimed yet.

`HISTOS` takes its name from Greek `ἱστός` — loom / warp / web. The code name reflects the intended role: durable source, memory and evidence remain outside disposable model contexts, and HISTOS weaves only the bounded context needed for the current task.

## Purpose

HISTOS-Fabric is intended to become a local-first, provider-neutral service that can be shared by:

- `EPHEMERA-System`;
- EPHEMERA Harnesses;
- everyday Codex sessions;
- OpenCode and model-specific workers such as Muse;
- future MCP/API-compatible agent runtimes;
- independent project repositories.

The central rule is:

> **Source is not context. Memory is not context. Evidence is not context.**
>
> Large durable information spaces remain outside the model. HISTOS selects, compiles and explains a small task-specific `Context Capsule` under an explicit budget.

The target is not an agent with an ever-growing prompt. The target is a shared substrate that lets replaceable agents continue work without repeatedly rediscovering the same repository, history, failures, procedures and evidence.

## Ecosystem relationship

```text
                         EPHEMERA ecosystem

                    +-------------------------+
                    |     EPHEMERA-System     |
                    | Mission / Goal / Task   |
                    | authority / scheduling  |
                    | governance / recovery   |
                    +------------+------------+
                                 |
                                 | policy / scope / current truth refs
                                 v
+-------------+        +-------------------------+        +-------------------+
|    Codex    | <----> |      HISTOS-Fabric      | <----> | EPHEMERA Harness  |
| daily work  |  MCP   | context / memory /      |  API   | bounded Task/Cycle|
+-------------+        | evidence substrate      |        +-------------------+
                       +------------+------------+
+-------------+                     ^
|  OpenCode   | <-------------------+
| Muse / etc. |        MCP / local API
+-------------+
                                 ^
                                 |
                      source / evidence adapters
                                 |
                +----------------+----------------+
                | project repositories / docs /  |
                | artifacts / receipts / history |
                +---------------------------------+
```

Responsibility split:

- **EPHEMERA-System** owns durable Mission continuity, canonical state, authority, scheduling, governance and cross-cycle decisions.
- **HISTOS-Fabric** owns reusable context acquisition, indexing, memory/evidence retrieval, context compilation, externalized large results, compiled understanding and bounded consolidation mechanisms.
- **EPHEMERA Harness** owns bounded disposable role execution for one Task/Cycle and returns evidence/receipts.
- **Codex / OpenCode / other harnesses** may use HISTOS directly without requiring an EPHEMERA Mission to be running.
- **Project repositories and live runtimes remain authoritative for their current facts.** HISTOS may recall or compile them, but remembered material never overrides a required fresh read.

HISTOS must not become a second Mission control plane.

See [`docs/ECOSYSTEM_RELATIONSHIPS.md`](docs/ECOSYSTEM_RELATIONSHIPS.md).

## Target architecture

```text
Source / Repositories / Documents
           |
           +--> structural map / symbols / sections / diffs
           |
Memory ----+--> episodic / semantic / procedural / decisions / failures
           |
Evidence --+--> receipts / tests / artifacts / provenance
           |
           v
      Candidate Context
           |
           v
     Context Compiler
  lexical / structural / graph
  semantic / recency / scope
  provenance / freshness / budget
           |
           v
      Context Capsule
      few-k-token target
           |
           v
   disposable Worker / Agent
           |
           v
        Result
           |
           +--> evidence capture
           +--> memory candidate
           +--> repetition signal
```

Important target capabilities:

- progressive disclosure: repository synopsis -> file/section outline -> symbol -> exact implementation/raw evidence;
- hybrid retrieval rather than embedding-only or graph-only selection;
- explicit token/context budgets;
- large tool/source output externalization with later selective reopen;
- content-addressed/incremental indexing and compiled-understanding caches;
- provenance-preserving context compression;
- shared memory across replaceable models/harnesses without shared conversation transcripts;
- bounded background consolidation (`sleep`) driven by deltas rather than full-history rereads;
- explanation of `why included?`, `why recalled?`, source identity and freshness;
- local-first MCP/API access for Codex, OpenCode and EPHEMERA;
- read-wide / write-narrow integration and separate authority gates for promotion or consequential actions.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Core invariants

1. **Current truth is separate from remembered history.** Live repository/runtime/System state wins when freshness is required.
2. **Retrieved context is not new evidence.** A memory restated by a model or returned by a tool must not self-corroborate into higher confidence.
3. **Derived indices are rebuildable.** Vector, graph, lexical and compiled caches must not become hidden canonical truth.
4. **Compression keeps a route back to evidence.** A Context Capsule must carry source/provenance references sufficient to reopen exact material.
5. **Context growth is bounded.** Source/history growth must not imply proportional active-model-context growth.
6. **Background learning is bounded.** Small deltas must not trigger unbounded refresh or LLM fan-out.
7. **Frequency never grants authority.** Repetition may create a candidate Tool/Skill/Guard, but activation authority remains explicit.
8. **HISTOS is provider-neutral.** No single model, harness, embedding provider, graph backend or UI is the architectural authority.

## Intended interfaces

The exact protocol is not frozen. A likely split is:

```text
Agent-facing MCP / local API
  context.search
  context.compile
  context.read
  context.explain
  memory.recall
  memory.capture_candidate
  procedure.recall

Privileged / policy-controlled API
  memory.promote
  memory.deprecate
  memory.consolidate
  scope.configure
  retention.configure
  automation_candidate.review
```

Daily Codex/OpenCode use should work through the first surface even when `EPHEMERA-System` is not actively orchestrating a Mission.

## Repository boundaries

This repository should contain reusable HISTOS mechanisms and contracts.

It should not absorb:

- EPHEMERA Mission state or transition authority;
- provider-specific orchestration policy that belongs to `EPHEMERA-System`;
- generic bounded role orchestration owned by EPHEMERA Harness;
- project-specific product logic;
- raw conversation transcripts as durable knowledge by default;
- secrets, credentials, large transient logs or non-rebuildable machine caches.

## Development direction

The first milestones are intentionally smaller than the full vision:

1. freeze a minimal `Context Capsule` and provenance contract;
2. build a local benchmark for context retrieval under fixed 2k/4k/8k budgets;
3. externalize oversized tool/source results and support selective reread;
4. prototype structural/symbol retrieval plus lexical retrieval before adding complex graph/vector dependencies;
5. add incremental source identity/invalidation and warm-cache measurement;
6. expose a minimal MCP interface usable from ordinary Codex/OpenCode sessions;
7. add file-native episodic/semantic memory with evidence references;
8. add bounded consolidation and compiled-understanding caches;
9. connect EPHEMERA-System as a privileged policy/authority consumer;
10. only then expand graph memory, self-tuning retrieval and Automation/Skill promotion.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for development goals and acceptance criteria.

## Research basis

The initial design is informed by existing systems and research rather than assuming every mechanism must be invented here. Current reference areas include:

- ReMe — file-native memory, structural chunking, hybrid retrieval, `auto_dream` and readable/derived-state separation;
- Hindsight — evidence-backed observations, compiled mental models/knowledge pages and consolidation behavior;
- Letta Code / Context Repositories — Git-backed durable memory, reflection and progressive context disclosure;
- Aider RepoMap — structural repository maps under token budgets;
- Serena and Tree-sitter/LSP MCP tools — symbol-level progressive code retrieval;
- Continue — content-addressed incremental indexing;
- Graphiti / Zep — temporal graph memory and hybrid retrieval;
- Mem0 — soft recall-priority decay;
- MemOS / A-MEM — memory infrastructure and linked evolving memory;
- SkillsVote / SkillRL / EvolveMem — evidence/trajectory-driven skill and retrieval-policy evolution;
- PageIndex / RAPTOR / GraphRAG — structural retrieval for long documents;
- Agent Retrieval Bench — evaluation of repository context acquisition independently from final patch generation.

These are **references and benchmark candidates, not adopted dependencies**.

See [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Related repositories

- [`46slv/EPHEMERA-System`](https://github.com/46slv/EPHEMERA-System) — durable Mission control plane and system orchestration.
- [`46slv/codex-ephemeral-harness`](https://github.com/46slv/codex-ephemeral-harness) — generic bounded ephemeral-agent harness / Context Firewall lineage.
- [`46slv/chatgpt-mcp`](https://github.com/46slv/chatgpt-mcp) — current ChatGPT bridge and Dev Exec implementation lineage during EPHEMERA migration.

## Current status

This repository currently defines a direction and research boundary. It does **not** yet claim a stable daemon, MCP server, memory backend, or production integration.

Experimental local candidates now exist for source/provenance and rendered
capsule contracts, an independently frozen public-corpus retrieval benchmark,
oversized-result externalization, incremental lexical/structural source indexing,
and a provider-neutral budgeted Context Compiler. See [`bench/README.md`](bench/README.md),
[`docs/CONTEXT_CONTRACT_V1.md`](docs/CONTEXT_CONTRACT_V1.md), and
[`docs/H01_COMPONENT_CONTRACT.md`](docs/H01_COMPONENT_CONTRACT.md). These are bounded
retrieval mechanisms; they do not establish end-to-end model gains or a stable
service. The architecture and roadmap remain target documents.

Implementation claims should be added only with exact code/tests/runtime evidence.

# HISTOS-Fabric Research Basis

Status: **RESEARCH**

Updated: 2026-09-06 JST

## Purpose

HISTOS-Fabric should not re-invent mechanisms that already exist in memory systems, coding agents, retrieval engines and long-document tooling.

This document records the current reference set and the mechanisms worth reproducing or benchmarking. It is not an adoption list. Project claims, benchmarks, licenses and current APIs must be re-checked before integration.

## Research question

The main problem is broader than RAG:

```text
large source / repo / docs / history / evidence / memory
                         |
                         v
              reusable local substrate
          index / map / retrieve / rank
          externalize / cache / explain
                         |
                         v
                 Context Compiler
                         |
                         v
                  Context Capsule
                    few-k tokens
                         |
                         v
                 disposable worker
                         |
                         v
             evidence / memory candidate
```

Target property:

> Growth in source size, history or memory count must not require proportional growth in active model context.

## High-priority references

### ReMe

Repository: https://github.com/agentscope-ai/ReMe

Relevant mechanisms:

- `Memory as File, File as Memory`;
- readable Markdown/YAML/JSONL source records;
- derived keyword/embedding/link indices;
- daily/session/resource/digest memory layers;
- structural Markdown chunking;
- BM25 + optional vector retrieval with rank fusion;
- wikilink graph expansion;
- incremental file watching/index update;
- `auto_dream` consolidation from changed daily inputs;
- bounded extracted memory units;
- failed consolidation inputs remain retryable;
- index compaction scheduled during idle time;
- agent integrations including Codex/Claude-style wrappers.

Important lesson:

Retrieved/tool output must not masquerade as independent source evidence when later memory extraction runs. This directly supports HISTOS's anti-self-corroboration invariant.

Research questions:

- how much context does structural chunking save versus fixed chunks/whole files?
- can file-native durable records remain portable while runtime indexes stay fast?
- which parts can be reused directly versus reproduced in smaller contracts?
- what failure/recovery behavior exists around watchers and background jobs?

### Hindsight

Repository: https://github.com/vectorize-io/hindsight

Relevant mechanisms:

- retain / recall / reflect separation;
- evidence-backed `observations` consolidated from facts;
- proof/support counts and source memory identity;
- semantic + BM25 + graph + temporal retrieval;
- higher-level mental models / knowledge pages;
- background consolidation;
- self-hosted/MCP paths.

Important positive lesson:

```text
raw facts / episodes
  -> evidence-backed observations
  -> compiled living knowledge
  -> cheap repeated read
```

This resembles HISTOS `compiled understanding`: use a validated higher-level representation when sufficient, but preserve the ability to descend to exact evidence.

Important negative lesson:

A real Hindsight issue reported automatic mental-model refresh amplification where tiny retains triggered expensive rebuilds across several models. A later fix added minimum refresh intervals and deferred/coalesced refresh behavior.

HISTOS should therefore require background refresh to be:

```text
delta-driven
coalesced
rate-limited
bounded
resumable
observable
```

### Letta Code / Context Repositories

Repository: https://github.com/letta-ai/letta-code

Relevant mechanisms:

- Git-backed/context-repository memory;
- durable context outside the immediate prompt;
- background reflection;
- sleep-time compute;
- memory organization/defragmentation;
- reusable Skills;
- subagents for memory/context work.

Why it matters:

One of the closest references for durable memory + background learning + progressive context disclosure.

Important difference to preserve:

```text
Letta-style emphasis
  persistent agent identity -> durable memory

HISTOS / EPHEMERA emphasis
  persistent substrate/System -> replaceable agents
```

### Aider Repository Map

Repository: https://github.com/Aider-AI/aider

Relevant mechanisms:

- Tree-sitter-backed symbol/reference extraction;
- compact repository structural map;
- graph/PageRank-style importance ranking;
- explicit token budget;
- map used before deeper file reads.

Why it matters:

Strong reference for `large repo -> structural candidate map -> bounded context`.

### Serena

Repository: https://github.com/oraios/serena

Relevant mechanisms:

- MCP-exposed semantic code tools;
- symbol overview;
- exact symbol retrieval;
- references/implementation/declaration navigation;
- progressive code exploration instead of whole-file reading.

Why it matters:

A direct integration candidate for early HISTOS code-context experiments before building custom language intelligence.

### Continue indexing

Repository: https://github.com/continuedev/continue

Relevant mechanisms:

- content-addressed indexing;
- reuse of unchanged content-derived artifacts;
- changed content re-indexing;
- multiple derived artifacts built from source identity.

Why it matters:

Reference for incremental understanding and cache invalidation.

### Graphiti / Zep

Repositories:

- https://github.com/getzep/graphiti
- https://github.com/getzep/zep

Relevant mechanisms:

- temporal knowledge/context graph;
- incremental episode ingestion;
- facts/relations that change over time;
- hybrid semantic/keyword/graph retrieval;
- temporal validity/history.

Why it matters:

Potential reference for memory relations where old history must remain visible after current truth changes.

Caution:

HISTOS should not introduce a heavy graph backend until typed provenance/scope and simpler retrieval baselines are proven.

### Mem0

Repository: https://github.com/mem0ai/mem0

Relevant mechanism:

Soft recall-priority decay rather than destructive forgetting.

Potential HISTOS interpretation:

```text
old / unused
  -> lower retrieval priority
not
  -> delete verified knowledge
```

Recency must not override scope/version/freshness/provenance.

### MemOS

Repository: https://github.com/MemTensor/MemOS

Relevant mechanisms:

- memory-as-infrastructure framing;
- composable memory spaces;
- graph/structured memory;
- multi-agent use;
- asynchronous memory management;
- skill-oriented memory reuse.

Why it matters:

Useful system-level reference for memory as shared infrastructure rather than prompt text owned by one agent.

### A-MEM

Repository: https://github.com/agiresearch/A-mem

Relevant mechanisms:

- Zettelkasten-inspired atomic memory;
- metadata/tags/embeddings;
- automatic memory links;
- evolving semantic network.

Caution:

A model may revise semantic summaries/links, but immutable source/evidence history must not be silently rewritten.

### SkillsVote / SkillRL / EvolveMem

Repositories:

- https://github.com/MemTensor/skills-vote
- https://github.com/aiming-lab/SkillRL
- https://github.com/aiming-lab/SimpleMem

Relevant mechanisms:

- just-in-time Skill retrieval;
- outcome/trajectory attribution;
- evidence-sensitive Skill evolution;
- hierarchical compression of raw experience into reusable skills;
- retrieval-policy self-tuning and regression rollback.

Why it matters:

Long-term reference for HISTOS repeated-work telemetry and future retrieval-policy learning.

Caution:

HISTOS may generate candidates, but Tool/Skill/Automation activation authority belongs to the consuming policy owner.

### PageIndex / RAPTOR / GraphRAG

Repositories:

- https://github.com/VectifyAI/PageIndex
- https://github.com/parthsarthi03/raptor
- https://github.com/microsoft/graphrag

Relevant mechanisms:

- hierarchical document navigation;
- tree/section-based retrieval;
- multi-level summaries;
- graph/community summaries;
- bounded query-time context over source larger than model context.

Why it matters:

HISTOS Context Plane must support long documents/manuals/PDFs, not only code.

Potential abstraction:

```text
Source Adapter
  code -> symbol/import/call structure
  docs -> section/page/tree structure
  memory -> semantic/temporal structure
  evidence -> receipt/artifact structure

all adapters
  -> candidate nodes
  -> Context Compiler
```

### Agent Retrieval Bench

Paper: https://arxiv.org/abs/2607.24882

Relevant idea:

Evaluate repository context acquisition separately from final patch generation.

This is especially useful because a coding agent can fail before reasoning begins simply by missing the relevant files/symbols.

HISTOS should maintain its own small real-world benchmark with the same separation.

## Tool-output externalization references

Several systems converge on a common pattern:

```text
large tool output
  -> persist externally
  -> keep bounded preview/reference
  -> search/read exact material later
```

HISTOS should treat this as a core primitive rather than an optional prompt trick.

Evaluation should check both token savings and whether exact verification evidence remains recoverable.

## Code-context prototype candidates

Before writing a custom parser/indexer, benchmark existing local tools where practical:

- Aider RepoMap;
- Serena;
- Tree-sitter MCP implementations;
- symbol/context-pack MCP tools;
- local SQLite/Tree-sitter code graphs;
- optional embedding retrieval.

A candidate is valuable if it improves verified context acquisition under fixed budgets, not merely if it exposes many tools.

## Research-derived constraints already strong enough to preserve

The following are treated as strong design constraints, though implementation is not yet complete:

1. `source != context`;
2. `memory != current truth`;
3. `retrieval != evidence`;
4. large payloads should be externalized and selectively reopened;
5. compressed context must retain exact provenance routes;
6. derived indices/caches must be rebuildable;
7. context compilation should be budgeted and progressively disclosed;
8. retrieval should be provider-neutral and hybrid-capable;
9. unchanged source should not be repeatedly re-analyzed;
10. background consolidation must be delta-driven/bounded/coalesced;
11. weak/local-model performance matters, not only frontier-model performance;
12. repeated work should eventually disappear behind smaller deterministic interfaces where evidence supports it.

## Immediate experiments

### Experiment A — externalization

Compare the same long-log/tool-output task with:

- raw result kept in context;
- exact result externalized with bounded preview + selective reopen.

Measure:

```text
input tokens
re-read count
correctness / verification success
latency
stored bytes
exact evidence recovery
```

### Experiment B — code retrieval bake-off

Compare on the same tasks/budgets:

```text
grep + whole-file baseline
lexical-only retrieval
RepoMap/structural retrieval
symbol retrieval
embedding retrieval
hybrid compiler
```

Budgets:

```text
2k
4k
8k
```

### Experiment C — incremental update

After establishing a warm index:

- edit a small number of lines/symbols;
- measure re-indexed source and dependent invalidations;
- confirm unrelated compiled context stays reusable.

### Experiment D — file-native evidence-linked memory

Prototype:

```text
source/evidence
  -> episode
  -> semantic/procedural candidate
  -> reviewed/promoted memory
```

Verify that retrieved memory cannot self-corroborate and that current-live-state reads override stale memory.

### Experiment E — compiled understanding

Cache one architecture/dependency explanation against exact source identities.

Measure:

- first-generation cost;
- warm reuse cost;
- invalidation after relevant edit;
- no invalidation after unrelated edit;
- ability to descend to exact source/evidence.

## Adoption rule

A third-party system can be:

```text
REFERENCE_ONLY
BENCHMARK_TARGET
EXPERIMENTAL_ADAPTER
REUSABLE_COMPONENT_CANDIDATE
ADOPTED_COMPONENT
```

Moving between these states requires explicit evidence.

Do not promote a component because its README uses similar terminology. Prefer exact source inspection, local reproduction, benchmark results and operational/failure analysis.

## Evaluation target

The primary question for every mechanism remains:

> Does it increase verified progress per unit of model context and human attention without weakening provenance, freshness or authority boundaries?

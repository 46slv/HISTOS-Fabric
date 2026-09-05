# HISTOS-Fabric Development Roadmap

Status: **TARGET ROADMAP / NOT IMPLEMENTATION STATUS**

Updated: 2026-09-06 JST

## Goal

Develop HISTOS-Fabric from an architecture/research repository into a local-first shared Context Substrate that ordinary Codex/OpenCode sessions and EPHEMERA components can use without proportional context growth as repositories/history expand.

The roadmap is ordered to prove the smallest high-value mechanisms first. Do not begin with a full graph database, autonomous memory evolution, or a large UI.

## North-star outcome

A mature HISTOS should make this routine:

```text
large repo + prior history + evidence
            |
            v
     HISTOS local service
            |
            v
  2k-8k Context Capsule
            |
            v
 Codex / OpenCode / Harness
            |
            v
 verified result + evidence
            |
            v
 incremental memory/context improvement
```

Success means agents spend less context and fewer turns rediscovering known structure while preserving exact evidence access and current-truth boundaries.

## Phase 0 — bootstrap contracts and benchmark corpus

### Deliverables

- repository boundary and documentation;
- minimal source/provenance identity model;
- candidate `Context Capsule` schema;
- benchmark case format;
- fixed 2k/4k/8k context-budget profiles;
- small real-world benchmark corpus from EPHEMERA-related repositories;
- measurement vocabulary.

### Required metrics

At minimum:

```text
gold/relevant source recall
selected-context precision
rendered tokens
raw source bytes/lines exposed to model
tool/search calls
whole-file reads
re-read count
cold latency
warm latency
cache hit rate
incremental update cost
stale-context harm
verified task outcome
```

### Exit criteria

- benchmark cases have independently reviewed/frozen expected context;
- baseline whole-file/grep exploration can be measured repeatably;
- no final patch-generation score is required to validate context acquisition itself.

## Phase 1 — oversized result externalization

This is the lowest-risk high-value Context Plane primitive.

### Implement

```text
context.externalize
context.read
context.search
```

Large source/tool outputs are persisted to a local content-addressed artifact area and replaced in active context with:

- stable reference;
- content digest;
- source metadata;
- bounded preview;
- exact line/range/search reopen instructions.

### Exit criteria

- exact original payload can be recovered;
- configured threshold reliably prevents giant payloads staying in active context;
- benchmark shows reduced input context without loss of verification correctness;
- retention/cleanup behavior is explicit and safe.

## Phase 2 — deterministic source index and structural retrieval

Start without mandatory embeddings.

### Implement

- source inventory;
- content hash identity;
- lexical/full-text search;
- code file/symbol outline for initial supported languages;
- current Git diff integration;
- exact range/symbol reopen;
- incremental added/modified/deleted handling.

Potential implementation references include Tree-sitter, LSP/Serena-style symbol retrieval and Aider-style RepoMap ranking, but no dependency is preselected.

### Exit criteria

- small source changes do not require full re-index;
- unchanged files produce warm-cache reuse;
- symbol-level retrieval reduces whole-file reads on benchmark tasks;
- all derived indices can be rebuilt from source.

## Phase 3 — Context Compiler v0

### Implement

A provider-neutral compiler that receives:

```text
task/goal
scope
budget
current truth refs
candidate source/evidence/memory
```

and emits a bounded Context Capsule.

Initial selection should combine simple explainable signals:

- exact/lexical relevance;
- source structure;
- current diff proximity;
- known dependency relations;
- source freshness/identity;
- explicit consumer scope.

### Exit criteria

- deterministic budget enforcement;
- every included fragment has provenance and reopen coordinates;
- compiler emits selection receipt / `why included` data;
- 2k/4k/8k budget results can be compared reproducibly;
- hybrid/structural method beats or matches baseline on verified context acquisition while exposing less raw source.

## Phase 4 — MCP + daily Codex/OpenCode use

HISTOS must prove value outside EPHEMERA orchestration.

### Implement

Minimal MCP surface:

```text
context_search
context_compile
context_read
context_explain
```

Optional CLI:

```text
histos health
histos index
histos search
histos compile
histos explain
histos bench
```

### Exit criteria

- Codex can use HISTOS in a normal repository session;
- OpenCode can use the same contract;
- neither requires an active EPHEMERA Mission;
- consumer-specific adapters do not leak into core ranking/storage contracts;
- daily-use telemetry can compare HISTOS-assisted and baseline exploration.

## Phase 5 — evidence-linked memory v0

Do not begin by storing every conversation.

### Implement

Candidate memory classes:

```text
episode
semantic
failure
procedure
decision reference
```

Each durable memory record should carry:

- stable ID;
- scope;
- status/confidence;
- provenance kind;
- source/evidence references;
- creation and last-verification time;
- version/runtime applicability where relevant;
- contradiction/supersession links.

### Critical guard

Retrieved memory, tool output or model restatement cannot self-corroborate into independent evidence.

### Exit criteria

- fresh workers can recall prior verified failures/procedures under the right scope;
- project-scoped memories do not leak into unrelated projects;
- live current state remains clearly distinguishable from remembered history;
- memory records can be exported/read without the runtime database.

## Phase 6 — compiled understanding cache

### Implement

Evidence/source-bound reusable higher-level interpretations, for example:

```text
architecture overview
module dependency explanation
known failure boundary
verified integration contract
```

Each compiled object must record exact dependency/source identity and coverage.

### Exit criteria

- unchanged source reuses compiled understanding;
- relevant source changes stale only affected compiled objects where feasible;
- workers can answer repeated orientation questions from compiled layers and descend to raw evidence when necessary;
- cache benefit is measured in context/tokens/turns, not merely hit count.

## Phase 7 — bounded consolidation / sleep

### Implement

A maintenance scheduler that is:

```text
delta-driven
coalesced
rate-limited
resumable
bounded by work/token budget
observable
```

Initial operations:

- deduplication;
- contradiction/drift detection;
- memory-link maintenance;
- stale-index optimization;
- compiled-understanding refresh;
- repeated-operation clustering;
- memory/procedure candidates.

### Exit criteria

- no full-history LLM reread for small deltas;
- bursts coalesce into bounded work;
- failed items remain retryable;
- deferred work is visible;
- background maintenance cost stays below configured budget;
- no candidate becomes authoritative solely because sleep generated it.

## Phase 8 — EPHEMERA-System privileged integration

### Implement

EPHEMERA-System adapter/policy integration for:

- Mission/Goal scope passed into Context Compiler;
- current-truth references;
- role-specific Context Capsules;
- evidence capture;
- memory/procedure promotion requests;
- repeated-work telemetry;
- Console read models.

### Boundary

HISTOS never changes canonical Mission state.

### Exit criteria

- EPHEMERA-System can replace one existing rediscovery/context path with HISTOS without losing authority/evidence guarantees;
- role-specific contexts are bounded and explainable;
- System can reject/stale HISTOS output against fresher canonical state;
- integration is through contracts, not internal store imports.

## Phase 9 — richer hybrid retrieval and graph memory

Only after lexical/structural/indexing baselines are measured.

Candidate work:

- embeddings;
- temporal graph relationships;
- co-change graph;
- typed memory/evidence graph;
- graph-aware reranking;
- long-document hierarchy adapters;
- cross-repository context under explicit scope.

### Exit criteria

Any new retrieval component must show incremental value on benchmark tasks relative to added dependency/latency/maintenance complexity.

No graph/vector backend is mandatory solely for architectural symmetry.

## Phase 10 — Automation/Skill candidate support

HISTOS can provide generic repeated-work evidence, not activation authority.

### Implement

Semantic operation signatures and metrics such as:

- occurrence count;
- stable-sequence ratio;
- repair iterations;
- failure frequency;
- repeated model/tool cost;
- stable input/output contract;
- deterministic verifier availability.

Candidate states:

```text
OBSERVED
  -> REPEATED
  -> CANDIDATE
  -> SHADOW
  -> VERIFIED
```

Activation to `ACTIVE` belongs to the relevant policy/authority owner, typically EPHEMERA-System or the user/project.

## Phase 11 — retrieval policy self-improvement

Long-term research goal.

Potentially allow HISTOS to tune:

- retrieval fusion weights;
- budget allocation;
- category-specific routing;
- cache thresholds;
- context expansion depth.

Requirements:

- held-out/evidence-backed evaluation;
- deterministic rollback;
- versioned policies;
- no optimization solely against self-generated summaries;
- clear comparison against fixed baseline.

## Future operator/inspection experience

A HISTOS-native UI is not a near-term requirement. The preferred near-term approach is:

- expose stable read models/API;
- let EPHEMERA Console aggregate them;
- keep CLI/MCP sufficient for independent daily use.

Possible future views:

```text
Context
Memory
Evidence
Indexes
Compiled Understanding
Consolidation
Candidates
Benchmarks
Health
```

## Things to avoid building too early

- a large standalone desktop UI before service contracts stabilize;
- mandatory vector DB before lexical/structural baselines are measured;
- a giant universal knowledge graph before provenance/scope semantics work;
- automatic memory promotion without evidence gates;
- autonomous Tool creation/activation without shadow verification;
- model-specific core contracts;
- raw transcript hoarding as the default memory strategy;
- full-history nightly reprocessing;
- multi-machine/cloud synchronization before local correctness/recovery is proven.

## Long-term development goals

The mature system should eventually support:

1. **Harness-neutral continuity** — verified discoveries made by Codex can be reused by OpenCode, EPHEMERA Harness and future runtimes.
2. **Sublinear active context growth** — source/history can grow substantially while task context remains bounded.
3. **Incremental understanding** — only changed source/dependencies trigger re-analysis.
4. **Evidence-grounded memory** — reusable knowledge remains traceable to independent source/evidence.
5. **Compiled context reuse** — repeated orientation/analysis is cached safely rather than regenerated from raw history.
6. **Weak-model leverage** — small/local models perform better because context discovery/selection is externalized.
7. **Bounded sleep** — idle maintenance improves retrieval/memory without becoming the dominant token/runtime cost.
8. **Measurable retrieval** — context acquisition quality can be benchmarked separately from model generation quality.
9. **Explainability** — operators can inspect why context was selected, rejected, stale or promoted.
10. **Mechanization over prompt growth** — repeated model work becomes deterministic Tools/Guards/Workflows where appropriate.

## Definition of success

HISTOS should not be judged by memory count, graph size, embedding count or feature count.

The primary measure is:

> **Does it increase verified progress per unit of model context and human attention while preserving authority and provenance boundaries?**

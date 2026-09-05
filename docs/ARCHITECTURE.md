# HISTOS-Fabric Architecture

Status: **TARGET ARCHITECTURE / NOT YET IMPLEMENTED**

Updated: 2026-09-06 JST

## Purpose

HISTOS-Fabric is intended to be a shared local Context Substrate for disposable agents and multiple harnesses.

Its core problem is simple:

> Large repositories, documents, logs, memories and evidence should be usable by agents without being copied proportionally into active model context.

The target system keeps durable information outside models, derives reusable indices and compiled representations, and returns only a bounded `Context Capsule` for the current task.

HISTOS is not a Mission state machine, not a generic agent framework, and not a replacement for source repositories.

## 1. Architectural position

```text
              source repositories / docs / runtime observations
                              |
                              v
+---------------------------------------------------------------+
|                         HISTOS-Fabric                         |
|                                                               |
|  Source adapters      Memory          Evidence                |
|       |                  |                |                    |
|       +---------> candidate context <----+                    |
|                          |                                    |
|                    Context Compiler                           |
|                          |                                    |
|                  bounded Context Capsule                      |
|                          |                                    |
|      indexes / cache / graph / externalized artifacts         |
|      compiled understanding / bounded consolidation           |
+--------------------------+------------------------------------+
                           |
          +----------------+----------------+
          |                |                |
        Codex          OpenCode        EPHEMERA Harness
                                             |
                                      bounded evidence
                                             |
                                             v
                                      EPHEMERA-System
                                   Mission/authority owner
```

HISTOS may serve EPHEMERA-System, but it must remain useful to ordinary Codex/OpenCode work independently of an active EPHEMERA Mission.

## 2. Separation of durable information classes

HISTOS should not collapse all information into one store or one authority class.

### 2.1 Source

Examples:

- Git repositories;
- source files;
- documentation;
- long PDFs/manuals;
- current diffs;
- current runtime/provider observations;
- external project-owned state.

Source remains owned by its source system. HISTOS can index, cache and cite it but does not silently become its canonical owner.

### 2.2 Evidence

Examples:

- test results;
- immutable receipts;
- artifact hashes;
- command exit results;
- verified runtime observations;
- accepted execution traces where explicitly retained.

Evidence supports claims. A summary of evidence is not itself equivalent evidence.

### 2.3 Memory

Candidate classes:

```text
working      cycle/session-local context

episodic     what happened in a prior bounded operation

semantic     generalized reusable knowledge

decision     rationale and alternatives for durable choices

failure      recurring failure classes and known prevention boundaries

procedural   repeatable procedures not yet reduced to deterministic tools
```

Memory should point to evidence/source where possible.

### 2.4 Derived state

Examples:

- lexical indices;
- vector embeddings;
- graph indices;
- symbol maps;
- section trees;
- ranking features;
- compiled-understanding caches;
- usage/access statistics.

Derived state must be rebuildable and must not silently become canonical truth.

## 3. Source is not context

A repository may contain millions of lines while the model receives only a few thousand tokens.

The selection pipeline should conceptually follow:

```text
large source space
    |
    v
cheap deterministic narrowing
    |
    +-- current diff
    +-- exact names / lexical search
    +-- structural map
    +-- symbols / imports / calls
    +-- section hierarchy
    +-- prior verified dependency links
    |
    v
candidate set
    |
    v
hybrid ranking / policy filters
    |
    v
budget allocation
    |
    v
Context Capsule
```

Use expensive model reasoning after deterministic narrowing where possible, not as the first repository-discovery mechanism.

## 4. Progressive disclosure

Every adapter should support the cheapest useful representation first.

A source may expose:

```text
L0  source identity / synopsis
L1  repository or document outline
L2  file/section/symbol signatures
L3  focused implementation or matched fragments
L4  exact raw lines / full evidence artifact
```

A worker should descend only as far as needed.

For code this may map to:

```text
repo map -> file outline -> symbols -> references -> exact body
```

For documents:

```text
TOC/tree -> section summary -> matched section -> exact pages/lines
```

For memory:

```text
memory node synopsis -> supporting observation -> exact episode/evidence
```

## 5. Context Capsule

A Context Capsule is the bounded materialized context supplied to one task/role.

A future typed contract might contain:

```json
{
  "schema": "histos.context-capsule/v1",
  "goal": "...",
  "scope": {},
  "budget": {
    "max_tokens": 4000,
    "rendered_tokens": 3180
  },
  "current_truth_refs": [],
  "source_map": [],
  "source_fragments": [],
  "memory": [],
  "known_failures": [],
  "procedures": [],
  "evidence_refs": [],
  "open_questions": [],
  "selection_receipt": {}
}
```

The exact schema is not frozen.

Required design properties:

- bounded size;
- stable provenance refs;
- explainable inclusion/exclusion;
- current-truth refs visibly separated from recalled history;
- sufficient coordinates to reopen exact material;
- source/dependency identity for cache validation;
- no hidden assumption that the Capsule is exhaustive.

## 6. Context budgets

Context should be budgeted as an explicit resource.

A Capsule budget may be allocated across classes, for example:

```text
4000 tokens total

  500  Goal / current constraints
  500  current truth / diff
 1600  source fragments
  600  memory / known failures
  400  procedures
  400  evidence summaries / references
```

These ratios are policy inputs, not universal constants.

The compiler should record both requested and actual allocation so later evaluation can answer whether extra tokens improved verified results.

## 7. Hybrid retrieval

No single retrieval family should be treated as sufficient for every task.

Candidate signals:

- lexical / exact term match;
- structural code relationships;
- file/symbol import and call relationships;
- current Git diff;
- co-change history;
- section/document hierarchy;
- semantic embeddings;
- temporal/graph memory relations;
- prior verified task-to-source relationships;
- scope/version/runtime match;
- confidence/provenance;
- recency/freshness requirements.

The final ranking should remain explainable enough to surface `why included?`.

## 8. Oversized result externalization

Large tool/source outputs should not remain indefinitely in active context.

Target pattern:

```text
large result
   |
   v
persist exact artifact
   |
   +--> stable ref / hash / source identity
   +--> compact preview
   +--> search/read coordinates
   |
   v
small context placeholder
```

Candidate primitives:

```text
context.externalize(result, retention, preview_budget)
context.search(ref, query, budget)
context.read(ref, range, budget)
```

Exact values must remain recoverable when needed for verification.

## 9. Compiled understanding

Repeatedly re-deriving the same architecture or dependency explanation is wasteful.

HISTOS should eventually cache higher-level understanding that is explicitly bound to source/dependency identity.

Example:

```text
source SHA(s)
  + inspected scope
  + dependency identities
  + evidence refs
        |
        v
compiled understanding
```

A compiled object must state:

- what source identity it represents;
- what was inspected;
- what was not inspected;
- supporting evidence refs;
- confidence/status;
- dependencies used for invalidation;
- creation/last verification time;
- whether fresh live read is still required.

A source hash or relevant dependency change should invalidate or stale only the affected object where possible.

## 10. Incremental understanding

The system should optimize for deltas.

```text
old source identity
       +
new diff / changed hashes
       |
       v
changed symbols / sections / dependent neighborhoods
       |
       v
partial invalidation / re-analysis
```

Do not reprocess a 100k-line repository merely because 200 lines changed.

Cold-start and warm-cache costs should be measured separately.

## 11. Memory provenance and anti-poisoning

A critical invariant:

> Retrieval is not corroboration.

Invalid loop:

```text
memory A
  -> recalled by tool
  -> model repeats A
  -> capture pipeline treats repetition as new evidence
  -> confidence increases
```

HISTOS must retain evidence lineage and distinguish:

- user/source input;
- fresh runtime observation;
- independent test/evidence;
- retrieved memory;
- model-generated summary;
- hypothesis;
- derived/compiled material.

A retrieved memory or model restatement cannot independently increase proof count.

## 12. Consolidation / sleep

Background consolidation should be a maintenance workflow, not an unbounded reasoning loop.

Target properties:

```text
delta-driven
bounded
coalesced
debounced / rate-limited
resumable
observable
retriable
```

Candidate operations:

- deduplicate episodes;
- cluster repeated operations;
- update links;
- identify contradictions/drift;
- decay recall priority where appropriate;
- propose semantic/procedural memory;
- update compiled understanding;
- rebuild/compact derived indices;
- emit repeated-work candidates.

Small deltas must not trigger full-memory or full-model rebuilds.

Failed work should remain explicitly retryable rather than silently checkpointed as complete.

## 13. Repetition and automation signals

HISTOS may detect that a semantic operation is repeated and expose evidence-backed candidates.

Example:

```text
observed operation
  -> stable semantic signature
  -> occurrence / cost / failure metrics
  -> automation candidate
```

HISTOS itself must not infer authority from repetition.

A consumer such as EPHEMERA-System may decide whether a candidate becomes:

- Guard;
- test/preflight;
- Wrapper;
- Skill/workflow;
- Tool;
- scheduled Automation.

Promotion and activation are policy/authority decisions, not retrieval decisions.

## 14. Interfaces

### 14.1 Agent-facing interface

Designed for Codex/OpenCode/other harnesses.

Candidate functions:

```text
context.search
context.compile
context.read
context.explain
memory.recall
memory.capture_candidate
procedure.recall
```

Properties:

- broad read is acceptable within configured scope;
- writes are narrow and typed;
- candidate capture is not automatic promotion;
- no Mission-state mutation.

MCP is the likely common interoperability surface.

### 14.2 Privileged System interface

Used by policy/authority consumers such as EPHEMERA-System.

Candidate functions:

```text
memory.promote
memory.deprecate
memory.consolidate
scope.configure
retention.configure
candidate.review
```

Even this interface must not let HISTOS itself become canonical Mission authority.

## 15. Storage direction

Do not force every concern into one storage engine.

Candidate split:

```text
human-readable durable records
  Markdown / JSON / JSONL / typed receipts

runtime query/index state
  SQLite or equivalent local store

lexical search
  derived index

semantic retrieval
  rebuildable vector index

graph traversal
  rebuildable typed-edge/graph index

large externalized payloads
  local content-addressed artifact store

history / review
  Git for selected durable non-secret records
```

Obsidian compatibility may be useful for human inspection, but Obsidian must not be a runtime authority requirement.

## 16. Local-first daemon direction

Long-term deployment should likely be a local service/daemon rather than a library embedded separately into every harness.

Conceptually:

```text
histosd
  local state / indexes / artifact store
  MCP endpoint
  typed local API

histos CLI
  inspect / health / index / benchmark / explain
```

The implementation language and transport are not yet selected.

During early development, components may live directly in this repository as modules, but they should communicate through explicit contracts so they can become daemon-backed without rewriting every consumer.

## 17. Observability

The system should expose context-selection quality, not only final responses.

Useful metrics/read models:

```text
raw source bytes considered
raw source bytes actually opened
candidate count
selected fragments
rendered tokens
budget by category
cache/index hit rate
cold/warm latency
re-read count
externalization count
stale-context rejection
retrieval source contributions
why included / why excluded
exact provenance refs
```

This data should eventually be consumable by the EPHEMERA Console but should not depend on that UI to exist.

## 18. Success condition

HISTOS is useful when, over comparable verified tasks:

- fresh agents rediscover less;
- less raw source reaches the model;
- relevant source/evidence recall stays high;
- repeated reads fall;
- warm tasks become significantly cheaper than cold tasks;
- context remains explainable;
- stale remembered state does not override live truth;
- weak/local models gain more from the same bounded context;
- background maintenance costs remain bounded;
- repeated model work can progressively disappear behind smaller deterministic interfaces.

The primary optimization target is:

> **verified progress per unit of model context and human attention**.

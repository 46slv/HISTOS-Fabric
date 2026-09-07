# distill-kura — HISTOS Research Target

Status: **RESEARCH / BENCHMARK_TARGET**

Updated: 2026-09-08 JST

Upstream: https://github.com/lna-lab/distill-kura

## Purpose

Record `distill-kura` as a concrete research and benchmark target for HISTOS-Fabric. This document does not adopt Kura as HISTOS implementation authority. It records mechanisms already worth evaluating before HISTOS re-implements a shared memory subsystem.

## Why Kura matters to HISTOS

Kura is unusually close to several HISTOS memory-plane goals:

- durable memory outside disposable model sessions;
- evidence/provenance-aware distillation rather than raw transcript retention;
- separate read and write authority;
- MCP-accessible recall shared across different harnesses;
- background distillation from append-oriented evidence/journal inputs;
- local OpenAI-compatible model endpoints;
- persistent stores that survive client/session restarts;
- lightweight resident map / recall flow rather than loading full memory history into every prompt.

The strongest architectural overlap is the separation:

```text
harness/session evidence
        -> distillation
        -> durable shared memory
        -> read-only recall by later agents
```

while active execution state remains outside the memory system.

## Local experimental evidence available

A Kura deployment external to HISTOS has already demonstrated a first-usable cross-harness path on Windows. This is useful experimental evidence, but it is **not** evidence that HISTOS itself implements these capabilities.

Observed result set as of 2026-09-08:

- Codex and OpenCode connected to one shared Kura store through read-only MCP clients;
- shared store configured with `distiller-only` writes;
- Codex and OpenCode events normalized into an evidence journal;
- duplicate ingestion prevented by adapter watermark/seen state;
- Codex-origin memory recalled from OpenCode;
- OpenCode-origin memory semantically recalled from Codex;
- memory remained recallable after Kura restart;
- shared MCP did not expose direct `remember` mutation;
- local model roles were split into a small recall thinker and a larger brain/scribe after an initial context-overflow failure.

Known incomplete or negative evidence:

- HISTOS itself is not integrated with Kura yet;
- Dev Exec / Local Worker ingestion is not connected yet;
- Windows logon-trigger end-to-end recovery has not yet been proven;
- at least one failed OpenCode distillation batch was intentionally retained as non-retryable evidence rather than silently discarded;
- local-model distillation cost/latency remains a practical design concern.

## Boundary to preserve

Kura must not be treated as a Mission/Goal/Run ledger.

```text
EPHEMERA / owning runtime
  -> current Mission / Goal / Run / retry / authority state

Kura-like memory plane
  -> reusable evidence-derived memory

HISTOS
  -> context/memory/evidence substrate and context compilation
```

Fresh repository/runtime/System state must continue to outrank remembered material when freshness matters. Retrieved memory is not independent evidence and must not self-corroborate.

## Candidate role inside HISTOS

Kura should be evaluated in at least three roles before HISTOS builds an equivalent subsystem from scratch:

1. **External memory backend**
   - HISTOS compiles context using Kura recall as one source adapter.

2. **Reusable memory/distillation component**
   - HISTOS adopts selected Kura contracts or implementation pieces while retaining HISTOS provenance/freshness/authority semantics.

3. **Benchmark target**
   - HISTOS memory prototypes are compared against Kura on recall quality, provenance recovery, background cost and failure handling.

Do not choose among these roles from conceptual similarity alone.

## Research questions

### Memory authority and provenance

- What exactly does a Kura manifest prove, and what does it not prove?
- Can HISTOS preserve exact evidence descent through Kura-derived memories?
- How are conflicting, superseded or stale memories represented and ranked?
- Does Kura's evidence gate prevent self-corroboration strongly enough for HISTOS requirements?

### Recall behavior

- How does direct/exact recall differ from semantic thinker-assisted recall as store size grows?
- What are false-positive, false-negative and abstention rates on real coding memories?
- How much resident map/prefix context is required as memory count grows?
- Can recall remain useful under fixed 2k/4k/8k context budgets?

### Distillation and background operation

- What is the cost per useful promoted memory?
- How should thinker / brain / scribe model sizes and context windows be selected?
- How should pending, retryable and terminal failures be surfaced and repaired?
- Can `tend` remain delta-driven, bounded and observable over long-running use?

### Multi-harness integration

- Can Codex, OpenCode, EPHEMERA and local workers share one memory plane without sharing raw conversation state?
- Which adapter/event schema should HISTOS own versus delegate to Kura?
- Can harness-specific event changes be isolated behind stable canonical evidence contracts?

### Trust and deployment

- What process/store boundaries are required when Kura's local HTTP surface is used?
- What authentication or capability layer should HISTOS add if access expands beyond loopback/local trusted processes?
- Can read-wide/write-narrow remain mechanically enforced across all clients?

## Benchmark direction

A future HISTOS bake-off should compare at minimum:

```text
file-native HISTOS prototype
Kura shared memory
simple lexical/BM25 memory baseline
optional embedding/vector baseline
```

Measure:

```text
verified recall success
false recall / abstention
source-provenance recovery
stale-memory handling
duplicate promotion rate
background model cost / latency
recovery after restart
pending/failure visibility
active-context tokens consumed
human intervention
```

## Adoption rule

Current classification: `BENCHMARK_TARGET`.

Promotion to `EXPERIMENTAL_ADAPTER`, `REUSABLE_COMPONENT_CANDIDATE` or `ADOPTED_COMPONENT` requires explicit HISTOS-side evidence. The existing external Codex/OpenCode PoC is valuable prior evidence but does not by itself grant Kura architectural authority inside HISTOS.

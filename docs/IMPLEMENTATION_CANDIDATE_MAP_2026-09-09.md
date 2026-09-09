# HISTOS implementation candidate map — 2026-09-09

Status: **LIVE REPOSITORY MAP / CANDIDATE STATUS ONLY**

## Purpose

Keep research/design documents aligned with code that already exists on non-main branches. This map does not promote a branch to canonical `main`, accept an independent review, or claim production readiness.

## Current lines

| Line | Exact ref | What it currently proves |
| --- | --- | --- |
| Canonical repository landing/research line | `main@d500d9c672afbe3cce6b7c76b9ec8488fbd7acdb` | Architecture/research router plus Kura/TeamAI research targets. No runtime is claimed by `main`. |
| Detailed design history | Draft PR #1 `3a5465b3e1ccb1a9da9533bf4b72e9e43f353dea` | v0 service/data/security/memory/recovery contracts and test specification. Its material is carried forward by the current synthesis branch; do not implement from PR #1 without checking the newer update. |
| First executable H0/H1 line | Draft PR #2 `e0cbdc2197ba3055ce02f030a2e93a03f1467b6f` | Synthetic retrieval benchmark, content-addressed externalization, exact reopen/search and measurement candidates with focused Node tests. |
| Advanced program-delivery candidate | `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30` | Eight commits ahead of PR #2 head; adds source index/Context Compiler, shared service/MCP, memory/compiled understanding, bounded sleep, typed relationships, operation candidates and retrieval-policy experiments. Component contracts still carry explicit experimental/acceptance boundaries. |
| Program aggregate-test repair | Draft PR #3 `5135ef4e65f906534d7348797b2a06481394667d` | Adds omitted delivered suites to the program branch aggregate `npm test`; full cloud execution was not claimed by that PR. |
| Current research/design synthesis | Draft PR #4 | Reconciles current research with the older detailed design and this implementation map; documentation only. |

`program/ephemera-full-20260908-delivery` is a direct descendant of the PR #2 head: repository comparison reports it **8 commits ahead / 0 behind**. Treat it as the current advanced implementation candidate lineage, not an unrelated prototype.

## Candidate capability map

### H01 — artifacts, source index and Context Compiler

Contract: `docs/H01_COMPONENT_CONTRACT.md` on the program branch.  
Status there: **EXPERIMENTAL IMPLEMENTATION**.

Implemented candidate surfaces include:

```text
externalizeIfOversized / externalizePayload / readArtifact / searchArtifact
buildSourceIndex / loadSourceIndex / searchSourceIndex / readIndexedRange
compileContextCapsule
```

Important properties already encoded in the candidate:

- immutable SHA-256 externalized bytes and bounded reopen;
- explicit source inventory/scope/snapshot digest;
- lexical + initial structural outline/indexing;
- exact fresh source reread before Context compilation;
- deterministic ranking/budget omissions;
- full `rendered_context` token counting under a pinned tokenizer contract.

Research implication: do **not** restart H0/H1 from a blank design. New provider/event work must preserve or adapt these boundaries and benchmark against them.

### H02 — shared local service and MCP

Contract: `docs/H02_SERVICE_CONTRACT.md`.  
Status there: **EXPERIMENTAL IMPLEMENTATION / native evidence awaiting independent acceptance**.

The candidate already has:

- one local profile daemon bound to loopback;
- profile capability + exact instance identity;
- stdio MCP bridge for multiple clients;
- four read-only tools: `context_search`, `context_read`, `context_compile`, `context_explain`;
- explicit scope/snapshot on every operation;
- controlled restart and explicit index refresh;
- bounded telemetry without query/source text.

The contract records bounded 2026-09-08 native observations from Codex CLI 0.153.4 and OpenCode 1.18.29 against one shared daemon, including all four tools, identical source hashes/selection and out-of-scope refusal. These observations are not universal client/production acceptance.

Research implication: **assisted MCP is no longer only a future design idea.** Provider integration should extend this service contract or prove why a replacement is better.

### H03 — evidence memory and compiled understanding

Contract: `docs/H03_COMPONENT_CONTRACT.md`.  
Status there: **EXPERIMENTAL IMPLEMENTED CANDIDATE — independent review required**.

The native memory candidate already implements many invariants that the Kura research was meant to motivate:

- immutable checksummed memory records;
- history/non-authority (`authority: none`, `current_truth: false`);
- host-injected `verifyProvenance` for verified records;
- canonical full-claim hash bound to evidence/scope/relations;
- supporting provenance groups deduplicated by source-owned lineage/origin/identical evidence bytes;
- model restatements, retrieved memory, compiled material and hypotheses excluded from independent support;
- contradiction and supersession handling, including write-ahead tombstones that avoid resurrecting an obsolete record;
- dependency-addressed compiled-understanding candidates and precise stale invalidation.

Research implication: the new `MemoryProvider` abstraction should treat this code as **NativeMemoryProvider candidate zero**, not delete it. Kura should be compared as an alternate Memory/Distillation provider, especially for model-assisted extraction/grounding, while preserving H03's host-trust boundary.

### H04 — bounded Sleep

Contract: `docs/H04_SLEEP_CONTRACT.md`.  
Status there: **IMPLEMENTED COMPONENT CANDIDATE; HOST/SCHEDULER ACCEPTANCE PARTIAL**.

The candidate is intentionally deterministic and model-free. It provides:

- persistent delta/event queue;
- coalescing by resource while preserving accepted input lineage;
- resource/declared-byte/admission-time limits;
- retry/defer visibility;
- single-writer lock, integrity envelope, synced temp + atomic rename;
- fencing/recovery constraints;
- source-owned suppression index so superseded history is not revived;
- all outputs remain `sleep_candidate`, non-authoritative/current-truth false.

Research implication: a Kura/LLM `DistillationProvider` should run **under or beside this bounded maintenance control**, not replace the deterministic queue/recovery layer with an unbounded model loop.

### H06 — typed relationship retrieval

Contract: `docs/H06_RELATIONSHIP_CONTRACT.md`.  
Status there: **BOUNDED IMPLEMENTED CANDIDATE**.

The candidate already provides bounded typed `contradicts`/`supersedes` traversal with exact record/source identity, cycle handling, traversal/result/visited budgets and a held-out lexical comparison surface.

Research implication: a future Graphiti/graph backend is optional. It must show incremental value over this small typed relationship baseline rather than being adopted because a graph is architecturally attractive.

### A00 — operation/automation candidates

Contract: `docs/A00_OPERATION_CANDIDATE_CONTRACT.md`.  
Status there: **BOUNDED IMPLEMENTED CANDIDATE**.

The candidate encodes semantic signatures, repeated-work metrics and the explicit lifecycle:

```text
OBSERVED -> REPEATED -> CANDIDATE -> SHADOW -> VERIFIED
```

There is deliberately no `ACTIVE` authority. Shadow execution is typed/bounded and independent verification is required before VERIFIED. Actual activation remains external.

Research implication: Agent Skill Projection can become one **post-verification projection path**, but should not bypass A00/H03 evidence or consumer-owned activation.

### A01 — retrieval-policy experiments

Contract: `docs/A01_RETRIEVAL_POLICY_CONTRACT.md`.  
Status there: **BOUNDED IMPLEMENTED CANDIDATE**.

The candidate already has sealed policies, restricted tunable parameters, fixed safety/provenance boundaries, development/held-out evidence-backed comparisons, regression rejection and baseline rollback receipts. It does not install a selected policy.

Research implication: TeamAI/Kura signals may add candidate features or benchmark cases, but HISTOS does not need a second unconstrained self-tuning engine.

## Reconciliation with the 2026-09-09 provider design

The provider architecture is a **modularization/evaluation boundary over existing candidates**, not a greenfield rewrite:

```text
HISTOS Kernel candidate
  H01 snapshot/index/compiler
  H02 service/scope/read-only MCP
  H04 bounded maintenance control
  H03 trust/revision semantics
        |
        +-- Native Retrieval/Memory providers (existing candidates)
        +-- Experimental Kura Memory/Distillation provider
        +-- optional graph/vector/document providers
        +-- Agent Skill Projection provider
```

The exact ownership may move after experiments, but migration should be incremental and parity-proven. Reusing a provider must not discard the stronger existing H03 provenance/supersession gates merely because the provider has its own memory model.

## Documentation rule going forward

Every future research/design note that proposes a capability must check this map first and classify the proposal as one of:

```text
NEW CAPABILITY
REPLACEMENT CANDIDATE
PROVIDER/ADAPTER OVER EXISTING COMPONENT
HARDENING OF EXISTING COMPONENT
BENCHMARK/QUALIFICATION ONLY
```

This avoids repeatedly designing already-implemented candidates and keeps research useful to the implementation line.

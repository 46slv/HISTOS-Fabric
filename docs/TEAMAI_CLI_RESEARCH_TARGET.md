# Tencent TeamAI CLI — HISTOS Research Target

Status: **RESEARCH**

Updated: 2026-09-08 JST

Source: https://github.com/Tencent/teamai-cli

## Purpose

Track Tencent `teamai-cli` as an external prior-art and benchmark target for HISTOS-Fabric.

This document does not adopt TeamAI as a HISTOS component. It records the mechanisms that should be inspected, reproduced or benchmarked before HISTOS implements overlapping behavior.

## Why TeamAI matters to HISTOS

TeamAI is not primarily a standalone coding agent. It is a Git-backed shared layer that distributes common agent resources across multiple coding harnesses and closes a learning loop around those sessions.

Relevant surfaces include:

- shared Skills / Rules / Docs / env / agents / hooks / MCP configuration;
- cross-harness distribution into Codex, Claude Code, Cursor, OpenCode and related tools;
- session-start synchronization;
- reusable `learnings` and recall;
- friction-based learning triggers from interrupts, corrections, denied/retried tool calls and similar signals;
- promotion of accumulated learnings into more formal Skills / Rules / Docs;
- codebase import and `teamwiki` graph generation;
- BM25 plus code-graph-assisted retrieval;
- session / usage / knowledge-health telemetry.

These overlap directly with HISTOS questions around shared memory, context retrieval, knowledge promotion, multi-harness access and self-improvement evidence.

## Conceptual correspondence

```text
TeamAI                              HISTOS direction
---------------------------------------------------------------
shared Git resources          ->   durable shared substrate
learnings                     ->   memory/finding candidates
recall                        ->   retrieval / context acquisition
teamwiki / code graph         ->   structured repository context
friction trigger              ->   distillation / learning trigger
learning promotion            ->   finding -> rule / Skill / guard
SessionStart pull             ->   session bootstrap / context refresh
multi-harness adapters        ->   provider/harness-facing adapters
usage/session telemetry       ->   improvement and retrieval evidence
```

## Important boundary

TeamAI's similarities do not make it a canonical HISTOS memory authority.

HISTOS currently preserves stronger requirements around:

- exact provenance back to source/evidence;
- freshness and scope;
- anti-self-corroboration;
- rebuildable derived indexes;
- narrow write authority;
- explicit promotion from candidate memory to authoritative knowledge;
- separation of retrieved knowledge from current live truth.

TeamAI should therefore be treated as prior art and a candidate adapter/component source, not as an assumed replacement for the HISTOS authority model.

## High-value mechanisms to inspect

### 1. Cross-harness resource compiler

Study how one shared representation is translated into native Codex / Claude / Cursor / OpenCode configuration without losing ownership, precedence or uninstallability.

Questions:

- what is the canonical shared schema?
- how are user scope and project scope merged?
- how are conflicts handled?
- how are injected resources tracked and removed?
- can the same pattern expose HISTOS retrieval to several harnesses without duplicating memory stores?

### 2. SessionStart synchronization

Study automatic pull/bootstrap behavior as a reference for keeping disposable agent sessions current without embedding all durable knowledge in the prompt.

Benchmark against HISTOS progressive disclosure rather than assuming full resource sync is desirable.

### 3. Friction-based learning trigger

TeamAI attempts to avoid learning from every long session and instead uses interaction friction as a signal that a session may contain reusable knowledge.

Potential HISTOS hypothesis:

```text
raw session/event stream
  -> low-cost friction detector
  -> candidate extraction only for high-value sessions
  -> provenance-preserving review/distillation
```

Evaluate false positives, false negatives and whether friction should be only one signal among verifier failures, repeated work, outcome delta and user correction.

### 4. Learning promotion

Study how TeamAI promotes accumulated learnings into more formal agent resources.

Compare with HISTOS lifecycle:

```text
source/evidence
  -> observation/finding
  -> repeated supported pattern
  -> promoted knowledge / Skill / guard
```

The critical question is whether promotion retains sufficient source identity and counterevidence to prevent unsupported self-reinforcement.

### 5. Recall and code-graph boost

Benchmark TeamAI recall against lexical-only, structural and hybrid HISTOS baselines.

Measure whether graph-assisted ranking improves relevant evidence acquisition under fixed context budgets rather than only improving top-k retrieval metrics.

### 6. Knowledge health and intervention telemetry

Study the use of silent/unused knowledge, recall activity, correction/intervention signals and session telemetry as health metrics.

HISTOS should prefer measures such as verified progress per model-context token and human correction rate over raw knowledge volume.

## Risks / gaps to verify in source

- whether provenance survives learning -> promotion transformations;
- whether shared config generation can leak or persist resolved secrets;
- hook/config ownership and cleanup behavior;
- concurrent Git update / MR conflict behavior;
- user-scope vs project-scope precedence;
- knowledge poisoning or circular self-confirmation defenses;
- retrieval ranking details and graph freshness;
- operational cost of code graph / telemetry / dashboard maintenance.

## Proposed experiments

### Experiment T1 — recall bake-off

Use the same repository tasks and context budgets to compare:

```text
HISTOS lexical baseline
HISTOS structural baseline
TeamAI recall
TeamAI graph-assisted recall
hybrid HISTOS candidate
```

Measure relevant-source acquisition, verification success, context tokens, latency and stale-source rate.

### Experiment T2 — friction trigger quality

Replay real coding sessions with known reusable outcomes and classify whether TeamAI-style friction signals would have selected the correct sessions for distillation.

Measure precision/recall and cost avoided versus processing every session.

### Experiment T3 — multi-harness bootstrap

Prototype one small shared resource and distribute it to Codex and OpenCode through a TeamAI-style adapter.

Measure:

- deterministic install/remove;
- precedence behavior;
- drift detection;
- secret exposure;
- startup context overhead.

### Experiment T4 — promotion provenance

Trace one learning from raw session evidence through promotion to a formal rule/Skill and check whether the final artifact can still descend to exact supporting and counter evidence.

## Adoption posture

Current state:

```text
BENCHMARK_TARGET
REFERENCE_ONLY
```

Possible future states:

```text
EXPERIMENTAL_ADAPTER
REUSABLE_COMPONENT_CANDIDATE
```

Do not move to an adopted HISTOS component until source inspection and local experiments show that the mechanism improves verified progress without weakening provenance, freshness or authority boundaries.

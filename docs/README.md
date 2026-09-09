# HISTOS-Fabric Documentation

Status: **BOOTSTRAP / RESEARCH ROUTER**

This directory records the current target boundary, ecosystem relationships, research basis and development goals for HISTOS-Fabric. Documentation must distinguish future intent from implemented/runtime-proven behavior.

## Read first

1. [`ARCHITECTURE.md`](ARCHITECTURE.md)
   - target Context Substrate architecture;
   - Context Capsule and progressive-disclosure model;
   - provenance, freshness, externalization, indexing and consolidation invariants;
   - agent-facing versus privileged interfaces.

2. [`ECOSYSTEM_RELATIONSHIPS.md`](ECOSYSTEM_RELATIONSHIPS.md)
   - HISTOS-Fabric versus EPHEMERA-System;
   - HISTOS-Fabric versus EPHEMERA Harness;
   - direct Codex/OpenCode use;
   - project repositories, Dev Exec, Git/Obsidian and other adapters.

3. [`ROADMAP.md`](ROADMAP.md)
   - bounded implementation sequence;
   - milestone acceptance criteria;
   - what not to build too early;
   - long-term development goals.

4. [`RESEARCH.md`](RESEARCH.md)
   - existing systems and mechanisms to investigate;
   - extracted design lessons;
   - benchmark/evaluation direction;
   - adoption rules.

## Executable candidates

These surfaces are runnable **experimental candidates**, not stable service/runtime authority:

- [`../bench/README.md`](../bench/README.md) — H0 deterministic retrieval benchmark scaffold with fixed byte budgets, exact source identity/reopen coordinates and machine-readable metrics.
- [`CONTEXT_CONTRACT_V1.md`](CONTEXT_CONTRACT_V1.md) — H00 public frozen-corpus benchmark, independent gold receipt, 2k/4k/8k token profiles and exact source/capsule contracts; explicitly limited measurement coverage.
- [`EXTERNALIZATION_V0.md`](EXTERNALIZATION_V0.md) — Phase-1 content-addressed oversized-result externalization, bounded reread and search boundary.
- [`H01_COMPONENT_CONTRACT.md`](H01_COMPONENT_CONTRACT.md) — Phase 1-3 public APIs for incremental source identity, lexical/structural retrieval, exact reopen and budgeted Context Compiler.
- [`H01_EVALUATION.md`](H01_EVALUATION.md) — frozen public baseline comparison with development/held-out separation and measured source exposure.

Their exact implementation/tests are authoritative for claims made by those candidates. They do not imply that the daemon, MCP surface, memory backend, automatic retention/GC policy or production integration exists.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Exists in HISTOS code and has named tests/runtime evidence. |
| `ACCEPTED DESIGN` | Design/contract is approved but may not yet be fully implemented. |
| `TARGET ARCHITECTURE` | Intended direction; implementation may be partial or absent. |
| `BOOTSTRAP` | Repository/contract setup before a stable runtime exists. |
| `RESEARCH` | Investigation or evaluation only; not runtime authority. |
| `EXPERIMENTAL` | Runnable candidate without stable/production authority. |
| `DEPRECATED` | Present but should not be selected for new work. |
| `SUPERSEDED` | Replaced by a named newer authority/source. |

## Source precedence

For current facts, prefer:

```text
fresh source repository/runtime/System state
  > immutable evidence / receipts
  > implemented HISTOS contracts/tests
  > accepted architecture
  > target architecture
  > research notes
```

A remembered or compiled representation must not override fresh live state when freshness matters.

## Writing rule

Substantial documents should state:

- what responsibility they own;
- whether they describe implementation or intent;
- what evidence supports current implementation claims;
- what they explicitly do not own;
- what external source remains authoritative where relevant.

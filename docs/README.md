# HISTOS-Fabric Documentation

Status: **BOOTSTRAP / RESEARCH ROUTER**

This directory records the current target boundary, ecosystem relationships, research basis and development goals for HISTOS-Fabric. Documentation must distinguish future intent from implemented/runtime-proven behavior.

## Detailed v0 design

Start with [`design/v0/README.md`](design/v0/README.md) when preparing implementation: process/API boundaries, integration grades, data ownership/recovery, scope/privacy, memory/consolidation, proposed wire schemas and H0-H9 delivery gates. Read only the relevant owner documents. The package is **DRAFT DESIGN**, not accepted architecture or a working runtime; static fixture validation is separate from runtime conformance.

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

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | Exists in HISTOS code and has named tests/runtime evidence. |
| `DRAFT DESIGN` | Concrete proposal and contract fixtures; not accepted or implemented. |
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

# HISTOS Provider and Projection Architecture

Status: **PROPOSED / NOT IMPLEMENTED**

Updated: 2026-09-09

## Purpose

Keep HISTOS reusable across Codex, OpenCode, EPHEMERA and future harnesses without forcing one memory store, parser, vector engine or Skill distributor to become permanent core architecture.

## 1. HISTOS Kernel ownership

The Kernel owns the semantics that must survive provider replacement:

- authenticated principal and effective scope;
- destination/provider egress policy;
- source/worktree snapshot identity;
- immutable artifact/evidence references;
- Evidence Event normalization and replay identity;
- current-truth versus historical/derived classification;
- Context Compiler budget/policy and selection receipts;
- provider registry, capability negotiation and health state;
- provider-output provenance/grounding envelope;
- accepted revision/projection ownership metadata;
- audit of which provider/version produced what.

The Kernel does **not** require one built-in embedding model, graph database, memory store or harness configuration format.

## 2. Provider classes

### SourceProvider

Provides authorized source identity, snapshot, outline/read/search and exact reopen operations for one source type. Examples: Git worktree, long document, runtime receipt archive.

### RetrievalProvider

Produces bounded candidates from an authorized snapshot or memory space. Examples: lexical/BM25, symbol graph, embeddings, code graph, temporal graph. It cannot expand the caller's scope.

### MemoryProvider

Stores/reads durable recallable memory under provider-neutral scope/provenance requirements. It returns stable provider refs plus enough metadata for HISTOS to classify freshness, support and contradictions.

A MemoryProvider is not canonical live project state.

### DistillationProvider

Consumes eligible Evidence Events and proposes memory/procedure candidates. It returns candidate bodies plus a **grounding receipt**:

```text
provider + version
input event refs / artifact refs
surviving evidence refs/classes
claims or sections grounded by them
judgement/inference markers
rejected/echoed inputs where available
cost / model profile where applicable
```

The provider cannot set final `VERIFIED`/`ACTIVE` authority by wording its result that way.

### ProjectionProvider

Renders one approved knowledge/procedure revision into a consumer artifact, for example an Agent Skill package or harness-specific rule/config. Projection is a materialized view with an owner manifest, not a second editable source of truth.

## 3. Capability model

Providers advertise explicit capabilities such as:

```text
read
search
snapshot
capture_candidate
distill
write_direct
admin
semantic_rerank
external_model_use
projection
```

HISTOS intersects provider capability with owner policy and caller grant. Absence from an MCP tool listing is not a security boundary; privileged operations must be rejected at the service/provider boundary too.

A provider version or configuration change that can alter meaning is part of derived-output identity. Health degradation is visible; no silent provider/model substitution.

## 4. Provider-output normalization

Every returned item is classified as one of:

```text
current_source_observation
retained_evidence
recalled_memory
compiled_understanding
provider_judgement
hypothesis
procedural_revision
```

The provider cannot make recalled memory become fresh observation simply by returning it from a tool. HISTOS preserves the original lineage through Context Capsule rendering and later capture.

For candidate memory, a provider with a deterministic grounding floor is preferable. `distill-kura` is a high-value experimental provider because its current source mechanically checks quotations against raw classes, suppresses store echoes, constrains claim classes and rechecks model-written final surfaces. Those properties should be tested through the HISTOS contract rather than copied blindly.

## 5. Experimental Kura mapping

Candidate mapping:

```text
Kura store / MCP
  -> MemoryProvider.read / recall
Kura distillation gate
  -> DistillationProvider
Kura evidence/journal adapter
  -> Evidence Event consumer
Kura map/glance
  -> compact memory synopsis / exact memory read
```

Initial integration is read-only. HISTOS should test store binding, scope isolation, empty/abstention behavior, provenance descent, echo suppression and restart recovery before write/distillation authority is enabled.

Kura remains replaceable. Its memory slug, internal index or model prompt is not the HISTOS public contract.

## 6. Projection pipeline

```text
verified/provisionally-approved procedural revision
        |
        v
Projection request
  target family + scope + expected revision
        |
        v
portable renderer where possible
        |
        +--> Agent Skill package
        |
        +--> harness-specific thin metadata/install adapter
        v
Projection manifest
  source revision
  target path/location
  rendered file hashes
  target/harness compatibility
  installation time
  previous managed projection
```

Updates use compare-and-swap against the managed projection. User modifications create drift/conflict; HISTOS does not overwrite them silently. Uninstall removes only files owned by that projection manifest.

## 7. Agent Skills as preferred procedural projection

For procedures that fit the open Agent Skills model, render:

```text
<skill>/
  SKILL.md
  references/   only as needed
  scripts/      deterministic helpers when justified
  assets/       output resources only when justified
```

The core procedural body should be the same across supported harnesses. Consumer adapters choose a supported installation location and optional UI/invocation metadata. Do not encode a live branch SHA, temporary Mission status, secrets or broad permissions into the Skill just because those facts were present during learning.

A Skill is appropriate for reusable bounded judgement/procedure. A deterministic operation still belongs in a script/tool/guard; HISTOS may project a Skill that routes to that tool rather than reproduce the algorithm in prose.

## 8. TeamAI lessons for projection/distribution

TeamAI demonstrates that shared resources can be distributed across multiple harnesses and that active recall may outperform dumping all knowledge at SessionStart. HISTOS should borrow the **compiler/adapter shape**, not assume every TeamAI resource category must become HISTOS-owned.

Particularly avoid coupling epistemic confidence to recall votes. Usage can influence routing/maintenance priority, while evidence support remains a separate ledger.

## 9. Provider admission gates

Before a provider becomes default for a capability:

- exact version/source checked;
- license/deployment/privacy reviewed;
- scope/capability negative tests pass;
- restart/recovery behavior measured where stateful;
- output lineage can be represented without information loss required by HISTOS;
- benchmark shows incremental utility versus the simpler provider it would replace;
- fallback is explicit and does not broaden access or silently change model/provider.

Provider state can be `REFERENCE -> EXPERIMENTAL -> QUALIFIED -> DEFAULT -> DEPRECATED`. Qualification is per capability/scope, not a universal endorsement of the whole upstream project.

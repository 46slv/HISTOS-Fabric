# HISTOS-Fabric Ecosystem Relationships

Status: **TARGET ARCHITECTURE / NOT YET IMPLEMENTED**

Updated: 2026-09-06 JST

## Purpose

Define how HISTOS-Fabric relates to EPHEMERA-System, EPHEMERA Harness, Dev Exec/chatgpt-mcp, Codex, OpenCode, independent project repositories and human-facing knowledge tools.

The goal is to prevent a shared context/memory service from accidentally becoming a second control plane or a project-specific monolith.

## 1. Core responsibility split

```text
EPHEMERA-System
  owns durable Mission continuity and authority

HISTOS-Fabric
  owns reusable context/memory/evidence substrate mechanisms

EPHEMERA Harness
  owns bounded disposable Task/Cycle execution

Codex / OpenCode / other agents
  consume HISTOS directly for everyday work

Project repositories / runtimes
  remain authoritative for their own current facts
```

## 2. EPHEMERA-System <-> HISTOS-Fabric

### EPHEMERA-System owns

- Mission / Goal / Task / Run identity and lineage;
- canonical Mission state;
- transition authority;
- leases, retry, recovery and scheduling;
- provider/model/harness routing policy;
- authority and permission decisions;
- Mission Governance;
- cross-cycle acceptance;
- whether a repeated-work candidate may become an active Tool/Skill/Automation;
- operator control semantics.

### HISTOS-Fabric owns

- source indexing and retrieval;
- memory storage/retrieval mechanisms;
- evidence indexing/reference mechanisms;
- Context Compiler and Context Capsule production;
- large-result externalization;
- compiled-understanding caches;
- incremental invalidation;
- background consolidation mechanics;
- retrieval/selection observability;
- repeated-work telemetry/candidate generation where generic.

### Boundary

HISTOS may tell EPHEMERA-System:

```text
"these sources appear relevant"
"this prior failure matches"
"this procedure succeeded under this scope"
"this compiled understanding is fresh for these source identities"
"this operation repeated 12 times"
```

HISTOS must not decide:

```text
"Mission is now RUNNING"
"Goal is COMPLETE"
"merge is authorized"
"send this external message"
"deploy this build"
"this memory now overrides current live state"
```

EPHEMERA-System should consume HISTOS through explicit contracts rather than importing internal storage/index implementation details.

## 3. EPHEMERA Harness <-> HISTOS-Fabric

The EPHEMERA Harness line exists to execute one bounded Task/Cycle with disposable roles and a Context Firewall.

HISTOS complements that boundary.

```text
EPHEMERA-System / caller
      |
      | bounded Task + scope
      v
HISTOS-Fabric
      |
      | Context Capsule
      v
EPHEMERA Harness
      |
      | bounded Worker / Verifier execution
      v
Harness receipt / evidence
      |
      +------> HISTOS evidence/memory candidate capture
      |
      +------> EPHEMERA-System acceptance/governance
```

HISTOS should reduce rediscovery before a Harness cycle and preserve reusable evidence after a cycle. It must not weaken Harness read isolation or give a Worker broad hidden access outside the materialized context/explicit tools authorized for that role.

The Harness may use HISTOS as one deterministic discovery/context provider, but HISTOS is not required to own Harness orchestration.

## 4. Codex <-> HISTOS-Fabric

Everyday Codex use is a first-class target, not merely an EPHEMERA integration test.

Desired pattern:

```text
user opens Codex in repository
        |
        v
Codex asks HISTOS for task context
        |
        v
HISTOS compiles bounded source + memory + evidence
        |
        v
Codex works normally
        |
        +--> optional evidence/result capture
        +--> memory/procedure candidate capture
```

Important requirement:

> HISTOS should remain useful even when EPHEMERA-System is not running a Mission.

A Codex adapter should prefer MCP or another standard local interface and should not require Codex-specific internals to become HISTOS's core contract.

## 5. OpenCode / Muse / other harnesses <-> HISTOS-Fabric

OpenCode and model-specific workers should use the same provider-neutral context service.

This enables cross-harness continuity:

```text
yesterday: Codex verifies finding A
        |
        v
HISTOS stores evidence-linked reusable knowledge
        |
        v
today: OpenCode/Muse recalls A under matching scope
```

The reverse should work identically.

No harness should receive special authority merely because it produced a memory. Confidence/promotion depends on evidence and policy, not provider/model identity.

## 6. chatgpt-mcp / Dev Exec <-> HISTOS-Fabric

`46slv/chatgpt-mcp` currently hosts the ChatGPT web bridge and the implemented Dev Exec control-plane lineage during EPHEMERA migration.

HISTOS should not duplicate that transport/control role.

Potential integration:

```text
Dev Exec / EPHEMERA-System
        |
        | task/run context request
        v
HISTOS
        |
        | Context Capsule / recall / evidence refs
        v
Codex / local worker / ChatGPT supervisor path
```

Dev Exec state, exact conversation/runtime bindings, leases and control decisions remain outside HISTOS authority.

If current Dev Exec behavior later migrates into EPHEMERA-System, HISTOS integration should follow the canonical System contract rather than preserving a legacy coupling to chatgpt-mcp internals.

## 7. Independent project repositories <-> HISTOS-Fabric

Projects such as KNOTFIELD, PSD2Fusion, HeadPatch and future repositories remain independent owners of their source and project-specific truth.

HISTOS may index and remember across projects using explicit scopes, for example:

```text
scope:
  project: PSD2Fusion
  repo: 46slv/PSD2Fusion
  source_ref: <commit or live working-tree identity>
```

Project-scoped knowledge must not silently become global system knowledge.

A reusable cross-project pattern should require explicit promotion with scope/provenance preserved.

## 8. Git / GitHub <-> HISTOS-Fabric

Git is useful for:

- source identity;
- diffs;
- history;
- co-change signals;
- versioned human-readable memory/procedure records;
- review/rollback of selected durable artifacts.

Git should not be forced to store:

- vector embeddings;
- large transient tool output;
- machine-specific caches;
- huge raw logs;
- volatile ranking scores;
- secrets.

HISTOS should be able to rebuild derived state from durable source/records where practical.

## 9. Obsidian / human knowledge tools <-> HISTOS-Fabric

Obsidian compatibility is useful as a human inspection/editing surface for selected Markdown/YAML memory.

Potential relationship:

```text
HISTOS durable readable records
      |
      +--> Git history/review
      |
      +--> Obsidian-compatible vault projection
```

Obsidian should not be required as a runtime dependency or authority.

HISTOS stable IDs/provenance should not depend solely on filenames or Obsidian-specific resolution semantics.

## 10. Future EPHEMERA Console relationship

The Console may aggregate read models from both EPHEMERA-System and HISTOS.

Candidate sections:

```text
Missions / Runs        <- EPHEMERA-System
Context                <- HISTOS
Memory                 <- HISTOS
Evidence               <- both, with ownership shown
Automation candidates  <- HISTOS signals + System policy/status
Sleep / consolidation  <- HISTOS
Providers/resources    <- EPHEMERA-System / runtime adapters
```

The UI must show ownership rather than flatten everything into one state model.

Useful HISTOS-specific views:

- Context budget by category;
- source bytes considered/opened;
- cache/index hit rate;
- why included / excluded;
- current truth versus memory;
- memory provenance/confidence/scope;
- stale/contradicted state;
- consolidation queue/deferred work;
- repeated-work candidates and evidence.

The Console is a control/read surface, not the authority that defines HISTOS or EPHEMERA state.

## 11. Interface/authority matrix

| Operation | Codex/OpenCode | EPHEMERA Harness | EPHEMERA-System |
| --- | --- | --- | --- |
| search source | yes, scoped | yes, scoped | yes |
| compile Context Capsule | yes | yes | yes |
| recall memory | yes, scoped | yes, scoped | yes |
| reopen exact evidence/source | yes if scope permits | yes if role scope permits | yes if policy permits |
| capture episode/evidence candidate | yes | yes | yes |
| promote semantic/procedural memory | proposal only by default | proposal only by default | policy-controlled |
| change retention/scope policy | no | no | privileged |
| activate Tool/Automation | no by HISTOS authority | no by HISTOS authority | System/user policy |
| change canonical Mission state | never | never | EPHEMERA-System only |

## 12. Long-term shape

```text
                    HISTOS-Fabric
             shared local Context Substrate
                         |
       +-----------------+------------------+
       |                 |                  |
     Codex            OpenCode        EPHEMERA Harness
       |                 |                  |
       +-----------------+------------------+
                         |
                   evidence/results
                         |
                         v
                  EPHEMERA-System
             Mission continuity/authority
```

This split allows HISTOS to mature as reusable local infrastructure while EPHEMERA-System remains the durable orchestrator that can use it without being inseparably fused to it.

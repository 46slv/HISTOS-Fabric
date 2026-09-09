# Agent Skills — HISTOS Projection Research Target

Status: **RESEARCH / PROJECTION_TARGET**

Updated: 2026-09-09

## Sources checked

- Agent Skills open specification: `agentskills/agentskills@69ef37e9424c0a7ea9dd2293b559e43ec8176379`
- Current OpenAI Codex `skill-creator` guidance in `openai/codex`
- Current OpenCode Agent Skills documentation at `https://opencode.ai/docs/skills`

This document does not claim every harness implements every optional field identically. It records a practical interoperability target for HISTOS procedural knowledge.

## Why this matters

HISTOS originally considered harness-specific Skills/Rules/Docs distribution as a later Automation/Projection concern. The current ecosystem now has a lightweight open Skill format based on a required `SKILL.md` plus optional scripts/references/assets, and both Codex and OpenCode expose on-demand Skill workflows.

That changes the default design question from:

> How does HISTOS invent and maintain separate procedural formats for each harness?

into:

> Can one accepted procedural revision be projected once as a standards-compliant Agent Skill, with only thin consumer-specific installation/metadata adapters?

## Progressive disclosure correspondence

Agent Skills explicitly separates:

```text
name + description
  -> cheap discovery
SKILL.md body
  -> task-time activation
references/scripts/assets
  -> load/use only when needed
```

This is strongly aligned with HISTOS's `Source is not Context` principle. A large procedure library does not need to become startup prompt text.

Current Codex guidance independently recommends:

- cheap/discriminating Skill discovery;
- progressive disclosure;
- focused references rather than copied manuals;
- scripts when deterministic execution is better than repeated reasoning;
- preserving user scope/authority rather than turning a Skill into permission.

Current OpenCode documentation says Skills are loaded on demand via its native `skill` tool and supports project/global Skill locations including `.agents/skills` alongside OpenCode/Claude-compatible locations.

## Candidate HISTOS lifecycle

```text
Evidence Events
  -> procedure candidate
  -> evidence/verification gate
  -> accepted procedural revision
  -> ProjectionProvider
  -> Agent Skill package
  -> target-specific install manifest
  -> Codex / OpenCode / other compatible harness
```

HISTOS must not skip candidate/verification stages merely because the output format is standardized.

## What belongs in a projected Skill

Good candidates:

- a branching diagnostic procedure with stable applicability;
- a recurring review/verification workflow;
- a compact routing procedure to a deterministic script/tool;
- project/team conventions that are durable enough to be intentionally maintained.

Bad candidates:

- current branch/Mission/run state;
- one-off task instructions;
- raw session transcripts;
- secrets or credentials;
- speculative conclusions without evidence;
- permissions/authority that the target environment did not independently grant;
- deterministic algorithms better represented as tested scripts/tools.

## Projection manifest requirement

A generated Skill directory is a projection, not authority. HISTOS should track:

```text
projection_id
source procedural revision
format/spec version
consumer/harness target
installed location
rendered file digests
compatibility assumptions
owner/managed files
previous projection revision
installation/update receipt
```

Updates compare expected managed hashes/revisions. If the user edits the generated Skill, HISTOS reports drift and creates a proposed merge/update rather than silently overwriting it. Uninstall removes only managed files.

## Harness-specific metadata

The core `SKILL.md` should remain portable when possible. Harness-specific UI/invocation metadata belongs in an adapter layer. For example, current Codex supports additional OpenAI-facing metadata under `agents/openai.yaml`; that should not force non-Codex clients to adopt the same file.

Likewise, supported installation paths differ by client. HISTOS should discover/validate the target harness configuration rather than treating one filesystem location as part of the Agent Skills standard.

## Research questions

- Can one exact procedural body be used unchanged by Codex and OpenCode?
- How much metadata is loaded at startup per projected Skill?
- Does a large Skill library preserve low context overhead in practice?
- How accurately do the two harnesses select the correct Skill from the same description?
- Which optional fields are portable versus ignored or interpreted differently?
- Can update/uninstall ownership be proven without touching user-authored Skills?
- How should HISTOS expose evidence/provenance without bloating `SKILL.md`? A compact revision/provenance ID plus optional reference is likely preferable to embedding raw evidence.

## Proposed experiment AS1 — same Skill, two harnesses

1. Pick one manually reviewed, non-destructive procedure.
2. Render a minimal standards-compliant Skill with focused references and no harness-specific core instructions.
3. Validate the package against the Agent Skills reference validator where practical.
4. Install via target-specific adapters into Codex and OpenCode.
5. Run paired tasks that should trigger and should not trigger it.
6. Measure selection precision/recall, model-visible discovery overhead, loaded context, task success and uninstall/update drift.

This experiment can happen before automated experience-to-Skill promotion exists. It tests the projection boundary only.

## Adoption posture

Current classification:

```text
PORTABLE_PROJECTION_TARGET
BENCHMARK_TARGET
```

The open format is a strong default candidate for procedural projection. It is not itself a Memory Provider, evidence system, automation authority or current-state store.

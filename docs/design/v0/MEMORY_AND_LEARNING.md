# Memory, consolidation and experience-to-automation

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Updated: 2026-09-06

## 1. Capture is not acceptance

Keep three distinct classes:

- source/evidence bytes and producer receipts;
- episodic records describing an observed action/result;
- semantic/procedural interpretations proposed from those records.

A candidate contains a claim, scope, expected previous revision, origin, source/evidence refs, applicability/version limits, exclusions and proposed relation edges. The capture endpoint sets its status to candidate regardless of caller wording. The caller cannot assert a verified status or raise independent proof count.

A tool result can contain a genuine new test result **or** an old retrieved memory. Therefore neither 'all tool output is evidence' nor 'no tool output is evidence' is correct. Classify by producer, origin event, exact artifact identity and lineage. A test receipt still proves only what the test checked, not every semantic claim in the agent's report.

Distinguish immutable evidence retention from mutable interpretation. Correcting a memory adds a revision with `supersedes`/`contradicts` edges; it does not rewrite historical evidence. Protect access across the entire lineage.

## 2. Independent support

Dedupe observations by original producer event and artifact lineage. Five agents quoting one report are one source, not five confirmations. Replaying the same command on the same captured input is reproducibility evidence, but not automatically independent domain evidence. A successful new fixture or changed runtime may broaden applicability only under an explicit review.

Avoid uncalibrated confidence decimals. Initially use `proposed`, `source_supported`, `tested_in_scope` and `human_reviewed` with coverage and supporting refs. These describe evidence class, not a probability that a statement is universally true.

Record separately:

```text
origin event / producer
what was actually observed
source and runtime identity
what is inferred
independent support groups
contradictions / limitations
review decision and reviewer scope
```

## 3. Two lifecycles, not one score

Epistemic lifecycle: `CANDIDATE -> SUPPORTED -> VERIFIED_IN_SCOPE`; later `CONTRADICTED`, `SUPERSEDED` or `REJECTED` as evidence changes. Every transition has a revision, policy and evidence receipt. Storage acceptance itself is not verification.

Recall temperature: `ACTIVE -> COLD -> ARCHIVED`. This is an independent ranking/retention preference, not a truth status. Archived facts can remain valid; frequently recalled facts can be stale. 'Forgetting' normally reduces recall priority, while privacy purge follows the explicit deletion protocol.

Eligibility checks for scope, version, source availability and conflicts precede ranking. Recency/usefulness cannot rescue an ineligible fact. Critical owner-supplied constraints are not demoted by popularity or age. Prefer measured downstream utility over repeated recall as a reinforcement signal.

## 4. Compiled understanding

An architecture page, failure summary or procedure synopsis is a derived materialized view with an input manifest, inspected coverage, exclusions, source locations and compiler/policy versions. It can serve cheap repeated reads while valid. Exact source remains accessible through authorized refs.

Compile only in-demand or high-value views. Estimated saved foreground work must justify extraction/refresh cost; report that estimate separately from measured savings. Never schedule one summary per source merely because it exists. An invalid view can be omitted or marked stale; it must not silently claim current truth.

Not all derived results are byte-reproducible: model-generated summaries may differ after rebuilding. Preserve their original output, model/config identity and provenance when used in a decision. Deterministic indices and semantic interpretations have different reproducibility promises.

## 5. Bounded sleep

Sleep is a maintenance queue, not an always-running autonomous agent and not a calendar full-memory reread. Jobs cover index maintenance, deduplication, contradiction candidates, compiled-view refresh and repetition analysis.

Job key: `(scope_id, kind, target_id)`. Persist dirty generation, input snapshot, policy/model profile, allowed data classes, token/byte/time/call limits, next eligibility time and attempt count. A burst coalesces into one pending target job. A running job consumes a pinned generation; newer deltas remain pending.

State machine:

```text
QUEUED -> RUNNING -> COMMITTED
   |          |----> DEFERRED  (resource/maintenance window; no failure retry)
   |          |----> RETRY_WAIT (bounded transient failure)
   |          |----> QUARANTINED (invalid data / exhausted failure budget)
   |          +----> CANCELLED
   +----> CANCELLED
```

Coalesced desired work is not dropped during a debounce window. Minimum refresh interval, at-most-one active lease per key, global/per-scope quotas and fencing apply before any model call. Explicit operator refresh may bypass debounce, not cost/privacy limits or lease ownership. Failed units are not checkpointed as successfully processed.

Foreground work preempts new background admission. A started model call may not be instantly cancellable; reserve its worst permitted cost, account partial work, and suppress publication if its fence or policy becomes invalid. On provider rate limits, honor retry delays and reduce concurrency; never retry-spin. On budget exhaustion, leave visible deferred work and continue unrelated authorized jobs.

Initial defaults: no background model calls until configured; deterministic maintenance allowed within explicit resource caps. Model choice remains a runtime profile, never a hard-coded brand. Hindsight's historical refresh-amplification report and fix are research references, not a substitute for HISTOS's own tests; see the existing research ledger.

## 6. Repetition-to-automation boundary

Group equivalent work by a scoped semantic signature (operation intent + input/output class + relevant preconditions), not timestamps or exact command strings. Maintain attempt/success/failure counts, human attention, tokens, execution time, branching, repair cost, version drift and available verifier.

Promotion candidates can target:

```text
repeated invariant violation -> test / guard / preflight
stable command sequence     -> wrapper
bounded reusable judgement  -> Skill / workflow
clear deterministic I/O      -> Tool
stable trigger + action      -> scheduled workflow proposal
```

Candidate ledger: `OBSERVED -> REPEATED -> CANDIDATE -> SHADOW -> VERIFIED_IN_SCOPE`. HISTOS supplies generic telemetry and records verification receipts. It does not run an arbitrary generated program or activate it. Code belongs in the relevant project/tool repository, with a separate reviewed change and consumer-owned sandbox/tests.

'White-box shadow' means replay against a fixture/recorded input in isolation, or compare a proposed action without performing the real side effect. Never shadow-send an email, pay, deploy or delete in production. A high pass count does not authorize those actions.

`ACTIVE`, `DISABLED` and `ROLLED_BACK` are imported projections of the external owner's state. Changes to a Skill, Tool version, dependency or permission invalidate prior activation evidence as the owner's policy requires. The Console displays that owner and the exact version.

## 7. Later policy self-improvement

Only after a fixed retrieval baseline and held-out corpus exist, consider bounded changes to fusion weights, representation choices and expansion budgets. Use separate training/development/holdout cases, negative/no-answer tasks, resource ceilings, versioned candidate policies and automatic rollback on regression. Prevent policy tuning from loosening scope/authority or selecting its own gold labels.

Learned routing is advisory. Security rules, mandatory provenance and execution authority are not tunable objective weights. Do not optimize a metric solely using the summaries produced by the policy being tested.

# A01 retrieval-policy self-improvement contract

Status: **BOUNDED IMPLEMENTED CANDIDATE — independent verification required**

A01 is a deterministic, read-only experiment surface in
`tools/policy/retrieval-policy-experiment.mjs`. It compares versioned retrieval
policy candidates with a fixed lexical baseline on development and held-out
cases. It does not install a policy, mutate a cache, promote a memory, change
Mission state, or make a candidate authoritative.

## Policy identity and immutable boundary

`sealPolicy()` produces a
`histos.retrieval-policy-envelope/v1` envelope containing the canonical
`histos.retrieval-policy/v1` policy and its SHA-256. `validatePolicy()` rejects
unknown fields, malformed IDs/hashes/paths, invalid numeric values, unsafe
weights, and authority changes. The policy always declares:

- an exact `scope_id`, source snapshot digest, source-path allowlist and
  evidence-path allowlist;
- evidence-linked provenance requirements;
- `authority: "none"` and `current_truth: false`;
- an immutable safety envelope for result count, rendered-token budget,
  relationship depth and cache age.

A candidate must be sealed, have `kind: "candidate"`, and name the exact
baseline envelope checksum in `parent_policy_sha256`. `validateCandidate()`
requires byte-for-byte equality for scope, provenance, authority, current-truth
and safety fields. Only these approved parameter values can differ:

```text
parameters.retrieval.lexical_weight
parameters.retrieval.relationship_weight
parameters.retrieval.expansion_depth
parameters.budget.result_limit
parameters.budget.token_share
parameters.cache.enabled
parameters.cache.max_age_ms
```

The ceilings never change. Cache is an observational parameter in this slice;
the experiment does not claim a cache hit or a quality gain merely because a
candidate enables it.

## Evidence-backed evaluation

`evaluatePolicyExperiment({ baseline, candidates, cases, evidence })` requires
at least one held-out case. Every expected result must be bound to an exact,
scope-allowed catalog identity (`kind`, relative path, SHA-256 and byte count).
Missing, stale, forged or out-of-scope evidence is refused before retrieval.
Case labels are used only after retrieval for scoring; they are not provided to
the deterministic lexical/relationship selector.

The runner reports each case and aggregates development/held-out hits, recall,
precision, false positives, exact cases, no-answer behavior and result bytes.
Selection is deterministic: eligible candidates must not regress held-out
recall, exact cases, no-answer cases or false positives, then are ranked by
held-out hits/recall/exact cases and stable policy ID. A candidate that regresses
is retained in the report with explicit rejection reasons. If all candidates
regress or fail validation, the decision is `BASELINE_ROLLBACK`.

`rollbackToBaseline()` verifies the report's baseline checksum and returns a
durable baseline-restoration receipt. `selectPolicy()` is deliberately
non-authoritative (`active: false`); a consuming policy owner must separately
review and install any selected candidate.

## Verification

```text
node --test tools/policy/retrieval-policy-experiment.test.mjs
```

The focused suite has six deterministic tests covering:

1. sealed/versioned policy identity;
2. held-out evidence-backed gain and deterministic selection;
3. an intentionally regressing budget candidate and baseline rollback;
4. a no-gain cache candidate;
5. malformed, forged, stale, out-of-scope and authority-changing policy/evidence
   rejection;
6. input immutability.

The repository-wide `npm test` remains the regression check. This package does
not claim native EPHEMERA-System adoption, production cache telemetry, provider
acceptance, host-process evidence, policy installation, or `FULL_DONE`; those
are external integration gates owned by the System sequence.


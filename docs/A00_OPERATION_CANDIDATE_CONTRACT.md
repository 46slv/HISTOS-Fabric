# A00 operational-intelligence candidate contract

Status: **BOUNDED IMPLEMENTED CANDIDATE — independent verification and System adoption required**.

Phase 10 emits generic repeated-work evidence.  It does not make an operation a
Tool, Skill, Automation, current-truth record, Mission transition, schedule,
provider route, budget decision, safety decision, or completion decision.  The
implementation is the file-free, deterministic read model in
`tools/intelligence/operation-candidates.mjs`; persistence and activation stay
with the consuming authority.

## Public boundary

```text
createOperationSignature({ operation_id, name, version, scope,
  semantic_steps, input_contract, output_contract })
buildAutomationCandidate({ signature, observations, producer_id,
  counterexamples })
validateAutomationCandidate(candidate)
advanceCandidate(candidate, next_state, fresh_evidence)
runShadowEvaluation({ candidate, cases, execute })
verifyAutomationCandidate({ candidate, shadowResult, verifier, evidence })
selectQualifiedCandidate({ candidates, signature_sha256, scope_id })
executeQualifiedCandidate({ candidate, input, execute })
rollbackCandidate({ candidate, priorCandidate, reason, evidence })
```

Aliases (`buildOperationCandidate`, `transitionCandidate`, `runShadow`,
`verifyCandidate`, `selectCandidate`, and `validateCandidate`) are provided for
small host adapters.  No function writes a repository or changes an external
authority.

## Stable semantic signatures and metrics

`createOperationSignature()` binds a stable operation ID/name/version, ordered
semantic step IDs, typed input/output contracts, an explicit `scope_id`, and a
source snapshot SHA-256.  The signature hash is recomputed from canonical JSON;
caller-supplied hashes, volatile timestamps, executable code, and altered scope
identity are rejected.

Each observation binds the signature and snapshot and records a sequence,
typed-contract hashes, outcome (`success`, `failure`, or `abstain`), repair
iterations, model/tool/token/elapsed costs, and fresh evidence references.  A
candidate derives, rather than trusts, these metrics:

```text
occurrence_count
stable_sequence_ratio
repair_iterations
failure_frequency
repeated_model_tool_cost { model_calls, tool_calls, tokens, elapsed_ms,
                            per_occurrence }
stable_io_ratio
stable_io_contract
deterministic_verifier_available
```

The metrics are reproducible for the same observations.  A candidate with many
observations still starts at `OBSERVED`; a host must record every lifecycle edge
explicitly.  This prevents a count alone from silently promoting work.

## Candidate lifecycle and gates

The only legal edges are:

```text
OBSERVED -> REPEATED -> CANDIDATE -> SHADOW -> VERIFIED
```

`advanceCandidate()` refuses skipped edges, backwards edges, unknown states, and
direct `VERIFIED` requests.  The `REPEATED` edge needs at least two observations;
`CANDIDATE` needs a stable typed I/O contract plus at least one authenticated
counterexample; `SHADOW` needs the counterexample set and a fresh evidence
receipt.  The module never exposes an `ACTIVE` state.

Every evidence receipt carries the exact candidate scope and source snapshot,
fresh state, bounded relative POSIX source/evidence references, a supported
independent provenance kind, and a recomputed digest.  Stale snapshots, forged
digests, POSIX or Windows absolute paths, UNC paths, traversal paths, current-truth/authority labels, and
unsupported provenance fail closed.  The module validates identity and lineage;
the host remains responsible for checking the referenced bytes against its own
source/evidence registry before constructing the receipt.

## Typed I/O, abstention, and shadow execution

The candidate stores immutable input/output JSON contracts and an explicit
abstention contract.  Unknown or unsafe input must return a declared
`{kind: "abstain", reason_code}`; undeclared reasons and output values that do
not match the contract are rejected.  Control-looking output fields (`authority`,
`budget`, `safety`, `completion`, `activation`, `mission_state`, and
`current_truth`) cannot be emitted as execution control.

`runShadowEvaluation()` accepts bounded fixture cases and an injected executor.
It executes every case twice in shadow mode, checks the typed output or explicit
abstention, records per-case input/expectation digests, and computes a
deterministic result digest from the normalized reports and counts.  A wrong
counterexample, non-deterministic output, unsafe output, forged count/report,
or failed case yields `FAILED`; it can never be passed to the verifier.

`verifyAutomationCandidate()` requires a distinct verifier identity and a
non-empty implementation hash.  The verifier must declare both independence and
determinism and must bind its receipt to the exact candidate and shadow hashes.
Only a passing, independently bound receipt appends `SHADOW -> VERIFIED` and
sets `deterministic_verifier_available`; it does not grant activation authority.

## Selection, use, and rollback

`selectQualifiedCandidate()` considers only exact-scope, exact-signature,
`VERIFIED` candidates and returns a deterministic selection receipt with
`authority: "none"` and `activation.authorized: false`.  `executeQualifiedCandidate()`
requires that state and revalidates typed input/output; it invokes a host-owned
executor and supplies `mode: "selected"`, but cannot mutate Mission controls.
`activateCandidate()` is an explicit fail-closed `EXTERNAL_AUTHORITY_REQUIRED`
boundary.

`rollbackCandidate()` accepts only a prior `VERIFIED` candidate with the exact
same signature and scope.  It returns a bounded rollback receipt naming the
failed and prior candidate hashes, reason, fresh evidence and an integrity
check.  Rollback is a proposal/read model; the relevant System/user authority
must perform any real selection or activation.

## Verification and remaining gates

```powershell
node --test tools/intelligence/operation-candidates.test.mjs
```

The deterministic fixture covers metrics, the full lifecycle, typed output and
abstention, double-run shadow checks, independent verifier identity, and rollback.
Negative cases cover forged/stale/out-of-scope evidence, skipped lifecycle,
unsafe authority/activation, failed counterexamples, nondeterministic shadow,
verifier identity, control-output injection, and invalid rollback.

This is local component evidence only.  EPHEMERA-System adoption, source-owned
byte verification, repeated-work telemetry in production, provider/native host
acceptance, policy-owned activation, scheduler/wake evidence, and FULL_DONE are
external gates and are intentionally not claimed here.

# H04 bounded Sleep consolidation

Status: **IMPLEMENTED COMPONENT CANDIDATE; H04 HOST/SCHEDULER ACCEPTANCE PARTIAL**.

`tools/sleep/sleep-consolidator.mjs` owns a deterministic, local maintenance queue
and derived candidate projection. It consumes the public H03 memory and compiled
understanding APIs. It does not own Mission authority, scheduling, model dispatch,
source stores, provenance approval, or candidate activation.

## Public calls

- `enqueueSleep({root, scopeId, events})` atomically persists a batch of exact
  event IDs, resource IDs, scope, fingerprints and declared source-byte costs.
  Fingerprints are `sleepDigest(recordOrCompiledObject)` over the exact H03 output.
  One ID cannot be rebound to different content. Distinct updates for one resource
  coalesce before work, with all accepted input sequences retained.
- `runSleep({root, scopeId, inspect, maxResources, maxDeclaredBytes,
  maxMilliseconds})` validates only pending resource deltas. Successful outcomes,
  candidates, supersession tombstones and coverage cursor commit together.
  Failed work remains inspectable and retryable; work with fewer failed attempts
  is selected first. No model calls occur.
- `createH03SleepInspector({memory, understanding, readMemorySuppression})` creates the trusted inspector
  from existing public H03 option objects. The `memory` options must use the
  host's existing `verifyProvenance` policy. Sleep does not invent attestations,
  infer approval from caller labels, or increase independent support counts.
  Memory also requires the host's bounded `readMemorySuppression` callback. Without
  it, every memory delta is deferred as `SLEEP_SUPPRESSION_AUTHORITY_REQUIRED`.
- `inspectSleep({root, scopeId})` returns coverage, debt, costs, deferrals,
  candidate lineage/history, contradiction links and durable suppression markers.
  Exact duplicate representation groups add zero independent support.
- `recoverSleepWriter({root, expectedToken})` removes a crashed writer's lock only
  when its exact token and local host match and its PID is no longer alive.
  PID reuse refuses recovery. There is no force takeover option.

`inspect` is a host-injected trusted, read-only callback, not an agent-supplied
payload. Use `createH03SleepInspector` at the public H03 boundary. Generic callback
tests are trusted-boundary fixtures and do not demonstrate external provenance.
The core checks scope/fingerprint, explicit non-authority, reference hashes/bytes,
and relation shapes before accepting an inspection.

### H04-IV-01 incoming suppression boundary

An old record's individually fresh source does not imply that the record remains
eligible: its correction may already have become stale or been deleted before
the first Sleep cycle. The host callback receives `{scope_id, resource_id}` and
must return a freshly source-owned complete projection with those exact fields,
`complete: true`, `authority_sha256` and `suppressions`. Each suppression carries
H03's `id`, `superseded_by`, `claim_sha256` and `state` (`active` or `unresolved`).
Sleep consumes these historical markers before reading the candidate, persists
them, and never exposes a suppressed old candidate even when its replacement is
unreadable. A checksum names the authority projection; trust comes from the
host-owned callback, not caller-provided JSON or a hash alone.

The host must supply a bounded per-subject lookup and own snapshot freshness and
completeness. The existing H03 individual API lacks incoming suppression and the
public recall API scans history. No production indexed suppression callback is
implemented here; **memory integration remains blocked until that boundary is
provided**. The regression builds a test-host projection from public H03 recall
once per source transition and does bounded lookups; Sleep never invokes recall
per delta. Missing authority fails closed, rather than silently treating the
suppression list as empty. This is a safety repair, not H04 package closure.

## Transaction and interruption contract

A single-writer exclusive file lock guards every mutation. A bounded JSON state
snapshot has a canonical SHA256 integrity envelope. A new snapshot is written and
file-synced before atomic rename; the previous committed snapshot remains the
recovery point until rename. Inputs, candidate updates and cursor cannot commit
individually. After a crash before rename, the read-only inspection can repeat;
after rename, accepted event IDs prevent duplication. No external side effect is
claimed exactly once. File checksums detect corruption; they are not signatures.

The source-owned scheduler can call enqueue/run through these public APIs and
record their returned observations. Its own task identity, STOP, quotas, claims,
next wake and Mission completion remain external. The component has no scheduler
integration or actual wake proof. Those are still required for H04 closure.

Recovery requires an explicit exact lock token from the private store and checks
that the recorded process is dead. A partial/corrupt lock or stale recovery guard
fails closed for operator diagnosis. Abandoned temporary snapshots are inert and
retained; the component does not sweep unknown files. File sync plus atomic rename
is tested for process interruption, not sudden device/power-loss durability.

## Budgets, freshness and retention

One run admits at most 100 resources, 16 MiB declared source bytes and 60 seconds
of admission time; defaults are 8 resources, 1 MiB and 1000 ms. An inspector already
in progress cannot be forcibly interrupted: wall time is an **admission bound**.
The H03 API performs source I/O, so declared bytes are an admission/returned-lineage
check, **not an OS I/O quota**. No provider token budget or model-time claim is made.
Queue capacity is 10000 retained events, batches at most 1000, state at most 16 MiB,
and inspected payload at most 256 KiB. Capacity exhaustion refuses the transaction
without dropping input history. Costs and all run outcomes stay inspectable.

Every newly accepted event immediately hides the affected resource until refresh.
Unrelated resources remain untouched. Freshness is relative to processed events
and the last H03 validation; this is not a file watcher. Consumers must enqueue
source changes or freshly reopen H03 data before current-truth decisions.

All output is `sleep_candidate`, `authority: none`, `current_truth: false`.
H03-verified supersession is retained as an authenticated historical relationship;
a stale/deleted replacement cannot resurrect the older candidate. Unverified
candidates cannot add supersession markers. Contradiction links retain source
references and their stale/fresh state. Replaced candidate payloads and lineage,
input identities, receipts and tombstones remain in the bounded store. No source
or evidence file is deleted. This is explicit conservative retention, not GC.

## Verification and remaining acceptance

Run `node --test tools/sleep/sleep-consolidator.test.mjs` from the HISTOS root.
Tests cover burst coalescing, bounded admission, retry isolation, idempotency,
pre/post-commit interruption, actual crashed child-process lock recovery,
scope/corruption refusal, source change through the real H03 public APIs and
candidate provenance boundaries. Synthetic inspector cases are unit tests.

`node tools/sleep/sleep-demo.mjs --output-root ABSOLUTE_FRESH_PRIVATE_DIRECTORY`
creates only explicitly scoped local fixture files, then uses the actual H03
compiled store for burst/defer/stale/recompile cycles and writes report, final
inspection and byte/hash manifest. It refuses an existing output directory.
The private local demonstration is not a production/native-client/wake proof.

Real F06 scheduler wake/restart integration and source-owned host acceptance remain
NOT_RUN. No H06 held-out retrieval gain, model-generated consolidation quality,
or FULL_DONE result is claimed by this component.

# H03 evidence memory and compiled understanding contract

Status: **EXPERIMENTAL IMPLEMENTED CANDIDATE — INDEPENDENT REVIEW REQUIRED**

This document describes the public, file-native Phase 5-6 candidates in
`tools/memory/evidence-memory.mjs` and
`tools/understanding/compiled-understanding.mjs`. They do not define Mission
state, promotion authority, a daemon, retention automation, or a production
service. Their public functions are asynchronous and use no private Mission
imports.

## Evidence memory and the host trust boundary

`captureMemory()` stores one immutable, checksummed JSON envelope per stable ID.
Record classes are `episode`, `semantic`, `failure`, `procedure`, and
`decision_reference`. Each record carries scope, timestamps, applicability,
confidence, exact references, and contradiction/supersession links. Byte length,
SHA-256, allowlist membership and realpath containment are checked at capture
and fresh recall. Missing, changed, forged or out-of-scope references are refused.
Memory remains history: `authority: "none"` and `current_truth: false`.

Reference fields `provenance_kind`, `lineage_id`, and `supports_claim` are
**untrusted caller labels**. They are retained as data and never authorize
verification. A `verified` record requires the explicitly injected host function
`verifyProvenance(request)` to return at least one supporting, source-owned
attestation. Without that function, callers can capture candidates but cannot
capture or recall verified records. A stored confidence of 1 changes neither
status nor trust.

The host must configure its verifier outside the untrusted capture payload from
its own source registry or independently validated receipts. A verifier that
simply echoes caller labels or approves arbitrary request hashes defeats this
boundary and is not a conforming adapter. This library does not independently
judge whether a text is true or a runtime observation is independent.

`memoryClaimSha256({ scope, record })` computes the canonical subject for prior
host approval. It binds scope ID, ID/class, title/summary/details, status,
confidence, record provenance, exact reference identities and ranges,
contradiction/supersession relations, timestamps, applicability, and fresh-read
policy. It excludes caller reference labels. This prevents borrowing approval
for different evidence, another claim or scope, or a newly added relation.

For each reference, the verifier receives:

```js
{
  scope_id: 'project-alpha',
  claim_sha256: '<approved full-claim SHA-256>',
  reference: { kind: 'source', path: 'procedure.txt', sha256: '<file SHA-256>', bytes: 42 }
}
```

A successful response must contain those exact three fields plus:

```js
{
  provenance_kind: 'independent_test', // or source/runtime_observation/immutable_receipt
  lineage_id: 'source-owned-observation-id',
  origin_sha256: '<SHA-256 of the original source-owned observation>',
  supports_claim: true
}
```

The response must come from a previously approved registry entry, not from
constructing an approval using the incoming request. `null` means no approval.
`start_line`/`end_line`, when present in the reference, are also bound. The
verifier may be asynchronous. Invalid or mismatched attestations fail closed.
The stored `verification` contains the resulting attestations, full claim hash,
and derived independent-support count. Every read re-invokes the host verifier;
a checksummed persisted assertion alone is never trusted.

Support requires host-attested `source`, `runtime_observation`, `independent_test`
or `immutable_receipt` provenance. Model restatements, retrieved memory, compiled
material, hypotheses and ordinary tool output do not count. Support is counted
by connected groups: shared trusted lineage ID, shared original-observation
digest, or identical evidence bytes join the same group. Thus copied files,
aliases, invented caller labels and paraphrases of a known common origin cannot
inflate the count. Origin attribution remains the host registry's responsibility.

## Relationships and freshness

Contradiction adjacency is built in both directions before query filtering.
Querying either side alone includes the dispute ID and `contradiction_evidence`
with declaring record, its status, approved claim hash, references, and
`fresh`/`unresolved` state. Authenticated disputes remain visible when their
source bytes disappear. Candidate disputes are explicitly labeled candidate.

Verified supersessions write an immutable envelope to `supersessions/<id>.json`
**before** publishing the new record. This write-ahead tombstone contains the
complete host-approved subject, whose relation is included in its claim hash.
Normal recall suppresses the old record even if the correction's evidence or
record file disappears. Recall and readable export include `supersessions`
with `active` or `unresolved` state and the missing/stale reason, plus the
correction's exact reference identities (`kind`, `path`, `sha256`, `bytes` and
optional line range). Lost or revoked
provenance, corrupt tombstones, or inaccessible approved scope fail recall with
`MEMORY_SUPERSESSION_UNRESOLVED`; they never silently restore obsolete history.

A crash between tombstone and new-record publication conservatively suppresses
the old record. Retrying the same capture is idempotent; conflicting ID content
is rejected. The exact `readMemoryRecord()` API returns historical record data
when its evidence and provenance validate; normal recall is the API that applies
relationship filtering. Memory directories and tombstones must be retained
under host ownership. This is not a tamper-proof filesystem or a distributed
transaction system; removal of the entire history/tombstone store cannot be
detected without an external durable inventory. No retention/deletion API is
provided.

Fresh current-truth references are passed separately to `recallMemory()` and
rechecked against exact file bytes and the active allowlist. That validates the
supplied files now; it does not promote a remembered claim or independently
prove that a caller-designated file is authoritative. Poison-looking text stays
inert data. `exportMemory()` produces JSON and readable Markdown including exact
references and unresolved supersessions.

## Dependency-addressed compiled understanding

`putCompiledUnderstanding()` stores checksummed architecture overviews, module
dependency explanations, known failure boundaries and verified integration
contract descriptions. Each object records exact dependency kind/path/bytes/hash,
inspected and uninspected coverage, timestamps and a dependency address.

An existing key with the same verified dependency address returns `REUSED` and
the prior object. Changed verified dependencies return `RECOMPILED`.
`assessCompiledUnderstanding()` and `assessUnderstandingCache()` re-read every
dependency and suppress objects whose dependency is changed, deleted, forged,
corrupt or outside scope. Only objects listing the changed dependency stale.
`readCompiledUnderstanding()` refuses stale output;
`exportCompiledUnderstanding()` emits Markdown with dependency digests and
coverage. Artifact directory containment is checked on read, initial publish,
and replacement, including junction/symlink directory refusal.

Compiled objects are derived data with `status: "compiled_candidate"`,
`authority: "none"` and `current_truth: false`; they cannot become Mission
authority or replace a required fresh live read. Unchanged dependency reuse does
not claim semantic correctness or model-quality gains.

## Public calls

```text
memory:
  memoryClaimSha256({ scope, record })
  captureMemory({ memoryRoot, scope, sourceRoot, evidenceRoot, verifyProvenance, record })
  readMemoryRecord({ memoryRoot, scope, sourceRoot, evidenceRoot, verifyProvenance, id })
  recallMemory({ memoryRoot, scope, sourceRoot, evidenceRoot, verifyProvenance,
                 query, currentTruthRefs, includeCandidates })
  exportMemory(...recall arguments...)

understanding:
  putCompiledUnderstanding({ cacheRoot, scope, roots, understanding })
  assessCompiledUnderstanding({ cacheRoot, scope, roots, key })
  assessUnderstandingCache({ cacheRoot, scope, roots })
  readCompiledUnderstanding({ cacheRoot, scope, roots, key })
  exportCompiledUnderstanding({ cacheRoot, scope, roots, key })
```

Scopes use explicit relative allowlists. Memory uses `source_paths` and
`evidence_paths`; understanding uses `paths_by_kind` and a matching `roots` map.
The host owns root/allowlist and verifier selection. References use ordinary
local files; there is no external API or dependency addition.

## Verification and limits

```powershell
node --test tools/memory/evidence-memory.test.mjs tools/understanding/compiled-understanding.test.mjs
```

Eleven local synthetic tests passed during repair, including separate Node
processes for capture, recall, exact reads, export, trust-spoof rejection,
bidirectional query filtering, and recall after newer evidence/record deletion.
The host fixture registry is passed separately from untrusted capture jobs.
Additional cases bind approval to scope/claim/evidence, refuse forged attestations
and rechecksummed content changes, deduplicate copied bytes and original lineage,
refuse caller support flags, retain unresolved disputes, fail on revoked trust
and corrupt tombstones, and preserve source freshness/scope/corruption behavior.
Compiled-understanding tests cover fresh-process reuse, changed/deleted inputs,
precise invalidation, recompilation and readable exports.

This proves component behavior on controlled local fixtures. It does not claim
real Codex/OpenCode client integration, observed model/token/turn gains, daemon
or database recovery, automatic consolidation, production deployment or power-loss
fsync durability. H03 closure requires H01 acceptance and a fresh independent
review of the repaired exact candidate.

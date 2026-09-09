# H06 typed relationship retrieval contract

Status: **BOUNDED IMPLEMENTED CANDIDATE — component verification required**

H06 adds a small, file-native relationship read model in
`tools/relationships/typed-retrieval.mjs`. It is deliberately separate from
H03 storage and from EPHEMERA-System authority. A caller supplies an explicit
scope, a source/evidence identity corpus, and H03-style record envelopes. The
module never discovers a global memory directory and never mutates a record.

## Public boundary

The primary calls are:

```js
buildTypedRelationshipIndex({ scope, records, sources, limits })
validateTypedRelationshipIndex(index, { scope })
queryTypedRelationships({ index, scope, query, maxDepth, maxResults })
lexicalBaseline({ index, scope, query, maxResults })
evaluateHeldOut({ scope, records, sources, cases, limits })
```

Each input record is an explicit `{ record, record_sha256 }` envelope. The
checksum must equal the canonical record bytes. Records must remain in the
requested scope, have `authority: "none"` and `current_truth: false`, and carry
an H03 `verification.claim_sha256` (or an equivalent explicit claim hash).
Every reference must match the supplied source/evidence identity exactly:
`kind`, relative `path`, `sha256`, and `bytes`. A missing, stale, forged or
out-of-scope identity is refused.

Only H03's typed `contradicts` and `supersedes` relations are accepted. Unknown
relation keys, duplicate/self/unknown targets, cross-scope records, and
relation fan-out or edge budgets fail closed. Cycles are valid data, but query
traversal is bounded by depth, visited-node and edge limits. The index digest,
sorted nodes/edges and source snapshot digest make rebuilds deterministic and
readback tamper-evident.

When an expected `scope` is supplied to `validateTypedRelationshipIndex`, it is
an exact canonical identity: `scope_id`, `source_snapshot_digest`,
`source_paths`, and `evidence_paths` must all match. Missing, altered, or empty
path sets therefore fail closed; the caller must pass the complete scope that
was sealed into the index.

## Result and authority semantics

Lexical seeds use a fixed token-presence baseline. Relationship expansion walks
declared edges in both directions and returns a bounded explanation containing
the relation type, direction, declaring claim hash, exact record checksum and
source references. Candidate records are excluded by default and are only
included with `includeCandidates: true`; they remain candidates. Current-truth
records are rejected at index build. Excluded candidate/deprecated nodes are
hard traversal barriers, so they cannot bridge one eligible record to another.
No result can become current truth, Mission state, a Tool, or an Automation.

`maxDepth`, `maxResults`, and `maxVisited` accept only safe nonnegative integer
overrides; `NaN`, infinity, fractions, and negative values fail closed. The
visited budget includes lexical seeds (and a zero budget yields no seeds), so
the result cannot exceed the caller's bounded traversal budget.

`evaluateHeldOut()` reports exact node/edge/source counts, index/result bytes,
rebuild maintenance work, observed wall-clock latency, and per-case expected
hits for the fixed lexical baseline versus typed expansion. The fixture used by
the H06 tests has one explicit relation case where the relation is recovered,
one lexical control case, and one no-answer control. The report states gains
only for the relation case; it does not claim a universal lexical improvement.

## Verification command and remaining gates

```text
node --test tools/relationships/typed-retrieval.test.mjs
```

The focused suite covers deterministic rebuild, exact provenance, stale and
forged references, cross-scope and unsupported edges, cycles, depth/fan-out/
edge/visit budgets, candidate/current-truth separation, and held-out baseline
comparison. `npm test` remains the repository-wide regression check.

This package is a HISTOS component read model. Production EPHEMERA-System
adoption, F06 scheduler/runtime wake integration, native provider acceptance,
host process evidence, and FULL_DONE remain external gates owned by the System
integration sequence.

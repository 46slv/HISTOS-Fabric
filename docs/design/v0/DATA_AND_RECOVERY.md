# Data ownership, snapshots and recovery

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Updated: 2026-09-06

## 1. One owner per kind of truth

| Data | Owner | Rebuild rule |
| --- | --- | --- |
| Project source and current runtime/Mission state | Original repository/runtime/EPHEMERA | HISTOS cannot reconstruct current truth from an old memory. |
| Accepted HISTOS record revision bodies and retained evidence bytes | Immutable local objects | Preserve and back up; summaries are not substitutes. |
| Record heads, access policy, revocations, publication receipts, operations | HISTOS transactional registry | Durable metadata; never call it a disposable index. |
| Lexical/vector/graph indices and compiled caches | Derived stores | Rebuild from named source/record revisions and configuration. |
| Markdown/Obsidian views and selected Git exports | Projections | Regenerate; inbound edits are proposals, not direct accepted-state mutations. |

This refines the bootstrap's broad 'SQLite or equivalent' direction. A SQLite database containing policies, operation receipts or accepted revision pointers is not wholly rebuildable search state. File-native readability does not require two unsynchronized authorities.

Candidate local layout, outside the source checkout:

```text
<data-root>/
  control.sqlite          authoritative HISTOS registry and operation journal
  objects/<scope>/...     immutable exact payloads and JSON record revisions
  derived/...             disposable lexical/structural/vector/graph caches
  staging/...             incomplete writes, never returned as durable refs
  exports/...             selected Markdown/JSON/Git-friendly projections
```

Use a local filesystem, not an SMB/NFS or sync-folder database. SQLite WAL has a single concurrent writer and relies on same-host mechanisms [S6]. One daemon serializes short registry writes. Do not hold a transaction open during parsing, network calls or model inference.

## 2. Identity model

| Entity | Required identity/metadata |
| --- | --- |
| Scope | Opaque scope ID, owner, access-policy revision, explicit grants; default project isolation. |
| Source | Source ID, registered canonical root/connector binding, source kind, capture policy. |
| Snapshot | Source ID, worktree identity, base commit when applicable, captured-path manifest, byte digests, parser/config dependencies, completeness. |
| Artifact | Opaque artifact ID, scope, raw SHA-256, byte size, media/encoding, completeness, producer ref, retention/pin state. |
| Record | Stable record ID plus immutable revision ID, type, provenance refs and supersession links. |
| Derived artifact | Dependency manifest digest, extractor/schema/policy/tokenizer/embedding-space versions, coverage and exclusions. |
| Operation | Principal/scope, kind, idempotency key, normalized input digest, state, attempt/lease fence, output refs. |
| Capsule | Request and snapshot IDs, policy revision, rendered payload identity, selection receipt, bounded items. |

Digests prove byte identity, not truth, access or independent evidence. Opaque IDs are not bearer capabilities. Reauthorize every dereference. Do not reveal cross-scope deduplication through object IDs, hit statistics or errors.

## 3. Worktree snapshots

A Git commit identifies tracked committed content, not uncommitted edits, untracked files, configuration or a running host. Distinct worktrees/overlays cannot share a context cache merely because HEAD matches.

A snapshot manifest includes `source_id`, `worktree_id`, `base_commit`, sorted captured paths, per-path raw digest, excluded paths, capture generation, config/dependency identities and a completeness label. Approved untracked files may be included; ignored/secret/generated paths are excluded unless explicitly permitted. Paths are registry-relative; raw host paths are not portable IDs.

Capture by reading each allowed file, hashing exact bytes, then rechecking identity/changes before sealing. If files changed during capture, retry the affected set within budget or return `SOURCE_MOVED`. An ordinary filesystem walk is not an atomic whole-repository snapshot. Use a frozen checkout/worktree for a coherent repository-wide benchmark; otherwise label the captured scope and consistency limitation.

A capsule pins captured bytes. `context.read(ref)` returns those bytes or fails; it never silently substitutes current HEAD. A separate request obtains fresh current source. Before an edit or execution, the consumer rechecks the applicable source identity; HISTOS does not lock the user's repository for the duration of reasoning.

Runtime observations additionally carry collector identity, collection time, applicable environment and validity policy. They are not fresh just because their blob hash is unchanged.

## 4. Transactional publication

Proposed publication sequence for a retained artifact/record:

1. Reserve a typed operation and bounded storage quota; check idempotency and access.
2. Stream exact bytes into a same-volume private staging file, enforce limits and compute digest.
3. Flush and publish an immutable object using a platform-proven no-clobber primitive. Same digest is reusable only within allowed scope and verified metadata.
4. In one registry transaction, persist the revision/ref, head compare-and-swap, evidence links and operation outcome.
5. Commit before acknowledging success. Indexing/export jobs can follow asynchronously from the committed outbox.

Crash before step 4 can leave an orphan object; delayed orphan reconciliation may collect it only after proving no live operation/pin refers to it. Crash after commit but before reply is resolved by the idempotency key; never create a second memory or blindly rerun an external side effect.

Proposed uniqueness: `(principal_id, scope_id, operation_kind, idempotency_key)`. Same key and same normalized input returns the original outcome; same key with different input returns `IDEMPOTENCY_CONFLICT`. Mutation idempotency records outlive payload expiry and the declared retry horizon, preventing a late retry from recreating a purged record. Keep only non-sensitive replay metadata after purge.

No atomic transaction spans SQLite and the filesystem. The ordered protocol and recovery rules above close the gap; crash injection and Windows rename/flush semantics still require runtime tests.

## 5. Concurrency and background completion

Accepted memory heads use `expected_revision`; competing changes become explicit candidates/conflicts. No last-writer-wins overwrite of a decision or evidence lineage. All writes go through the service; user edits to exported Markdown enter the importer.

Long jobs claim leases with monotonically increasing fencing tokens. The commit transaction checks current lease token, input generation, target revision and policy revision. A resumed worker with an old fence may finish computation but may not publish. Lease expiry alone does not prove that a previous process stopped.

Changes arriving while a job runs increment a dirty generation. The worker records only its captured generation as processed. The successor generation remains queued. Exactly one active job per `(scope, job_kind, target)` is the target; crash recovery may execute work again, so output publication must be idempotent. Do not promise exactly-once execution across arbitrary failures.

## 6. Incremental invalidation

Cache key inputs include authorized scope, worktree/snapshot, content dependencies, parser/compiler version, policy version, representation level, budget profile, query/routing policy and tokenizer where output tokens matter. Embeddings additionally require model identity/dimensions and preprocessing version.

A symbol body hash alone is insufficient. Imports, types, config, lockfiles, macros, dependency versions, generated inputs and applicable runtime can change meaning without changing that body.

Maintain typed dependency edges from derived outputs to source revisions. A change marks dependents dirty, not immediately re-summarized. Bound traversal; if completeness is unknown or a traversal cap is reached, conservatively invalidate the enclosing file/module/scope rather than reusing an unproven result. Dynamic dispatch and unsupported parsers must declare incomplete coverage. File mtime is a hint; content identity decides cache validity.

For deleted/renamed content, keep immutable historical refs subject to retention, but remove it from current search eligibility. Access revocation invalidates cached delivery immediately, including explanations and compiled summaries. Rebuild new derived generations off to the side, then swap one committed active-generation pointer. Readers do not mix two index generations.

## 7. Retention and deletion

A large result is not automatically permanent memory. Each artifact records a retention class, expiry, consumers/pins and whether it is HISTOS's sole accepted evidence copy. Pin before handing off to a resumable run. Use explicit release or bounded pin renewal; show expired/dangling pins to operators.

Ordinary preview/cache eviction cannot delete pinned evidence. Disk pressure rejects or defers new capture rather than silently destroying required evidence. Access denial, ordinary expiry and explicit privacy purge are distinct operations.

Privacy purge may override a retention pin only under an explicitly authorized policy. Remove reachable content, derived indices, projections and scheduled jobs; preserve a minimal tombstone without the removed text. This intentionally makes old evidence unavailable. Propagate that fact to affected memories/capsules instead of claiming replay still works. Do not promise to retract content already sent to a model or pushed into third-party Git history/backups.

## 8. Backup, restore and migration

Back up the authoritative registry using a supported consistent backup method, with a generation manifest and the reachable immutable objects; preserve objects during the backup. SQLite documents its Online Backup API [S7]. Copying only a live database file is not the default backup protocol [S6–S7]. Derived stores need not be backed up.

Restore to a new data root, validate registry consistency and reachable object hashes, reapply the newest available revocation/purge ledger, and rebuild indices. If current revocation history is unavailable, do not expose restored data to clients until an operator reconciles access and deletion state. Restore must not resurrect a known purge.

Schema migration: stop new writes, checkpoint operations, produce and verify a backup, migrate transactionally, verify invariants, then reopen. Unknown newer schema fails closed. Rollback means restore a compatible checkpoint and retained objects, not point an old binary at a newer database.

[S6–S7]: see [sources](SOURCES_AND_REVIEW.md).

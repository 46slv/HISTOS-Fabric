# Externalized artifact store v0

Status: **Phase-1 candidate / local deterministic primitive**

This slice implements the roadmap's lowest-risk oversized-result primitive without introducing a daemon, database, MCP server, model call, background worker, or package dependency.

## Contract

`externalizeIfOversized` keeps payloads at or below an explicit byte threshold inline. Larger payloads are persisted under a SHA-256 content address and replaced with a bounded preview plus an immutable reopen reference.

The v0 operations correspond to the intended agent-facing concepts:

- `context.externalize` -> `externalizePayload` / `externalizeIfOversized`
- `context.read` -> `readArtifact`
- `context.search` -> `searchArtifact`

The API is an in-process module only. Names here do not freeze a future MCP wire protocol.

## Integrity and publication

Artifacts live at `sha256/<prefix>/<digest>.blob` beneath an explicit caller-supplied root. Publication uses a private same-directory temporary file plus an atomic hard link to the final content address. Existing final artifacts are never overwritten: an identical artifact converges to `EXISTS`, while mismatched stored bytes fail closed as `ARTIFACT_CORRUPT`.

Every read/search verifies the complete stored bytes against the reference digest and length before returning data. The reference therefore identifies exact bytes rather than a mutable path.

The store rejects symlinked content-address directories. v0 is designed for a local single-user trust boundary; it does not claim protection against a privileged process racing filesystem metadata between checks.

## Reopen semantics

`context.read` takes `start_byte` and `max_bytes` and returns exact bounded bytes plus UTF-8 convenience text. `context.search` performs deterministic case-insensitive literal line search over verified UTF-8-decoded content and returns line plus byte coordinates that can be passed back to `context.read`.

The canonical payload remains bytes. UTF-8 text is a convenience projection and may contain replacement characters for non-text input.

## Retention

Retention is deliberately **manual** in v0. There is no automatic cleanup or delete API in this slice. This avoids making unreviewed retention policy destructive. Later retention work must define leases/references, safe expiry, operator visibility, and recovery before deletion is added.

## Explicit non-claims

- no automatic interception of native Codex/OpenCode tool output;
- no active-context measurement yet;
- no tokenizer accounting;
- no daemon/MCP transport;
- no encryption/credential store;
- no multi-user hostile-filesystem security claim;
- no production retention/GC policy;
- no benchmark result claiming that externalization improves task success yet.

The next acceptance step is to connect this primitive to a reproducible benchmark that measures context reduction while preserving exact verification correctness, then expose the same contract through the eventual local service/MCP boundary.

# Phase 1-3 public component contract

Status: **EXPERIMENTAL IMPLEMENTATION**

This contract owns the provider-neutral in-process components implemented for
HISTOS Phases 1-3. It does not define an MCP transport, daemon, database,
embedding backend, model call, Mission authority, or production deployment.

## Externalized artifacts

`tools/externalize/artifact-store.mjs` exports:

```text
externalizeIfOversized
externalizePayload
readArtifact
searchArtifact
```

An artifact is immutable SHA-256-addressed bytes. Preview and range reads are
bounded, while a complete reopen verifies both byte count and digest. Retention
is explicitly manual: this component has no automatic expiry or delete API.
The caller may remove an artifact store only through its own retention policy.

## Source index and retrieval

`tools/index/source-index.mjs` exports:

```text
buildSourceIndex
loadSourceIndex
searchSourceIndex
readIndexedRange
validateIndexedScope
```

`buildSourceIndex` requires a canonical source root, separate derived-index
root, caller-owned `scopeId`, and explicit relative source inventory. It stores
no absolute source path. Each source record carries SHA-256, byte and line
counts, language, normalized line view, symbol outline and import dependency
outline. JavaScript/TypeScript function/class/binding symbols and Markdown
headings are supported initially. Other UTF-8 files retain lexical retrieval.

Every build hashes every scoped source to establish current identity. Parsing
and derived-record creation are reused when the digest is unchanged. Added,
modified and deleted paths are reported separately. `currentDiffPaths` accepts
an exact caller-supplied Git-diff path set and gives those candidates an
explainable proximity signal; paths outside the inventory are refused.

The index file is derived and uses manual retention. Delete
`source-index-v1.json` to remove it. `forceRebuild: true` reconstructs a corrupt
or unwanted derived index from current scoped source. It cannot reconstruct
source, and it never becomes current-truth authority.

Every search and reopen requires the exact `scope_id` and `snapshot_digest`.
A narrowed path scope may only be a subset of the indexed inventory. A stale
digest, broader path, changed source, missing source, corrupt index, traversal,
or explicit query for a filename absent from scope fails closed or returns a
typed no-match receipt. Search combines lexical line windows, symbol/section
ranges, path proximity and current-diff proximity. Ranking and tie breaks are
deterministic. Results contain source digest, inclusive line range, reasons and
an exact reopen object.

## Context Compiler

Index integrity, requested scope and current source hashes are verified before
compilation even when retrieval returns no candidates. A no-answer capsule
cannot bypass source validation.

`tools/context/context-compiler.mjs` exports the asynchronous
`compileContextCapsule`.

The compiler requires the source-owned `sourceRoot` and validated derived
`index`, then accepts a goal, exact scope, source map, already ranked source
candidates, token budget, and optional current-truth/evidence/memory references.
For every candidate it performs `readIndexedRange` against current source bytes
and verifies the indexed digest, real line bounds, exact text, scope/snapshot,
reopen operation and non-empty inclusion reason. Candidate text and coordinates
are never accepted from caller labels alone. Changed, deleted or inaccessible
source therefore fails compilation rather than serving stale indexed text. It
admits verified whole candidates in deterministic order and records every budget
omission.

The counted delivery surface is the entire `rendered_context`: goal, scope,
snapshot, data/non-authority warning, truth/evidence/memory references,
provenance and why-included headers, and selected text. Counting uses exact
`js-tiktoken@1.0.21` `cl100k_base`; 2,000, 4,000 and 8,000-token budgets are
supported through the same `maxTokens` input. Envelope fields outside
`rendered_context` are audit metadata and must be independently counted if a
consumer chooses to send the JSON envelope itself.

Each included source fragment contains its path, SHA-256, inclusive line range,
selection signals and reopen coordinates. The compiler does not infer authority
from retrieved text and makes incompleteness explicit.

## Verification

Run `npm test` for externalization, index lifecycle, drift/scope/corruption,
compiler budget and frozen comparison tests. Run `npm run bench:h01` for the
full public report. See `H01_EVALUATION.md` for the bounded measured result.

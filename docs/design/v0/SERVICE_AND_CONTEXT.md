# Service, context compiler and harness integration

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Updated: 2026-09-06

## 1. Deployment and ownership

A single `histosd` process owns a configured local data root. Agent sessions use thin clients; they do not directly open its database. An OS-level single-instance lock protects the data root. A PID or an existing port alone is not proof of ownership. A second launch either attaches to the verified instance or exits with a clear ownership error.

```text
Codex / OpenCode -- stdio MCP bridge -- authenticated local API -- histosd
EPHEMERA policy client ---------------- authenticated local API ----+
operator CLI / existing Console ------- scoped control/read API ----+
                                                                  |
                                  source adapters / artifacts / indices
```

The bridge is disposable; exiting it does not terminate the shared daemon. A foreground daemon is sufficient initially; automatic installation/startup is a later, explicit operating-system integration. Do not rewrite global harness configuration during installation without showing the exact change.

MCP supports standard transports; Codex and OpenCode document local/server configuration [S1–S3]. Prefer a stdio bridge to a shared daemon for the first integration. The bridge-to-daemon API is HISTOS's own authenticated local transport, not a claim of implementing the MCP HTTP authorization profile. Direct Streamable HTTP MCP is a later compatibility lane, implemented using the applicable MCP authorization/security requirements [S4–S5]. No public bind, tunnel or cloud upload is enabled by default.

Proposed service internals are one deployable unit: request validation, authorization, artifact registry, retrieval/compiler, and maintenance queue. Parser/model jobs may run in bounded subprocesses. Do not create a microservice per plane.

## 2. Small interoperability surface

Proposed v0 MCP names and internal operation mapping:

| MCP tool | Internal operation | Result |
| --- | --- | --- |
| `histos_context_compile` | `context.compile` | One bounded capsule, or an explicit insufficient/stale result. |
| `histos_context_search` | `context.search` | Ranked, paginated references and short excerpts; never an unbounded directory dump. |
| `histos_context_read` | `context.read` | Exact authorized range from a pinned artifact/snapshot. |
| `histos_context_explain` | `context.explain` | Bounded selection reasons and omissions for one receipt. |
| `histos_memory_capture_candidate` | `memory.capture_candidate` | Unpromoted revision proposal with evidence references; optional until H4. |

Memory/procedure lookup is a query mode of compile/search, not another dozen tool definitions. Admin methods and background controls are not registered as agent tools. Health/capabilities/version checks happen in the adapter before model invocation. Tool declarations, their descriptions and duplicated output representations count in context-cost measurements; OpenCode explicitly warns that MCP tools themselves add context [S2].

Trusted adapters additionally use streaming `artifact.put`, `source.snapshot`, `operation.get` and `operation.cancel`. A model should not serialize a giant tool result into `artifact.put` arguments: that has already spent tokens. Externalization belongs before model delivery.

Every request is bound to a transport-authenticated principal. A body field naming a project, role, model or Mission does not grant authority. `mission_ref` is optional opaque metadata; ordinary sessions do not manufacture a Mission. Core requests do not hard-code a model vendor.

## 3. Wire semantics

The [schema](contracts.schema.json) intentionally specifies only compile requests, capsules and candidate capture. Search/read/admin and durable database schemas must be finalized in their delivery slices using these semantics, not improvised by adapters.

- Protocol identifiers are `v0-draft`, not a stable `v1` promise. The handshake rejects incompatible major versions. Unknown core fields are rejected; future extensions require advertised capabilities.
- `request_id` correlates an attempt; it is not an authorization token. Persistent mutations also carry an idempotency key. Scope, snapshot and policy versions are explicit.
- `context.read` takes an opaque ref and byte range or mapped line range, never an arbitrary filesystem path/URL. Unauthorized and unknown refs receive the same external `NOT_FOUND_OR_DENIED` class.
- Every page has a deterministic limit and a scope/snapshot-bound cursor. Limit tool return bytes independently of token estimates. `has_more` is not an instruction to fetch everything.
- `context.compile` is observational. Telemetry may be written, but compile never changes semantic memory, confirms evidence or activates automation.
- Status `ready` means the returned items are coherent for the stated scope/snapshot, not exhaustive or sufficient for all reasoning. `partial` lists missing coverage. No result is a certificate of project correctness.

Errors include `INVALID_REQUEST`, `VERSION_UNSUPPORTED`, `NOT_FOUND_OR_DENIED`, `SNAPSHOT_MISMATCH`, `STALE_REFERENCE`, `SOURCE_UNAVAILABLE`, `INSUFFICIENT_BUDGET`, `RATE_LIMITED`, `QUEUE_FULL`, `STORAGE_UNAVAILABLE`, `INTEGRITY_FAILURE` and `OPERATION_UNKNOWN`. Retriability and `retry_after_ms` are explicit. A failed operation does not silently fall back to broader access, an older branch, a remote provider or an unbounded file read.

## 4. Compile pipeline

1. Authenticate; intersect caller grant, requested scope, privacy class and provider-egress policy. Resolve one immutable snapshot or reject. A client may only narrow its grant.
2. Select retrieval paths from task type: exact symbol/name, diagnostic text, recent edit, documentation question, or prior procedure. Start with exact/lexical and structural methods; embeddings/LLM reranking are optional.
3. Search only the authorized snapshot partition. Impose per-provider time, candidate and byte ceilings. Apply the same authorization to graph neighbors, summaries and explanations.
4. Normalize candidate refs; deduplicate overlapping ranges. Expand dependencies only to an explicit hop/edge budget. Record unresolved/dynamic edges rather than treating parser output as a complete call graph.
5. Rank by task relevance, evidence applicability and diversity. Recency is one feature, not authority. Import/reference links are evidence of relationships, not necessarily causation.
6. Choose representations: outline/signature, focused body, or exact evidence. Pack under the full rendered capsule budget. Add exact reopen refs and visible unknowns. Prefer removing optional prose over mandatory identity/provenance.
7. Recheck policy generation and source identity as required before publishing a selection receipt. Never mix items from two incompatible snapshots. Return a capsule pinned to the checked snapshot, not a promise that the live tree cannot change later.

A broad architecture question may use reviewed summaries; an edit or numeric-verification question may require raw ranges. Do not force every task into a fixed few-thousand-token answer. When necessary evidence does not fit, return `insufficient_budget` or a bounded `needs_context` request to the calling harness. The harness can grant another bounded read or split the task. Retrieval reduction must not turn into evidence suppression.

## 5. Budget contract

Separate three ledgers:

- **Capsule/output budget:** exact model-visible rendering, including headers, paths, wrappers, previews and provenance. Budget all native or duplicated `content`/`structuredContent` forms actually delivered by the adapter.
- **Task/session budget:** repeated compile/search/read calls, reader subagents, reranking and answer/test repair. A small capsule can still be inefficient after fifty calls.
- **Maintenance budget:** indexing, embeddings, model summaries and sleep; separate foreground and background reservations.

The caller supplies available context headroom after its own instructions, prior history, tool declarations and output reserve. HISTOS cannot observe that entire window in MCP-only mode. Without a compatible tokenizer and verified renderer, return byte limits plus `budget.measurement=estimate`; do not advertise a hard token guarantee. Full-token enforcement belongs to the managed adapter/harness as well as the compiler.

Initial benchmark profiles are 2k/4k/8k **capsule** tokens, not model-window sizes or promised optimums. No fixed allocation ratios are universal. A compact lookup may consume much less. Candidate caps, hop limits and latency deadlines remain tunable versioned policies.

Do not optimize only compression ratio. Use total cost per verified result and required-evidence recall; include cold-start and amortized warm costs. A cache hit that delivers stale advice is a failure.

## 6. Externalization

The producing adapter streams an allowed payload to private staging storage with a hard byte limit, then verifies exact bytes and commits an artifact reference. Only after success may it substitute a bounded preview/ref for the raw output. Preserve error/exit status, the tool call identity, content type, raw byte length, digest, encoding and producer truncation status. For large outputs, no tokenization of the full payload is required before externalization.

`payload_complete=false` means the producer truncated or capture stopped; it cannot support claims about omitted output. Text decoding/line-ending normalization produces a separate derived artifact with coordinate mapping. It must not overwrite exact evidence bytes. Binary artifacts remain refs with media-specific retrieval, not invented text.

If persistence fails, keep a failure indicator and use a consumer-owned safe fallback or stop the affected step. Do not claim exact recoverability, discard the only evidence copy or flood a strict context budget with raw output. Retention pins and expiry are defined in the storage owner.

Externalization after the host has already sent text to its model does **not** refund tokens or remove prior history. Claims of savings require proof of pre-delivery interception.

## 7. Integration grades

| Grade | Capability | Guarantee |
| --- | --- | --- |
| A: assisted MCP | Agent deliberately calls HISTOS search/compile/read | Bounds HISTOS outputs only. Native file reads and other servers remain outside HISTOS control. |
| B: managed adapter | Supported pre-model hooks or caller wrapper, scoped event capture | May externalize supported tool outputs and supply session budgets; each interception point must be tested. |
| C: isolated runner | Caller materializes approved capsule and mediates additional reads | Enforces exact role scope and aggregate context policy with the runner. |

Codex v0 targets grade A. Official MCP documentation establishes configuration/transport support, not a universal pre-delivery interception hook [S1]. A future app-server wrapper is a separate integration; operating it is not equivalent to transparently modifying ordinary Codex sessions [S8]. Do not patch undocumented conversation databases or imply that all chat history is available.

OpenCode v0 also targets grade A. Its plugin documentation exposes tool/session events [S3], making grade B a candidate. Pin a version and prove tool output timing, cancellation, duplicate delivery and session handling before claiming capture/compaction. Plugin existence alone does not prove interception before token consumption.

EPHEMERA Harness targets grade C: the trusted runner uses HISTOS for discovery, materializes exact permitted inputs, and gives Worker/Verifier a narrowed reference set or mediated `needs_context` path. A broad daemon token must never become an escape hatch around the Context Firewall.

## 8. Interface acceptance and portability

Both Codex and OpenCode must use the same logical compile/read contract against the same snapshot, with EPHEMERA stopped. Exact installation/config examples are delivered only after the corresponding binaries exist. Test removal/reconnection without memory loss and no automatic provider/model switching.

Core records must be independent of MCP transport, UI and model names. A standard API is not sufficient to guarantee identical tool use across models; pilot measurements cover actual calls and missed retrievals.

[S1–S8]: see [sources](SOURCES_AND_REVIEW.md).

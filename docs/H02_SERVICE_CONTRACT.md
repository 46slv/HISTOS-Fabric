# Phase 4 shared local service and MCP

Status: **EXPERIMENTAL IMPLEMENTATION / native evidence awaiting independent acceptance**

This component exposes the public H01 source index and asynchronous Context
Compiler to multiple local clients. Ranking, source identity and token counting
remain owned by H01. There is no Mission, scheduler, memory authority or model
provider in the service. Existing `js-tiktoken@1.0.21` is reused; the service and
MCP adapter add no dependency.

## Process and source boundary

`tools/service/context-service.mjs` exports `installProfile`, `loadProfile`,
`refreshProfile`, `executeContextOperation`, and `startContextService`.
One daemon owns one isolated profile and explicit source inventory. Installation
refuses an existing profile directory and a profile inside the source tree.
The canonical created directory is resolved before persisting paths, including
Windows packaged-application LocalAppData redirection.

The daemon binds only `127.0.0.1` on an ephemeral port. Every HTTP request requires
the private profile capability and exact instance ID; wrong Host, any browser
Origin, missing capability and stale instance are refused. The internal HTTP
API is a local service protocol, not advertised as Streamable HTTP MCP. Native
clients launch separate `tools/mcp/context-mcp.mjs` stdio bridges; both connect
to the same daemon. Profile paths and capabilities never appear in tool results.
The local profile belongs to the trusted operating-system user; its capability
is not a multiuser or remote authorization system.

`service.lock` excludes a second daemon. `endpoint.json` records profile ID,
instance UUID, PID and start timestamp. Stop requests address the authenticated
current instance rather than killing a PID by name. Cleanup checks ownership
before removing endpoint and lock. Normal restart reuses the derived index and
source identities; each request rereads endpoint identity, so a bridge can use a
restarted service. Source changes fail closed until explicit `index` refresh;
old snapshot requests remain invalid after refresh. A corrupt index is not
silently rebuilt by the service.

The current restart proof is a controlled stop/start. Crash-stale locks require
the operator to verify exact process ownership before removing the derived
lock; automatic crash recovery is not implemented here.

## Four read-only tools

Each call requires exact `scope_id` and `snapshot_digest`. Optional `paths`
can only narrow the configured inventory. Every operation validates the entire
requested path scope against live source bytes, including no-match search and
explanation. H01 source manifests may identify the full configured inventory;
only requested paths contribute source content and compiler truth references.

| Tool | Additional inputs | Result |
| --- | --- | --- |
| `context_search` | `query`, optional `max_candidates` | Ranked source fragments, SHA-256, inclusive lines, signals, reopen coordinates. |
| `context_read` | `path`, `start_line`, `end_line` | Verified exact source range and digest. |
| `context_compile` | `query`, `goal`, `max_tokens`, optional `max_candidates` | H01 capsule with source-derived current-truth refs, rendered context and budget receipt. |
| `context_explain` | Same inputs as compile | Deterministic recomputation of selection, scores, reasons, omissions and budget; no source text. |

The service derives current-truth refs from scoped indexed files only after
fresh source verification. Clients cannot provide arbitrary roots, candidate
text, evidence, memory or truth claims. Unknown arguments and tools are rejected.
Limits are 30 candidates, 500 read lines, 4,096 characters per query/goal,
8,000 compiled tokens, 64 KiB requests and 2 MiB result envelopes. The token
ceiling covers `rendered_context` as defined by H01. The complete MCP JSON audit
envelope is larger and is not claimed to fit that delivery budget.

`context_explain` recomputes the exact inputs against current source; it is not
a receipt lookup that can return stale source conclusions. Different goals,
queries, scopes or budgets can produce different selection receipts. Source
material is data and cannot grant authority.

## Local installation and operation

Use the qualified Node runtime and this checkout's installed dependencies.
Create an operator-owned JSON manifest with absolute `profileRoot` and
`sourceRoot`, a unique `scopeId`, and explicit relative `paths`. Its parent
profile directory must already exist. Do not place private profile data in Git.

```sh
node tools/service/service-cli.mjs install /absolute/manifest.json
node tools/service/service-cli.mjs serve /absolute/profile
node tools/service/service-cli.mjs health /absolute/profile
node tools/service/service-cli.mjs index /absolute/profile
node tools/service/service-cli.mjs stop /absolute/profile
```

`serve` remains in the foreground and logs startup identity only to stderr;
use an owned hidden process when backgrounding it on Windows. `health` reports
the fresh scope, instance identity and four tools. To restart, stop the exact
instance, wait for process exit, then run `serve` and verify health. The index
command updates only this profile's derived index. Source inventory changes
require a separately reviewed profile installation.

Configure each native client with the same stdio command array:

```text
<absolute-node> <absolute-checkout>/tools/mcp/context-mcp.mjs <absolute-profile> <client-label>
```

For Codex, use a per-invocation `-c mcp_servers.histos=...` override with command,
args and the four `enabled_tools`. For OpenCode, use process-local
`OPENCODE_CONFIG_CONTENT` with `mcp.histos.type="local"` and that command array.
The verified native runs used Codex `--ignore-user-config` and OpenCode `--pure`,
existing account authentication, and explicit restrictions to HISTOS tools.
They did not add user/global MCP settings or an EPHEMERA Mission. MCP uses
newline-delimited JSON-RPC stdio, initialize/initialized, ping, tools/list and
tools/call. Tool failures use `isError`; protocol failures use JSON-RPC errors.

Normal rollback is stopping the newly installed profile and dropping its
per-invocation client settings. Retention is manual: the profile contains
configuration, a rebuildable index and telemetry. Preserve any wanted evidence
and verify the exact stopped profile before deleting it through the operator's
authorized cleanup workflow. There is no automatic deletion or uninstall of
existing configuration, source, credentials or other profiles.

## Verification and limits

```sh
node --test tools/service/context-service.test.mjs tools/mcp/context-mcp.test.mjs
```

Six focused tests exercise real local HTTP and subprocess stdio, shared clients,
all four operations, source reopen and token recount, stale source including
no-match/read, explicit incremental refresh, corrupt index, narrowed scope,
traversal/excluded files, invalid inputs, endpoint admission, installation
collision, duplicate daemon and controlled restart. The existing H01 suite
remains separately required.

Windows native worker evidence on 2026-09-08 used Codex CLI 0.153.4 and
OpenCode 1.18.29, both with the frozen three-source public corpus. Both native
harnesses called all four tools, received the same source hashes and selection,
and observed out-of-scope read refusal. Both compiled the test context to
1,438 of 2,000 tokens. The same owned daemon served both, then a controlled
stop/start preserved source identity. These are bounded host observations,
not a claim about every repository, long-running availability or a Mission E2E.
Private session exports, binary identities, logs and exact candidate hashes
belong to the program evidence store; raw local paths/transcripts are not
published in this repository. The independent parent verifier owns acceptance.

Best-effort `telemetry.jsonl` records operation, client label, outcome, elapsed
milliseconds, request/response hashes and delivered bytes without query or
source text. It enables matching HISTOS exposure/latency measurements to a
separately collected baseline. It is not a durable Mission journal, billing
report, or proof that HISTOS beats baseline exploration.

Protocol/configuration references: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[OpenCode local MCP servers](https://opencode.ai/docs/mcp-servers/).

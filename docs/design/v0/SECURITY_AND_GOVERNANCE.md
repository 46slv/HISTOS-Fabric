# Security, scope and governance

Status: **DRAFT DESIGN / NOT IMPLEMENTED**  
Updated: 2026-09-06

## 1. Trust boundary

HISTOS may read more source than an individual model is allowed to see. That makes the service a potential confused deputy, not a harmless cache. Threats include hostile repository text, a compromised agent, cross-project retrieval, stolen client tokens, filesystem traversal, stale grants, unbounded output and private-code delivery to an external model.

The local OS user remains an important boundary: a same-user process with unrestricted access to all files and credentials cannot be contained merely by HISTOS logical scopes. Strong Worker isolation requires OS/harness sandboxing and withholding broader credentials. Administrator/root compromise and already-exfiltrated data are outside v0 guarantees.

## 2. Effective access

For every read/capture/promotion, compute:

```text
effective_access = owner_grant intersect client_grant intersect session_grant
                   intersect requested_scope intersect data_class_policy
                   intersect destination_provider_policy
```

A role/model name, `scope_id`, Mission reference or query text is a request selector, not a grant. A client cannot choose a less restrictive provider identity to bypass egress rules; destination policy is adapter-authenticated/configured.

Default: project-scoped read; narrow candidate submission; no cross-project search; no global memory promotion; no automatic external model use. Broader read can be pre-authorized once per workflow instead of asking on every file. Project/user/system namespaces are not automatic inheritance of permissions.

Apply authorization before graph traversal, lexical results, embedding/reranking/model calls, cached-summary reuse, previews, pagination totals and explanations. `why_excluded` cannot reveal a confidential file title or hidden memory. A derived summary has at least the combined restrictions of its inputs. Declassification requires an explicit new reviewed artifact, not removal of source links.

## 3. Agents, operators and EPHEMERA

| Capability | Ordinary agent | Trusted capture/runner adapter | Local operator / delegated policy client |
| --- | --- | --- | --- |
| Search/read/compile | Configured scope | Configured scope or exact role materialization | Configured scopes |
| Upload exact tool evidence | No unrestricted arbitrary path ingestion | Approved producer streams and bounded refs | Explicit import |
| Submit memory candidate | Yes, bounded | Yes | Yes |
| Accept memory revision | No by self-report | Only under separately delegated policy | Policy-controlled, audited |
| Manage scopes/retention/egress | No | No by default | Explicit administrative grant |
| Activate project Tool/Skill/workflow | Never through HISTOS | Consumer's separate authorization only | Project/user/EPHEMERA authority, outside HISTOS |
| Advance Mission state | Never | Never through HISTOS | EPHEMERA only, outside HISTOS |

EPHEMERA is not automatically a superuser because of its name. It receives revocable, scoped credentials like any policy client. Standalone HISTOS uses a local owner policy so Codex/OpenCode can function with EPHEMERA stopped. HISTOS enforces access to its own data; it does not own project execution authority.

## 4. Transport and path handling

Initial private bridge transport uses an OS-user-protected, revocable client credential stored outside Git and outside model-readable context. Bind only the configured loopback interface; validate Host/Origin for browser-facing HTTP and never use permissive CORS. Use standard authenticated transport components. Direct HTTP MCP must meet the applicable MCP requirements [S4–S5]; do not forward HISTOS credentials to upstream data providers.

Filesystem adapters register roots through the trusted operator surface. Resolve canonical paths and verify containment, including symlinks, Windows junctions/reparse points, drive/UNC paths and case rules. Do not trust a string prefix. Refuse unsupported escape-proofing cases rather than opening a broad root. A source reader may inspect Git data but must not execute repository hooks, scripts or model-generated commands during indexing.

Parsers/LSPs may read imported libraries and configuration: run them with an approved read surface or explicitly treat that broader analysis scope as privileged. A parser subprocess with broad filesystem access must not leak its findings to a narrow client.

URL sources require connector-specific allowlists and authenticated bindings. No arbitrary-URL fetch proxy. Bound redirects, schemes, byte counts and deadlines, and block unintended internal/metadata destinations where network fetch is later introduced.

## 5. Provider privacy and untrusted text

'Local storage' does not mean 'local processing'. Embedding, reranking, reflection and Skill generation can all transmit content. Every model job declares provider endpoint, data classes, transmitted fields, budget and retention/training policy profile. Unknown destination or insufficient consent means use local deterministic retrieval or return a blocked/deferred capability, not automatic cloud fallback.

Knowledge, code comments and tool output are untrusted **data**. They never become developer/system instructions, permission changes, executable Skills or administrative requests through retrieval. Preserve provenance and origin labels. A malicious instruction found in a document is not safer after an LLM summarizes it.

Raw transcripts are not the default memory input. Collect minimal authorized episodes, typed outcomes and evidence refs. Secrets filtering is defense-in-depth, not proof that arbitrary logs are public. Sensitive raw artifacts may remain local-only while a separately reviewed redacted derivative is used by an agent. Never silently alter raw evidence and retain its original digest.

## 6. Isolation and revocation

EPHEMERA role materialization may be stricter than ordinary daily use. A role-scoped bridge can dereference only the exact allowed source/evidence set. An opaque ref obtained from another role does not bypass this. No inherited broad daemon/admin credential in Worker environment, tool arguments or capsule.

Check authorization again before response publication. A policy-generation change during retrieval invalidates/restarts delivery. Revocation prevents future retrieval but cannot remove text already in a model's context. The host must terminate/rebuild the affected context when its threat model requires that stronger guarantee.

## 7. Observability and export

Default operational logs carry IDs, sizes, durations, status codes and policy versions, not full prompts/results. Query text and snippets are data-classed, opt-in retention. The Console shows provenance, source ownership, scope and freshness, but an operator screen has no implicit authority beyond its authenticated principal.

Git export is explicit, destination-checked and limited to selected non-secret records. Do not automatically push private sessions into the public HISTOS source repository. Repository publication authority and local memory revision acceptance are separate.

Markdown/Obsidian edits are parsed into candidates carrying `expected_revision`; a concurrent machine edit creates a conflict for review. Frontmatter cannot edit policy or mark itself verified. File deletion in a view is not automatically a privacy purge. Imports must survive rename, duplicate stable ID, invalid YAML and dropped evidence-link tests.

## 8. Mandatory negative tests

Cross-scope cached-summary leakage, graph-neighbor leakage, spoofed principal/provider, stale grant at response time, invalid Origin/Host, ref replay from another role, symlink/junction escape, secret in logs/export, malicious memory instructions, and forgotten-data resurrection are release-blocking. Test both plain retrieval and compiled/derived results; a secure raw-read path alone is insufficient.

Sources: [S4–S5](SOURCES_AND_REVIEW.md). Detailed case IDs live in [acceptance](DELIVERY_AND_ACCEPTANCE.md).

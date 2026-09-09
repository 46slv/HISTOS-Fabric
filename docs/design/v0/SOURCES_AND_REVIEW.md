# Primary-source checks and design review

Status: **RESEARCH / DESIGN REVIEW, NOT RUNTIME CERTIFICATION**  
Checked: 2026-09-06

## External facts used in this package

| ID | Primary source | What was checked / limitation |
| --- | --- | --- |
| S1 | [OpenAI: Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) | Local/project configuration, stdio and Streamable HTTP support. This does not establish a universal native-tool interception hook. |
| S2 | [OpenCode: MCP servers](https://opencode.ai/docs/mcp-servers/) | Local/remote integration and tool-definition context overhead. Client version still needs a host probe. |
| S3 | [OpenCode: plugins](https://opencode.ai/docs/plugins/) | Tool/session event hooks are documented. Pre-model interception timing and compatibility are unverified here. |
| S4 | [MCP transport specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | Local binding, Origin checks and authentication guidance. This is a pinned reference edition, not a claim that HISTOS implements a protocol version. |
| S5 | [MCP security best practices, 2026-07-28](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) | Audience validation, token-passthrough/confused-deputy and SSRF risks. A private local API and direct HTTP MCP need distinct documented authentication profiles. |
| S6 | [SQLite: WAL](https://www.sqlite.org/wal.html) | Single concurrent writer, same-host/network-filesystem limitations, durability and WAL backup considerations. Exact bundled version must be evaluated at implementation. |
| S7 | [SQLite: backup API](https://www.sqlite.org/backup.html) | Consistent backup mechanism. HISTOS object/registry backup coordination still needs its own tests. |
| S8 | [OpenAI: Codex App Server](https://learn.chatgpt.com/docs/app-server) | A separate deep-integration surface for rich clients/events. Not treated as an automatic hook into every existing Codex session. |

These are factual inputs, not dependencies installed or services connected in this change. ReMe/Hindsight/Letta/Aider/Serena and other earlier candidates remain in [RESEARCH.md](../../RESEARCH.md); their individual features and performance claims were not all re-audited in this pass. Do not promote that older survey into an adoption decision.

## Internal basis

Read live HISTOS `main` at `7430a822493a8bca17eb542230b0d6c5aa0fb116`: repository tree, architecture, ecosystem relationships, roadmap and documentation router. The root contained documentation only and no open PR was returned at opening inspection. These are a dated observation, not a permanent implementation-status source.

No private source payload, user transcript, credential or machine topology is needed in this public design package. EPHEMERA-specific authority remains described at the relationship level; existing repositories were not migrated or changed by this design pass.

## Design audit and refinements

| Concern | Resolution in this draft |
| --- | --- |
| Independent service still relies on EPHEMERA for every approval | Local owner policy plus scoped EPHEMERA delegation; Mission authority stays external. |
| 'MCP connected' implies all tool output automatically shrinks | Explicit assisted/managed/isolated grades; pre-delivery proof required. |
| Every SQLite row is described as rebuildable | Separate durable registry/record truth from derived index/cache state. |
| Hash cache accidentally shares two dirty worktrees | Worktree/snapshot/environment/policy dependencies in cache identity. |
| Four-thousand-token capsule ignores twenty lookup calls | Capsule, task/session and maintenance ledgers counted separately. |
| Retrieved memory repeatedly confirms itself | Original event/lineage groups, no caller-controlled verification. |
| 'Drop all tool output' also discards real test evidence | Producer-aware source/evidence/retrieval classification. |
| Read isolation bypassed by a broad local memory server | Role-scoped refs and runner mediation; no inherited broad client token. |
| Stale job publishes after retry or revocation | Lease fencing, dirty generations, expected revisions and policy recheck. |
| Markdown/Git becomes a competing mutable authority | Projection + CAS revision proposals; explicit export publication. |
| Privacy deletion conflicts with permanent evidence | Explicit authorized purge, tombstones and disclosed loss of replay. |
| A restored backup silently resurrects deleted content | Reconcile current revocation/purge history before serving. |
| New system must implement every long-term phase before use | H0–H3 first useful loop; H6 can integrate it without the entire memory stack. |

This is a self-review, not an independent external design approval. The design still needs implementation/host tests and independent benchmark annotation review. The accompanying fixture validation record, when present, describes static checks only; all runtime conformance cases remain `NOT_RUN`.

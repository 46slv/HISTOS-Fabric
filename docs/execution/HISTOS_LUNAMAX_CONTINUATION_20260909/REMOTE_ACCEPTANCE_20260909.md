# HISTOS-V1-OPERATIONAL-LOOP remote landing acceptance

Status: `REMOTE_CANDIDATE_ACCEPTED`

This file is the non-secret acceptance surface for the completed HISTOS candidate. It records identity, lineage, requalification and authority boundaries; it does not authorize a protected-branch merge, release or package publication.

## Exact identity and ancestry

- The reported `FINAL_CANDIDATE` string `daa65fefa1e4b0222356e664556d87e3f8bf4d14` is not a Git object. The exact Git object is `daa65fefa1e4b0222356e664556d87f3e8bf4d14` (`commit`, parent `c2088be60a7359d14a42f69acb08495133d9969f`, tree `fae991763b26992738f99f9d3c85c920ce1f4e2e`).
- The exact state checkpoint is `639fc5769abeb2db5f7193615bab1f54a2004f55` (`commit`, parent `b1e8202cc66cb80246e004a1f736b185fc16f0c2`, tree `a76f3117eb38b0a58627cb43a7b5ab995cfcbf0f`).
- `daa65fe...` is an ancestor of `639fc57...`; the only changed path between them is `docs/execution/HISTOS_LUNAMAX_CONTINUATION_20260909/STATE.json`. No implementation or test path changed in that checkpoint.
- The candidate descends from `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30`. The checkpoint's `STATE.json` is the source of the `PROGRAM_DONE` and `FIRST_USABLE` status; the earlier implementation candidate's state still correctly showed R11 in progress.
- The fetched remote `execution/histos-lunamax-continuation-20260909` is `d09385d778303d1a46759c6e8cc2e68067bbff0b` (tree `132083d8fe50e068cae37b399c045782555cd141`), based on `fe51dd378101c3f52ff7e7bae3010bfb98332e81`, and is not an ancestor of the verified checkpoint. Its plan-only `PREFLIGHT` state and deletion-heavy post-program commit are retained as a separate historical line. No force-push is used.

The landing branch is based on the verified state checkpoint `639fc5769abeb2db5f7193615bab1f54a2004f55` and is intentionally non-protected.

## Fresh requalification

Fresh detached worktrees were created from both exact identities. `npm ci --ignore-scripts` completed with two packages and `0 vulnerabilities` in each worktree.

### Repository regression

- `daa65fefa1e4b0222356e664556d87f3e8bf4d14`: `npm test` -> **162 tests, 162 pass, 0 fail, 0 skipped**.
- `639fc5769abeb2db5f7193615bab1f54a2004f55`: `npm test` -> **162 tests, 162 pass, 0 fail, 0 skipped**.
- The aggregate command names the 27 repository test files exactly once. No test suite was removed or skipped for this landing.

### H01 frozen benchmark/readback

Both exact identities were rerun with `node tools/bench/h01-benchmark.mjs bench/public-gold-v1.json bench/public-gold-freeze-v1.json bench/evidence/public-baseline-v1-portable.json`.

- suite: `public-chatgpt-mcp-v1`
- gold SHA-256: `146cc45d9ba119376fa7ec8feec838966bfcc9472e5da55da8127857f7a90ad6`
- manifest SHA-256: `fa4d2f0ecc33aef32720f38a40489e4166e2854dd25695a921db091a3ba377d2`
- freeze SHA-256: `3eea13213ead69b52b6b7e3b11c4690b77ccebdaf2be1ea6e0d11faa1c0c2903`
- cold index: 3 files parsed; warm index: 3 files reused
- all/held-out complete evidence-group recall: `1.0` / `1.0`
- all no-answer: `1/1`
- rendered tokens: `6047`; raw source bytes exposed: `15935`
- snapshot: `a4c14651a7c430a8d2c701b43eaaf3f16463e78f7ad9b62d451fe403a9cfb7ec`

The H01 claim is deterministic retrieval/context-acquisition measurement on the frozen public corpus, not a model-quality or production-service claim.

### FIRST_USABLE user flow

The final verifier was rerun against the exact implementation candidate in a fresh worktree. Criteria 1-6 are PASS: owned profile/service restart; independent Codex and OpenCode read-only MCP clients; same-snapshot search/compile/exact-read/explain with out-of-scope refusal; evidence-linked memory with `authority=none` and `current_truth=false`; stale source refusal (`SOURCE_STALE`) until explicit refresh; and no global/user config mutation during the run. Criterion 7 is satisfied by the exact-candidate `npm test` result above.

The verifier observed the same scope and snapshot, two independent provider children returning the same record, two independent supports, and a changed snapshot only after explicit refresh. The process-local MCP stale child was not counted as a PASS when its service was unavailable; the direct stale read and refreshed read are the accepted gate evidence.

Fresh receipt readbacks are content-addressed locally as candidate-flow `be0a9ca42b648786d8a35fa445e6d3a61893bdb4cfc9aaeb19e8917f31dc0af4` and checkpoint-flow `315f421352262b80b652d9ebe06c7eea9f44966b52da1e1c2060fd97b5d9a632`; both contain criteria 1-6 PASS and the exact candidate/checkpoint identity. The prior canonical final receipt remains a separate historical receipt and was not used as the sole gate.

## Native and compatibility evidence

The following are immutable receipt readbacks from the accepted R5/R9/R10 evidence recorded in `STATE.json`; they are not reclassified as new local-model runs in this landing step.

- Codex `0.147.0` process-local projection probe: trigger and non-trigger PASS, exact markers, read-only project-local skill read, no global config pull. Receipt digests: trigger `905577c45eef47c0d215a8021adc5dd96125a7287785a0179a8d2c38a72620ba`; non-trigger `6be93d015c897c9708ac63532fc4c5490a4d71e3a11698c8f828b490fc494174`.
- OpenCode `1.18.29` process-local projection probe: trigger and non-trigger PASS, exact markers, isolated project skill activation. Receipt digests: trigger `3af2ded89a7b0ecec3646f71bda038208aa4c4eea73dee9c142b660dd1c17e69`; non-trigger `92b08e8e155da78828ba74caf1527614e1bb9b5eb12c573d4295555ae71b5aa0`.
- Kura comparison is read-only and scope/budget bound; writes/admin calls and raw-store mutation are refused at the call boundary. The Kura report preserves quote/evidence descent and stale/restart checks.
- EPHEMERA compatibility uses the provider-neutral H05 seam; Mission/Goal transition calls remain `0`. HISTOS remains a context/evidence substrate, not Mission authority.
- R10 recovery/security regression is `1/1` with seven bounded refusal/recovery probes; no network, model, paid-provider or credential operation is part of the accepted run.

## Coordinator model proof

The landing Coordinator's fresh Codex session metadata, not prompt text, records:

- session `01a08580-cfb4-7243-974a-376496888858`, provider `openai`, origin `Codex Desktop`;
- session-meta provenance model `gpt-5.6-luna`;
- turn-context model `gpt-5.6-luna`, effort `max`, and collaboration settings `model=gpt-5.6-luna`, `reasoning_effort=max`;
- the active config readback also reports `model = "gpt-5.6-luna"` and `model_reasoning_effort = "max"`.

## Authority invariants

- No force-push, protected/main merge, tag/release/package publication, credential or permission change, or destructive cleanup was performed.
- HISTOS memories, compiled understanding, provider envelopes, operation candidates and A00/A01 projections retain `authority=none` and `current_truth=false` where required.
- Kura is read-only; Agent Skill projection is a procedure projection and does not grant activation authority.
- EPHEMERA-System remains the external Mission/Goal/Task authority. No transition or consequential-action authority moved into HISTOS.
- No private temporary receipts, transcripts, credentials, or machine-specific configuration files are included in this acceptance commit.

## Lineage reconciliation

| Line | Classification | Disposition |
| --- | --- | --- |
| PR #1 `docs/detailed-design-v0-20260906` | Historical accepted-design proposal, not runtime | Retained; superseded as the latest design entry by PR #4, no closure required |
| PR #2 `automation/histos-h0-benchmark-core-20260906` | Earlier independent H0/externalization baseline | Retained; implementation lineage is incorporated through the program branch |
| PR #3 `automation/histos-program-test-aggregate-20260909` | One-file aggregate-test repair candidate | Incorporated in the final aggregate and superseded by the later full-suite package script |
| PR #4 `docs/research-synthesis-20260909` | Research/design input and candidate map | Retained independent; its mappings informed R1-R10, no direct merge implied |
| PR #5 `execution/histos-lunamax-continuation-20260909` | Plan/continuation contract on the diverged remote line | Retained historical; this landing branch supersedes its plan-only head for acceptance |
| `program/ephemera-full-20260908-delivery` | Accepted implementation base | Incorporated as the direct ancestor of the candidate |
| `landing/histos-v1-operational-loop-20260909` | Exact checkpoint landing surface | New non-protected remote acceptance line |

## Landing gate

The first post-push remote readback verified head `a03fd8b330c7d0d53a3469e5b0c168e73ef665b7`, tree `e0952e28352df24364724a4255ce58328839708d`, parent `639fc5769abeb2db5f7193615bab1f54a2004f55`, a clean worktree, `PROGRAM_DONE`/`FIRST_USABLE=PASS`/R11 `DONE`, exact aggregate coverage `27/27`, and `git diff --check=PASS`. The final fast-forward commit carrying this status is independently re-run after push; `REMOTE_CANDIDATE_ACCEPTED` means the non-protected remote candidate passed that exact-SHA gate, not that a protected merge or release occurred.

Protected merge remains outside this run.

Learning Gate: `CAPTURED_OR_MECHANIZED` — the candidate/state distinction, aggregate coverage, frozen H01 identities, stale-read semantics and authority boundaries are recorded in repo-local state/tests and this acceptance surface.

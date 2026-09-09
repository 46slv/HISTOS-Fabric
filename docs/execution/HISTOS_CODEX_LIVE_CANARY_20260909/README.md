# HISTOS × Codex live canary

Status: **EXECUTION CONTRACT / PREFLIGHT_REQUIRED**  
Created: 2026-09-09 JST  
Base: `main@f3051b088cfb28f04d90b65ce6287657a4317cf3`

This package drives a real ordinary Codex session against HISTOS, verifies that HISTOS use is observable and durable, and repairs the smallest missing runtime pieces required to make the combination operational.

Read in this order:

1. [`PLAN.md`](PLAN.md) — Goal, acceptance user flow, task graph and finish line.
2. [`RUNBOOK.md`](RUNBOOK.md) — Luna Max orchestration, browser/ChatGPT binding, recovery, safety and evidence rules.
3. [`STATE.json`](STATE.json) — single durable queue/checkpoint for the run.
4. [`LAUNCH_PROMPT.md`](LAUNCH_PROMPT.md) — thin launch instruction; the exact ChatGPT conversation target is supplied at runtime only.

Current main already contains H01/H02 context retrieval, H03 evidence memory, Evidence Events, provider boundaries, recovery/security tests and EPHEMERA compatibility. This mission does not redesign those components. It first proves what works in a real Codex workflow, then implements only missing capture/persistence/doctor seams needed for daily use.

The ChatGPT conversation URL/ID is runtime configuration, not repository state. Do not write it, browser session identifiers, cookies, credentials, raw transcripts, local absolute paths or machine fingerprints into tracked files.

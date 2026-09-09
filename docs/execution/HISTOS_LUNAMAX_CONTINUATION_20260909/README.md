# HISTOS Luna Max autonomous continuation

Status: **PREFLIGHT_REQUIRED / EXECUTION CONTRACT**  
Created: 2026-09-09 JST  
Execution branch base: `program/ephemera-full-20260908-delivery@ff4a68beaa4094acfbd35b70d49f986f712f9d30`

This directory is the durable handoff for continuing HISTOS-Fabric with a **Luna Max Coordinator** across fresh contexts/workers. Chat history and external Library instructions are not required to execute the project-specific plan.

Read in this order:

1. [`PLAN.md`](PLAN.md) — Goal, user-flow acceptance, task graph, evidence and finish line.
2. [`RUNBOOK.md`](RUNBOOK.md) — Luna Max orchestration, authority, recovery, parallelism, verification and reporting.
3. [`STATE.json`](STATE.json) — initial machine-readable queue/checkpoint. Update this single state file rather than maintaining a second manual task-status table.
4. [`LAUNCH_PROMPT.md`](LAUNCH_PROMPT.md) — short launch instruction for the Coordinator.
5. [`POST_PROGRAM_LANDING_PROMPT.md`](POST_PROGRAM_LANDING_PROMPT.md) — use only after the execution loop reports `PROGRAM_DONE`; preserves the exact local candidate to a remote Draft acceptance surface and stops before protected-branch merge/release.

Implementation contracts already present on this lineage remain authoritative for their bounded components:

- `docs/CONTEXT_CONTRACT_V1.md`
- `docs/H01_COMPONENT_CONTRACT.md`
- `docs/H02_SERVICE_CONTRACT.md`
- `docs/H03_COMPONENT_CONTRACT.md`
- `docs/H04_SLEEP_CONTRACT.md`
- `docs/H06_RELATIONSHIP_CONTRACT.md`
- `docs/A00_OPERATION_CANDIDATE_CONTRACT.md`
- `docs/A01_RETRIEVAL_POLICY_CONTRACT.md`

Fresh research/design reconciliation exists separately on Draft PR #4 (`docs/research-synthesis-20260909@701de5ab01c9686e356a923c2ac6f9bdfd69e8a5`). It is an input to R1/R3/R4/R5, not a reason to replace working native candidates blindly.

Draft PR #3 (`automation/histos-program-test-aggregate-20260909@5135ef4e65f906534d7348797b2a06481394667d`) is a one-file aggregate-test repair candidate. It must be validated in the execution environment before incorporation.

The Coordinator must begin by fresh-reading current remote/local state and must not assume EPHEMERA-System is fully complete merely because HISTOS work can progress independently. EPHEMERA integration is deliberately late and starts with a fresh System check.

# Static validation of the design package

Status: **STATIC CHECKS ONLY / RUNTIME NOT TESTED**  
Checked: 2026-09-06

## Executed

Ran the repository-local [validate_design.py](validate_design.py) against the [schema](contracts.schema.json), [shape fixtures](contract-examples.json), runtime case specifications and Markdown links. The validation environment used Python 3.13.5 and jsonschema 4.26.0. No HISTOS runtime, host harness or external model was launched.

| Check | Observed result |
| --- | --- |
| Draft 2020-12 schema meta-validation | PASS |
| Synthetic shape fixtures | 17/17 matched expectations: 7 accepted, 10 rejected |
| Synthetic source digest | Matches exact UTF-8 fixture bytes |
| Runtime test specification IDs | 34 unique cases; all remain NOT_RUN |
| Runtime cases executed | 0 |
| Markdown fence balance | PASS across 9 Markdown files |
| Relative documentation links | 31 targets resolved |

Local validation used a partial payload plus a path manifest from the live baseline Git tree at `7430a822493a8bca17eb542230b0d6c5aa0fb116`. Existing architecture/roadmap/research link destinations were confirmed from that tree, not fabricated as local files. A normal checkout needs no baseline manifest.

Reproduce from the repository root in an environment with Python and jsonschema available:

```text
python docs/design/v0/validate_design.py
```

The checker is a documentation-validation aid, not product code or a dependency installation command. Public payloads were also reviewed for accidental credentials, private transcripts and machine-specific paths; this is a bounded content review, not a security certification.

## What PASS does not prove

Schema validation cannot establish caller authority, provider consent, source freshness, independence of evidence, correct token counts or cross-field budget arithmetic. It also does not implement snapshot isolation, filesystem escape protection, durable publication, crash recovery, backup correctness, automatic interception, memory consolidation or retrieval quality.

Those requirements remain explicitly specified by [DELIVERY_AND_ACCEPTANCE.md](DELIVERY_AND_ACCEPTANCE.md) and `conformance-cases.json`. The schema is a `v0-draft` wire subset; source/read/admin protocols and durable database migrations still require implementation-linked contracts. No benchmark score, performance percentage, production readiness or independent design approval is claimed.

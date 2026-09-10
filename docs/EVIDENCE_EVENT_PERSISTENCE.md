# Evidence Event persistence and doctor

HISTOS owns this read-only evidence seam. It records normalized
histos.evidence-event/v1 observations and can reopen them after a process
restart. The journal is not a Mission store, verifier, memory promotion path or
authority source.

createPersistentEvidenceEventJournal({ root, scope }) keeps one content
addressed JSON record per event. The host-owned root is canonicalized and must
be a private regular directory; event files are created with exclusive creation
and flushed before acknowledgement. Reopen validates the exact schema, scope,
digest, byte size and normalized wire shape. Exact replays are idempotent and
conflicting event IDs or replay identities are rejected.

doctorEvidenceJournal({ journal, ... }) returns a bounded
histos.evidence-doctor/v1 read model with the separate USED, OBSERVED, PERSISTED,
REMEMBERED, RECALLABLE and GROUNDED stages. The last three stages are explicit
host observations only; the doctor never infers them from frequency and always
reports authority: "none" and current_truth: false. Missing required event IDs
or a used operation with no observed event yields RECORDING_GAP.

The persistence root is caller-owned runtime state and must remain outside the
repository and outside qualification artifacts. Raw prompts, completions,
transcripts, credentials and Mission transitions are refused at normalization.

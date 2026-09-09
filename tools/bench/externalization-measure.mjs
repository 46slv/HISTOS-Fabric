import { externalizeIfOversized, readArtifact, searchArtifact } from '../externalize/artifact-store.mjs';

const REPORT_SCHEMA = 'histos.externalization-measure/v0';

function utf8Bytes(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} required`);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function containsCaseInsensitive(text, query) {
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export async function measureExternalization({
  root,
  payload,
  query,
  thresholdBytes,
  previewBytes = 128,
}) {
  assertNonEmptyString(root, 'root');
  assertNonEmptyString(query, 'query');
  assertNonNegativeInteger(thresholdBytes, 'threshold_bytes');
  assertNonNegativeInteger(previewBytes, 'preview_bytes');

  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const baselineBytes = payloadBuffer.byteLength;
  const externalized = await externalizeIfOversized({
    root,
    payload: payloadBuffer,
    thresholdBytes,
    previewBytes,
    source: { kind: 'benchmark-payload' },
  });

  if (!externalized.externalized) {
    const externalizedActiveBytes = utf8Bytes(externalized);
    return Object.freeze({
      schema: REPORT_SCHEMA,
      externalized: false,
      correctness_preserved: containsCaseInsensitive(externalized.inline_utf8, query),
      baseline_active_bytes: baselineBytes,
      externalized_active_bytes: externalizedActiveBytes,
      reduction_bytes: baselineBytes - externalizedActiveBytes,
      reduction_ratio: baselineBytes === 0 ? null : 1 - externalizedActiveBytes / baselineBytes,
      evidence: Object.freeze({ disposition: externalized.disposition }),
    });
  }

  const search = await searchArtifact({ root, ref: externalized.ref, query, maxMatches: 1 });
  const match = search.matches[0] ?? null;
  const read = match
    ? await readArtifact({
        root,
        ref: externalized.ref,
        startByte: match.reopen.start_byte,
        maxBytes: match.reopen.max_bytes,
      })
    : null;

  const externalizedActiveBytes = utf8Bytes(externalized) + utf8Bytes(search) + (read ? utf8Bytes(read) : 0);
  const correctnessPreserved = Boolean(
    match &&
    read &&
    read.text_utf8 === match.text &&
    containsCaseInsensitive(read.text_utf8, query),
  );

  return Object.freeze({
    schema: REPORT_SCHEMA,
    externalized: true,
    correctness_preserved: correctnessPreserved,
    baseline_active_bytes: baselineBytes,
    externalized_active_bytes: externalizedActiveBytes,
    reduction_bytes: baselineBytes - externalizedActiveBytes,
    reduction_ratio: baselineBytes === 0 ? null : 1 - externalizedActiveBytes / baselineBytes,
    evidence: Object.freeze({
      artifact_sha256: externalized.ref.sha256,
      artifact_bytes: externalized.ref.bytes,
      search_total_matches: search.total_match_count,
      reopened_start_byte: read?.start_byte ?? null,
      reopened_end_byte_exclusive: read?.end_byte_exclusive ?? null,
    }),
  });
}

import { createHash } from 'node:crypto';

import { captureMemory } from '../memory/evidence-memory.mjs';
import { enqueueSleep, inspectSleep, runSleep } from '../sleep/sleep-consolidator.mjs';
import { createProviderDescriptor } from './provider-boundary.mjs';

/**
 * Bounded provider distillation boundary.
 *
 * A distiller may suggest a candidate and quote/evidence receipts, but it is
 * never a memory writer or a verifier.  `acceptDistilledCandidate` delegates
 * to H03 `captureMemory`; the caller supplies the source-owned provenance
 * verifier and an explicit human/host decision.  Kura is accepted only as a
 * deterministic, read-only grounding floor when a caller supplies it.
 */

export const DISTILLATION_SCHEMA = 'histos.distillation/v1';
export const DISTILLATION_CANDIDATE_SCHEMA = 'histos.distillation-candidate/v1';
export const DISTILLATION_RECEIPT_SCHEMA = 'histos.distillation-receipt/v1';
export const DISTILLATION_SCHEDULE_SCHEMA = 'histos.distillation-schedule/v1';

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATIVE_PATH = /^[^\\/][^\\]*$/u;
const KINDS = new Set(['episode', 'semantic', 'failure', 'procedure', 'decision_reference']);
const REF_KINDS = new Set(['source', 'evidence']);
const PROVENANCE_KINDS = new Set(['source', 'runtime_observation', 'independent_test', 'immutable_receipt', 'tool_output', 'retrieved_memory', 'model_restatement', 'hypothesis', 'compiled_material']);

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('DISTILLATION_NON_FINITE_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') fail('DISTILLATION_NON_JSON_VALUE');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function distillationDigest(value) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function boundedString(value, code, max = 20_000, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function assertId(value, code = 'DISTILLATION_ID_INVALID') {
  if (typeof value !== 'string' || !ID.test(value)) fail(code);
  return value;
}

function assertHash(value, code = 'DISTILLATION_SHA256_INVALID') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function normalizeScope(input, code = 'DISTILLATION_SCOPE_REQUIRED') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(code);
  const scope_id = assertId(input.scope_id ?? input.scopeId, code);
  const snapshot_digest = input.snapshot_digest ?? input.source_snapshot_sha256 ?? input.snapshot_sha256;
  if (snapshot_digest !== undefined) assertHash(snapshot_digest, 'DISTILLATION_SNAPSHOT_INVALID');
  const paths = input.paths === undefined ? undefined : input.paths;
  if (paths !== undefined && (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string' || !RELATIVE_PATH.test(path) || path.includes('\\') || path.includes(':') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')))) fail('DISTILLATION_SCOPE_PATHS_INVALID');
  return {
    scope_id,
    ...(snapshot_digest ? { snapshot_digest } : {}),
    ...(paths ? { paths: [...new Set(paths)].sort() } : {}),
  };
}

function assertScope(candidate, expected, code = 'DISTILLATION_SCOPE_MISMATCH') {
  const scope = normalizeScope(candidate, code);
  if (scope.scope_id !== expected.scope_id) fail(code);
  if (expected.snapshot_digest && scope.snapshot_digest && expected.snapshot_digest !== scope.snapshot_digest) fail('DISTILLATION_STALE_SNAPSHOT');
  if (expected.paths && scope.paths && scope.paths.some(path => !expected.paths.includes(path))) fail('DISTILLATION_SCOPE_OUT_OF_BOUNDS');
  return { ...expected, ...scope, ...(expected.paths ? { paths: expected.paths } : {}) };
}

function normalizedKey(rawKey) {
  return rawKey.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase().replaceAll('-', '_');
}

function rejectAuthorityFields(input, depth = 0) {
  if (!input || typeof input !== 'object') return;
  if (depth > 10) fail('DISTILLATION_CANDIDATE_TOO_DEEP');
  if (Array.isArray(input)) {
    input.forEach(item => rejectAuthorityFields(item, depth + 1));
    return;
  }
  for (const [rawKey, value] of Object.entries(input)) {
    const key = normalizedKey(rawKey);
    if (['verified', 'active', 'permission', 'mission_state', 'mission_transition', 'completion', 'proof'].includes(key)) fail('DISTILLATION_AUTHORITY_MUTATION');
    if (key === 'authority' && value !== 'none') fail('DISTILLATION_AUTHORITY_MUTATION');
    if (key === 'current_truth' && value !== false) fail('DISTILLATION_TRUTH_MUTATION');
    rejectAuthorityFields(value, depth + 1);
  }
}

function normalizeReference(ref, scope) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !REF_KINDS.has(ref.kind)) fail('DISTILLATION_REFERENCE_INVALID');
  const path = boundedString(ref.path, 'DISTILLATION_REFERENCE_PATH_INVALID', 1024);
  if (!RELATIVE_PATH.test(path) || path.includes('\\') || path.includes(':') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) fail('DISTILLATION_REFERENCE_PATH_INVALID');
  if (scope.paths && !scope.paths.includes(path)) fail('DISTILLATION_SCOPE_OUT_OF_BOUNDS');
  const sha256 = assertHash(ref.sha256, 'DISTILLATION_REFERENCE_DIGEST_INVALID');
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > 16 * 1024 * 1024) fail('DISTILLATION_REFERENCE_BYTES_INVALID');
  const lineage_id = assertId(ref.lineage_id, 'DISTILLATION_LINEAGE_INVALID');
  const provenance_kind = ref.provenance_kind ?? (ref.kind === 'source' ? 'source' : 'independent_test');
  if (!PROVENANCE_KINDS.has(provenance_kind)) fail('DISTILLATION_PROVENANCE_KIND_INVALID');
  const result = {
    kind: ref.kind,
    path,
    sha256,
    bytes: ref.bytes,
    lineage_id,
    provenance_kind,
    // Caller/provider labels are never host support.  H03's verifier decides.
    supports_claim: false,
  };
  if (ref.start_line !== undefined || ref.end_line !== undefined) {
    if (!Number.isSafeInteger(ref.start_line) || !Number.isSafeInteger(ref.end_line) || ref.start_line < 1 || ref.end_line < ref.start_line) fail('DISTILLATION_REFERENCE_RANGE_INVALID');
    result.start_line = ref.start_line;
    result.end_line = ref.end_line;
  }
  return result;
}

function normalizeReceipt(receipt, scope, references) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('DISTILLATION_RECEIPT_INVALID');
  const kind = boundedString(receipt.kind ?? 'evidence_quote', 'DISTILLATION_RECEIPT_KIND_INVALID', 128);
  const provider_id = assertId(receipt.provider_id ?? receipt.provider?.id ?? 'native-grounding', 'DISTILLATION_RECEIPT_PROVIDER_INVALID');
  const provider_version = boundedString(receipt.provider_version ?? receipt.provider?.version ?? '1', 'DISTILLATION_RECEIPT_VERSION_INVALID', 128);
  const surviving_quotes = receipt.surviving_quotes ?? receipt.quotes ?? [];
  if (!Array.isArray(surviving_quotes) || surviving_quotes.length === 0 || surviving_quotes.some(quote => typeof quote !== 'string' || quote.length === 0 || quote.length > 1000)) fail('DISTILLATION_RECEIPT_QUOTES_REQUIRED');
  const referencePaths = new Set(references.map(reference => reference.path));
  const evidence_refs = receipt.evidence_refs ?? receipt.references ?? [];
  if (!Array.isArray(evidence_refs) || evidence_refs.length === 0) fail('DISTILLATION_RECEIPT_EVIDENCE_REQUIRED');
  const normalizedEvidence = evidence_refs.map(ref => {
    if (!ref || typeof ref !== 'object' || !referencePaths.has(ref.path)) fail('DISTILLATION_RECEIPT_EVIDENCE_MISMATCH');
    const matched = references.find(item => item.path === ref.path);
    return { kind: matched.kind, path: matched.path, sha256: matched.sha256, bytes: matched.bytes };
  });
  if (receipt.scope_id !== undefined && receipt.scope_id !== scope.scope_id) fail('DISTILLATION_RECEIPT_SCOPE_MISMATCH');
  if (receipt.snapshot_digest !== undefined && scope.snapshot_digest && receipt.snapshot_digest !== scope.snapshot_digest) fail('DISTILLATION_STALE_SNAPSHOT');
  return {
    schema: DISTILLATION_RECEIPT_SCHEMA,
    kind,
    provider_id,
    provider_version,
    scope_id: scope.scope_id,
    ...(scope.snapshot_digest ? { snapshot_digest: scope.snapshot_digest } : {}),
    surviving_quotes: [...new Set(surviving_quotes)],
    evidence_refs: normalizedEvidence,
    // A receipt is a grounding observation, not host verification.
    authority: 'none',
    current_truth: false,
  };
}

function numericTokens(value) {
  return [...new Set(String(value ?? '').match(/\b\d+(?:\.\d+)?\b/gu) ?? [])];
}

function sealCandidate(candidate) {
  const { candidate_sha256: _ignored, ...body } = candidate;
  return { ...body, candidate_sha256: distillationDigest(body) };
}

function normalizeCandidate(input, scope, { receiptProvider = null } = {}) {
  rejectAuthorityFields(input);
  const candidateScope = assertScope(input.scope ?? input, scope);
  const candidate_id = assertId(input.candidate_id ?? input.id, 'DISTILLATION_CANDIDATE_ID_INVALID');
  const kind = input.kind ?? 'semantic';
  if (!KINDS.has(kind)) fail('DISTILLATION_KIND_INVALID');
  const title = boundedString(input.title ?? candidate_id, 'DISTILLATION_TITLE_INVALID', 512);
  const summary = boundedString(input.summary ?? input.body ?? '', 'DISTILLATION_SUMMARY_INVALID', 20_000);
  const details = boundedString(input.details ?? input.body ?? summary, 'DISTILLATION_DETAILS_INVALID', 20_000, { allowEmpty: true });
  const confidence = input.confidence === undefined ? 0 : input.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('DISTILLATION_CONFIDENCE_INVALID');
  const references = (input.references ?? input.evidence_refs ?? []).map(ref => normalizeReference(ref, candidateScope));
  if (!references.length) fail('DISTILLATION_REFERENCES_REQUIRED');
  if (new Set(references.map(ref => ref.path)).size !== references.length) fail('DISTILLATION_REFERENCE_DUPLICATE');
  const lineage = input.lineage ?? input.lineage_ids ?? references.map(ref => ref.lineage_id);
  if (!Array.isArray(lineage) || lineage.length === 0 || lineage.some(item => typeof item !== 'string' || !ID.test(item)) || new Set(lineage).size !== lineage.length) fail('DISTILLATION_LINEAGE_INVALID');
  const receiptsInput = input.grounding_receipts ?? input.receipts ?? [];
  if (!Array.isArray(receiptsInput) || !receiptsInput.length) fail('DISTILLATION_RECEIPTS_REQUIRED');
  const receipts = receiptsInput.map(receipt => normalizeReceipt(receipt, candidateScope, references));
  const receiptQuotes = receipts.flatMap(receipt => receipt.surviving_quotes);
  const bodyText = `${title}\n${summary}\n${details}`;
  const unsupportedNumbers = numericTokens(bodyText).filter(number => !receiptQuotes.some(quote => numericTokens(quote).includes(number)));
  if (unsupportedNumbers.length) fail('DISTILLATION_UNSUPPORTED_NUMERIC_CLAIM');
  const candidateBody = {
    schema: DISTILLATION_CANDIDATE_SCHEMA,
    candidate_id,
    scope: candidateScope,
    kind,
    title,
    summary,
    details,
    confidence,
    references,
    lineage: [...new Set(lineage)].sort(),
    grounding_receipts: receipts,
    provider: receiptProvider ? { id: receiptProvider.id, version: receiptProvider.version } : undefined,
    authority: 'none',
    current_truth: false,
  };
  if (!candidateBody.provider) delete candidateBody.provider;
  return sealCandidate(candidateBody);
}

function refusal(code, detail = null) {
  return { code, ...(detail ? { detail: String(detail).slice(0, 256) } : {}), authority: 'none', current_truth: false };
}

function normalizeBudget(value = {}) {
  const integer = (raw, fallback, max, code) => {
    const value = raw === undefined ? fallback : raw;
    if (!Number.isSafeInteger(value) || value < 0 || value > max) fail(code);
    return value;
  };
  return {
    max_candidates: integer(value.max_candidates ?? value.maxCandidates, 4, 64, 'DISTILLATION_MAX_CANDIDATES_INVALID'),
    max_calls: integer(value.max_calls ?? value.maxCalls, 1, 32, 'DISTILLATION_MAX_CALLS_INVALID'),
    max_cost_units: integer(value.max_cost_units ?? value.maxCostUnits, 0, 100_000, 'DISTILLATION_MAX_COST_INVALID'),
    max_bytes: integer(value.max_bytes ?? value.maxBytes, 256 * 1024, 16 * 1024 * 1024, 'DISTILLATION_MAX_BYTES_INVALID'),
    max_milliseconds: integer(value.max_milliseconds ?? value.maxMilliseconds, 1_000, 60_000, 'DISTILLATION_MAX_TIME_INVALID'),
  };
}

function assertSafeInput(value, depth = 0) {
  if (depth > 8) fail('DISTILLATION_INPUT_TOO_DEEP');
  if (Array.isArray(value)) {
    if (value.length > 128) fail('DISTILLATION_INPUT_TOO_LARGE');
    value.forEach(item => assertSafeInput(item, depth + 1));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [rawKey, item] of Object.entries(value)) {
    const key = rawKey.toLowerCase().replaceAll('-', '_');
    if (['secret', 'secrets', 'password', 'token', 'api_key', 'credential', 'authorization', 'cookie', 'private_key'].includes(key)) fail('DISTILLATION_SECRET_INPUT');
    if (['transcript', 'raw_transcript', 'messages', 'conversation', 'chat_history', 'prompt', 'completion', 'raw_input', 'raw_output'].includes(key)) fail('DISTILLATION_TRANSCRIPT_INPUT');
    if (typeof item === 'string' && item.length > 16 * 1024) fail('DISTILLATION_FIELD_OVERSIZED');
    assertSafeInput(item, depth + 1);
  }
}

/**
 * Construct a bounded DistillationProvider.  `generate` is process-local and
 * receives only cloned, scope-bound inputs.  It may return a candidate array
 * or `{ candidates, cost_units }`; no model/network is called by this module.
 */
export function createDistillationProvider({ scope: inputScope, generate, kuraProvider = null, providerId = 'kura-distillation', version = 'distillation-v1', budget = {}, clock = () => Date.now() } = {}) {
  const scope = normalizeScope(inputScope);
  if (typeof generate !== 'function') fail('DISTILLATION_GENERATOR_REQUIRED');
  if (typeof clock !== 'function') fail('DISTILLATION_CLOCK_INVALID');
  const limits = normalizeBudget(budget);
  if (kuraProvider !== null && typeof kuraProvider.evaluateCandidate !== 'function') fail('DISTILLATION_GROUNDING_PROVIDER_INVALID');
  const descriptor = createProviderDescriptor({
    provider_id: providerId,
    provider_kind: 'DistillationProvider',
    version,
    capabilities: ['capture_candidate', 'distill'],
    privacy: { egress: 'none', classification: 'project', secrets_allowed: false },
    grounding: { mode: 'model_assisted', requires_evidence_refs: true, preserves_lineage: true, output_classes: ['distillation_candidate', 'grounding_receipt'] },
    scope_requirements: { required_fields: ['scope_id'], snapshot_required: Boolean(scope.snapshot_digest) },
    status: 'experimental',
  });

  async function distill(input = {}) {
    const requestedScope = assertScope(input.scope ?? scope, scope);
    assertSafeInput(input.inputs ?? input.events ?? []);
    const inputs = input.inputs ?? input.events ?? [];
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 128) fail('DISTILLATION_INPUTS_REQUIRED');
    const started = Number(clock());
    const callBudget = { ...limits, ...(input.budget ? normalizeBudget({ ...limits, ...input.budget }) : {}) };
    if (callBudget.max_calls < 1) return { schema: DISTILLATION_SCHEMA, scope: requestedScope, provider: { id: descriptor.provider_id, version: descriptor.version }, candidates: [], refusals: [refusal('DISTILLATION_RATE_LIMIT')], budget: { limits: callBudget, calls: 0, cost_units: 0 }, authority: 'none', current_truth: false };
    let generated;
    let cost_units = 0;
    try {
      const raw = await generate({ scope: clone(requestedScope), inputs: clone(inputs), budget: clone(callBudget), kura: kuraProvider ? { read_only: true } : null });
      generated = Array.isArray(raw) ? raw : raw?.candidates;
      cost_units = Array.isArray(raw) ? 0 : (raw?.cost_units ?? 0);
      if (!Array.isArray(generated)) fail('DISTILLATION_GENERATOR_RESULT_INVALID');
      if (!Number.isSafeInteger(cost_units) || cost_units < 0) fail('DISTILLATION_COST_INVALID');
    } catch (error) {
      return { schema: DISTILLATION_SCHEMA, scope: requestedScope, provider: { id: descriptor.provider_id, version: descriptor.version }, candidates: [], refusals: [refusal('DISTILLATION_PROVIDER_FAILURE', error.message)], budget: { limits: callBudget, calls: 1, cost_units: 0, elapsed_ms: Math.max(0, Number(clock()) - started) }, authority: 'none', current_truth: false };
    }
    const elapsed_ms = Math.max(0, Number(clock()) - started);
    if (elapsed_ms > callBudget.max_milliseconds) return { schema: DISTILLATION_SCHEMA, scope: requestedScope, provider: { id: descriptor.provider_id, version: descriptor.version }, candidates: [], refusals: [refusal('DISTILLATION_TIME_BUDGET_EXCEEDED')], budget: { limits: callBudget, calls: 1, cost_units, elapsed_ms }, authority: 'none', current_truth: false };
    if (cost_units > callBudget.max_cost_units) return { schema: DISTILLATION_SCHEMA, scope: requestedScope, provider: { id: descriptor.provider_id, version: descriptor.version }, candidates: [], refusals: [refusal('DISTILLATION_COST_EXHAUSTED')], budget: { limits: callBudget, calls: 1, cost_units, elapsed_ms }, authority: 'none', current_truth: false };
    if (generated.length > callBudget.max_candidates) generated = generated.slice(0, callBudget.max_candidates);

    const candidates = [];
    const refusals = [];
    const seenLineages = new Set();
    const seenBodies = new Set();
    for (const rawCandidate of generated) {
      try {
        const candidate = normalizeCandidate(rawCandidate, requestedScope, { receiptProvider: { id: descriptor.provider_id, version: descriptor.version } });
        if (seenBodies.has(candidate.candidate_sha256)) fail('DISTILLATION_DUPLICATE_LINEAGE');
        if (candidate.lineage.some(id => seenLineages.has(id))) fail('DISTILLATION_DUPLICATE_LINEAGE');
        if (kuraProvider) {
          const grounding = await kuraProvider.evaluateCandidate({ scope: requestedScope, candidate: { body: candidate.details, quotes: candidate.grounding_receipts.flatMap(receipt => receipt.surviving_quotes) } });
          if (!grounding.accepted) fail(`DISTILLATION_${grounding.reason}`);
          const receipt = normalizeReceipt({
            kind: 'kura_quote_floor', provider_id: kuraProvider.descriptor?.provider_id ?? 'kura-readonly', provider_version: kuraProvider.descriptor?.version ?? 'pinned',
            surviving_quotes: grounding.surviving_quotes, evidence_refs: candidate.references,
            scope_id: requestedScope.scope_id, snapshot_digest: requestedScope.snapshot_digest,
          }, requestedScope, candidate.references);
          candidate.grounding_receipts.push(receipt);
        }
        if (Buffer.byteLength(canonical(candidate), 'utf8') > callBudget.max_bytes) fail('DISTILLATION_MAX_BYTES_EXCEEDED');
        candidate.grounding_receipts = candidate.grounding_receipts.map(clone);
        candidate.candidate_sha256 = sealCandidate(candidate).candidate_sha256;
        candidates.push(candidate);
        for (const id of candidate.lineage) seenLineages.add(id);
        seenBodies.add(candidate.candidate_sha256);
      } catch (error) {
        refusals.push(refusal(error.message));
      }
    }
    return {
      schema: DISTILLATION_SCHEMA,
      scope: requestedScope,
      provider: { id: descriptor.provider_id, version: descriptor.version, read_only: true },
      candidates,
      refusals,
      budget: { limits: callBudget, calls: 1, cost_units, elapsed_ms, attempted: generated.length, accepted: candidates.length },
      authority: 'none',
      current_truth: false,
    };
  }

  return {
    descriptor,
    scope: clone(scope),
    budget: clone(limits),
    distill,
    capture_candidate: distill,
    invoke(operation, input = {}) {
      if (operation === 'distill' || operation === 'capture' || operation === 'capture_candidate') return distill(input);
      fail('PROVIDER_OPERATION_UNSUPPORTED');
    },
  };
}

/**
 * H03 trust adapter.  The provider candidate is treated as untrusted input;
 * only an explicit host `decision` and H03's `verifyProvenance` callback can
 * create a verified memory record.  Candidate status/confidence are ignored.
 */
export async function acceptDistilledCandidate({ candidate, decision = 'candidate', memoryRoot, scope: memoryScope, sourceRoot, evidenceRoot, verifyProvenance, recordId = null } = {}) {
  if (!candidate || typeof candidate !== 'object') fail('DISTILLATION_CANDIDATE_REQUIRED');
  // H03 uses a richer scope (`source_paths`/`evidence_paths`) than the
  // provider boundary.  Validate identity here, but pass the original H03
  // scope unchanged to `captureMemory` so its path allowlist remains intact.
  if (!memoryScope || typeof memoryScope !== 'object' || Array.isArray(memoryScope)) fail('DISTILLATION_MEMORY_SCOPE_REQUIRED');
  const scopeIdentity = normalizeScope(memoryScope);
  const candidateIdentity = normalizeScope(candidate.scope ?? candidate);
  if (candidateIdentity.scope_id !== scopeIdentity.scope_id) fail('DISTILLATION_SCOPE_MISMATCH');
  if (scopeIdentity.snapshot_digest && candidateIdentity.snapshot_digest && scopeIdentity.snapshot_digest !== candidateIdentity.snapshot_digest) fail('DISTILLATION_STALE_SNAPSHOT');
  const normalized = normalizeCandidate(candidate, candidateIdentity);
  if (!['candidate', 'verified'].includes(decision)) fail('DISTILLATION_DECISION_INVALID');
  if (decision === 'verified' && typeof verifyProvenance !== 'function') fail('DISTILLATION_TRUST_VERIFIER_REQUIRED');
  const record = {
    id: recordId ?? normalized.candidate_id,
    kind: normalized.kind,
    title: normalized.title,
    summary: normalized.summary,
    details: normalized.details,
    // This status is selected by the host decision, never by provider output.
    status: decision,
    confidence: 0,
    created_at: candidate.created_at ?? '2026-01-01T00:00:00.000Z',
    last_verified_at: candidate.last_verified_at ?? '2026-01-01T00:00:00.000Z',
    references: normalized.references.map(reference => ({ ...reference, supports_claim: false })),
    relations: { contradicts: [], supersedes: [] },
    requires_fresh_read: true,
  };
  const captured = await captureMemory({ memoryRoot, scope: memoryScope, sourceRoot, evidenceRoot, verifyProvenance, record });
  return {
    schema: 'histos.distillation-acceptance/v1',
    decision,
    disposition: captured.disposition,
    record: captured.record,
    grounding_receipts: clone(normalized.grounding_receipts),
    authority: 'none',
    current_truth: false,
  };
}

function candidateToSleepInspection(candidate, event) {
  return {
    scope_id: event.scope_id,
    fingerprint: event.fingerprint,
    references: candidate.references.map(reference => ({ kind: reference.kind, path: reference.path, sha256: reference.sha256, bytes: reference.bytes })),
    claim_sha256: null,
    verified: false,
    relations: { contradicts: [], supersedes: [] },
    summary: candidate.summary,
    distillation_candidate: clone(candidate),
    authority: 'none',
    current_truth: false,
  };
}

/** Create an H04 inspector that invokes one bounded provider request per event. */
export function createDistillationSleepInspector({ provider, scope: inputScope, requests = new Map() } = {}) {
  if (!provider || typeof provider.distill !== 'function') fail('DISTILLATION_PROVIDER_REQUIRED');
  const scope = normalizeScope(inputScope);
  const lookup = requests instanceof Map ? requests : new Map(Object.entries(requests));
  return async event => {
    if (!event || event.scope_id !== scope.scope_id) fail('DISTILLATION_SCOPE_MISMATCH');
    const request = lookup.get(event.resource_id);
    if (!request) fail('DISTILLATION_REQUEST_MISSING');
    const report = await provider.distill({ ...clone(request), scope });
    if (!report.candidates.length) fail(report.refusals[0]?.code ?? 'DISTILLATION_NO_CANDIDATE');
    const candidate = report.candidates[0];
    if (candidate.scope.scope_id !== event.scope_id) fail('DISTILLATION_SCOPE_MISMATCH');
    return candidateToSleepInspection(candidate, event);
  };
}

/**
 * H04-owned queue/retry/budget seam.  Requests are supplied again after a
 * restart; only event identity and bounded state live in H04's durable root.
 */
export async function runBoundedDistillation({ root, scopeId, scope: inputScope, provider, events, requests = new Map(), budgets = {} } = {}) {
  const scope = normalizeScope(inputScope ?? { scope_id: scopeId });
  if (scope.scope_id !== scopeId) fail('DISTILLATION_SCOPE_MISMATCH');
  if (!Array.isArray(events) || events.length === 0) fail('DISTILLATION_EVENTS_REQUIRED');
  const normalizedEvents = events.map(event => ({
    id: assertId(event.id ?? event.event_id, 'DISTILLATION_EVENT_ID_INVALID'),
    scope_id: scopeId,
    kind: 'memory',
    resource_id: assertId(event.resource_id ?? event.id ?? event.event_id, 'DISTILLATION_RESOURCE_ID_INVALID'),
    fingerprint: assertHash(event.fingerprint ?? distillationDigest(event), 'DISTILLATION_EVENT_FINGERPRINT_INVALID'),
    declared_bytes: Number.isSafeInteger(event.declared_bytes) && event.declared_bytes >= 0 ? event.declared_bytes : Buffer.byteLength(canonical(event), 'utf8'),
  }));
  const enqueued = await enqueueSleep({ root, scopeId, events: normalizedEvents });
  const receipt = await runSleep({
    root,
    scopeId,
    inspect: createDistillationSleepInspector({ provider, scope, requests }),
    maxResources: budgets.maxResources ?? budgets.max_resources ?? 8,
    maxDeclaredBytes: budgets.maxDeclaredBytes ?? budgets.max_declared_bytes ?? 1024 * 1024,
    maxMilliseconds: budgets.maxMilliseconds ?? budgets.max_milliseconds ?? 1_000,
  });
  const state = await inspectSleep({ root, scopeId });
  return {
    schema: DISTILLATION_SCHEDULE_SCHEMA,
    scope,
    enqueued,
    receipt,
    state,
    authority: 'none',
    current_truth: false,
  };
}

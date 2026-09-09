import { createHash } from 'node:crypto';

/**
 * Provider-neutral admission and invocation boundary.
 *
 * Providers are replaceable implementations.  The boundary owns the small
 * set of rules that a provider is never allowed to change: caller scope,
 * egress policy, provenance/lineage classification and EPHEMERA authority.
 * Native H01/H03 adapters use the same boundary as experimental providers.
 */

export const PROVIDER_SCHEMA = 'histos.provider/v1';
export const PROVIDER_RESULT_SCHEMA = 'histos.provider-result/v1';
export const PROVIDER_KINDS = Object.freeze([
  'RetrievalProvider',
  'MemoryProvider',
  'DistillationProvider',
  'ProjectionProvider',
]);
export const PROVIDER_CAPABILITIES = Object.freeze([
  'read',
  'search',
  'snapshot',
  'compile',
  'capture_candidate',
  'distill',
  'write_direct',
  'admin',
  'semantic_rerank',
  'external_model_use',
  'projection',
]);
export const PROVIDER_STATUSES = Object.freeze([
  'reference',
  'experimental',
  'qualified',
  'default',
  'deprecated',
]);
export const EGRESS_POLICIES = Object.freeze(['none', 'local', 'controlled', 'external']);
export const GROUNDING_MODES = Object.freeze(['deterministic', 'native', 'provider', 'model_assisted']);

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,127}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SCOPE_FIELDS = new Set(['scope_id', 'snapshot_digest', 'paths']);
const FORBIDDEN_RESULT_KEYS = new Set([
  'permission', 'mission_state', 'mission_transition', 'completion', 'safety', 'proof',
]);
const FALSE_ONLY_RESULT_KEYS = new Set(['verified', 'active']);

function fail(code) { throw new Error(code); }
function clone(value) { return structuredClone(value); }

function plainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function boundedString(value, max, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
  return value;
}

function normalizeId(value, code = 'PROVIDER_ID_INVALID') {
  if (typeof value !== 'string' || !ID_RE.test(value)) fail(code);
  return value;
}

function normalizeScope(scope, code = 'PROVIDER_SCOPE_REQUIRED') {
  plainObject(scope, code);
  const scope_id = normalizeId(scope.scope_id ?? scope.scopeId, code);
  const snapshot_digest = scope.snapshot_digest ?? scope.source_snapshot_sha256 ?? scope.snapshot_sha256;
  if (snapshot_digest !== undefined && !SHA256_RE.test(snapshot_digest)) fail('PROVIDER_SCOPE_SNAPSHOT_INVALID');
  let paths;
  if (scope.paths !== undefined) {
    if (!Array.isArray(scope.paths) || !scope.paths.length || scope.paths.some((item) => typeof item !== 'string' || !item.trim() || item.includes('\\') || item.split('/').some((part) => !part || part === '.' || part === '..') || item.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(item))) fail('PROVIDER_SCOPE_PATHS_INVALID');
    paths = [...new Set(scope.paths)].sort();
  }
  return { scope_id, ...(snapshot_digest ? { snapshot_digest } : {}), ...(paths ? { paths } : {}) };
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !PROVIDER_CAPABILITIES.includes(item))) fail('PROVIDER_CAPABILITIES_INVALID');
  if (new Set(value).size !== value.length) fail('PROVIDER_CAPABILITIES_DUPLICATE');
  return [...value].sort();
}

function normalizePrivacy(value) {
  plainObject(value, 'PROVIDER_PRIVACY_REQUIRED');
  const rawEgress = value.egress ?? value.egress_policy ?? value.egressPolicy;
  const egress = ({ no_egress: 'none', local_only: 'none', provider_allowed: 'controlled' })[rawEgress] ?? rawEgress;
  if (!EGRESS_POLICIES.includes(egress)) fail('PROVIDER_EGRESS_INVALID');
  const classification = String(value.classification ?? value.privacy_class ?? value.data_classification ?? 'project').toLowerCase();
  if (!['public', 'internal', 'project', 'private', 'restricted'].includes(classification)) fail('PROVIDER_PRIVACY_CLASS_INVALID');
  if (value.secrets_allowed === true || value.accepts_secrets === true) fail('PROVIDER_SECRETS_NOT_ALLOWED');
  return { egress, classification, secrets_allowed: false };
}

function normalizeGrounding(value) {
  plainObject(value, 'PROVIDER_GROUNDING_REQUIRED');
  const mode = value.mode ?? value.strategy;
  if (!GROUNDING_MODES.includes(mode)) fail('PROVIDER_GROUNDING_MODE_INVALID');
  const preserves_lineage = value.preserves_lineage ?? value.lineage_preserved;
  if (preserves_lineage !== true) fail('PROVIDER_GROUNDING_LINEAGE_REQUIRED');
  const requires_refs = value.requires_evidence_refs ?? value.requires_refs ?? false;
  if (typeof requires_refs !== 'boolean') fail('PROVIDER_GROUNDING_REFS_INVALID');
  const output_classes = value.output_classes ?? value.classes ?? [];
  if (!Array.isArray(output_classes) || output_classes.length > 32 || output_classes.some((item) => typeof item !== 'string' || !item.trim())) fail('PROVIDER_GROUNDING_CLASSES_INVALID');
  if (value.authority !== undefined && value.authority !== 'none') fail('PROVIDER_GROUNDING_AUTHORITY_INVALID');
  if (value.current_truth !== undefined && value.current_truth !== false) fail('PROVIDER_GROUNDING_TRUTH_INVALID');
  return {
    mode,
    requires_evidence_refs: requires_refs,
    preserves_lineage: true,
    output_classes: [...new Set(output_classes)].sort(),
    authority: 'none',
    current_truth: false,
  };
}

function normalizeScopeRequirements(value) {
  plainObject(value, 'PROVIDER_SCOPE_REQUIREMENTS_REQUIRED');
  const required_fields = value.required_fields ?? value.required ?? ['scope_id'];
  if (!Array.isArray(required_fields) || required_fields.length === 0 || required_fields.some((item) => typeof item !== 'string' || !SCOPE_FIELDS.has(item))) fail('PROVIDER_SCOPE_REQUIREMENTS_INVALID');
  if (!required_fields.includes('scope_id')) fail('PROVIDER_SCOPE_REQUIRED');
  const unique = [...new Set(required_fields)];
  return {
    required_fields: unique,
    allow_path_subset: value.allow_path_subset !== false,
    snapshot_required: unique.includes('snapshot_digest'),
  };
}

function rejectDescriptorControls(input) {
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase().replaceAll('-', '_');
    if (normalized === 'authority' && value !== 'none') fail('PROVIDER_AUTHORITY_MUTATION');
    if (normalized === 'current_truth' && value !== false) fail('PROVIDER_TRUTH_MUTATION');
    if (['verified', 'permission', 'mission_state', 'mission_transition'].includes(normalized)) fail('PROVIDER_AUTHORITY_MUTATION');
  }
}

/** Normalize and validate the provider metadata visible to the host. */
export function createProviderDescriptor(input) {
  plainObject(input, 'PROVIDER_METADATA_INVALID');
  rejectDescriptorControls(input);
  const schema = input.schema ?? PROVIDER_SCHEMA;
  if (schema !== PROVIDER_SCHEMA) fail('PROVIDER_SCHEMA_INVALID');
  const provider_id = normalizeId(input.provider_id ?? input.id, 'PROVIDER_ID_INVALID');
  const provider_kind = input.provider_kind ?? input.kind ?? input.class;
  if (!PROVIDER_KINDS.includes(provider_kind)) fail('PROVIDER_KIND_INVALID');
  const version = boundedString(input.version ?? input.provider_version, 128, 'PROVIDER_VERSION_INVALID');
  if (!VERSION_RE.test(version)) fail('PROVIDER_VERSION_INVALID');
  const descriptor = {
    schema,
    provider_id,
    provider_kind,
    version,
    capabilities: normalizeCapabilities(input.capabilities),
    privacy: normalizePrivacy(input.privacy ?? input.privacy_policy),
    grounding: normalizeGrounding(input.grounding ?? input.provenance),
    scope_requirements: normalizeScopeRequirements(input.scope_requirements ?? input.scope),
    status: input.status ?? 'experimental',
    authority_boundary: 'host_only',
  };
  if (!PROVIDER_STATUSES.includes(descriptor.status)) fail('PROVIDER_STATUS_INVALID');
  if (descriptor.capabilities.includes('write_direct') || descriptor.capabilities.includes('admin')) {
    // Providers can advertise privileged capabilities for inspection, but this
    // local boundary never admits/invokes them as default provider operations.
    descriptor.privileged_capability = true;
  }
  return Object.freeze(descriptor);
}

export const normalizeProviderMetadata = createProviderDescriptor;

function egressRank(value) { return { none: 0, local: 1, controlled: 2, external: 3 }[value]; }

function normalizePolicy(policy = {}) {
  plainObject(policy, 'PROVIDER_POLICY_INVALID');
  const rawEgress = policy.allowed_egress ?? policy.egress ?? 'local';
  const allowed_egress = ({ no_egress: 'none', local_only: 'none', provider_allowed: 'controlled' })[rawEgress] ?? rawEgress;
  if (!EGRESS_POLICIES.includes(allowed_egress)) fail('PROVIDER_POLICY_EGRESS_INVALID');
  const allowed_statuses = policy.allowed_statuses ?? ['reference', 'experimental', 'qualified', 'default'];
  if (!Array.isArray(allowed_statuses) || allowed_statuses.some((item) => !PROVIDER_STATUSES.includes(item)) || !allowed_statuses.length) fail('PROVIDER_POLICY_STATUS_INVALID');
  const allowed_capabilities = policy.allowed_capabilities ?? PROVIDER_CAPABILITIES.filter((item) => !['write_direct', 'admin', 'external_model_use'].includes(item));
  if (!Array.isArray(allowed_capabilities) || allowed_capabilities.some((item) => !PROVIDER_CAPABILITIES.includes(item))) fail('PROVIDER_POLICY_CAPABILITIES_INVALID');
  return { allowed_egress, allowed_statuses: [...new Set(allowed_statuses)], allowed_capabilities: [...new Set(allowed_capabilities)] };
}

/** Host admission.  This never calls a provider and is safe to use for probes. */
export function admitProvider(metadata, { policy = {}, scope = null } = {}) {
  const descriptor = createProviderDescriptor(metadata);
  const admissionPolicy = normalizePolicy(policy);
  if (descriptor.status === 'deprecated' || !admissionPolicy.allowed_statuses.includes(descriptor.status)) fail('PROVIDER_NOT_ADMISSIBLE');
  if (egressRank(descriptor.privacy.egress) > egressRank(admissionPolicy.allowed_egress)) fail('PROVIDER_EGRESS_NOT_ALLOWED');
  if (descriptor.capabilities.some((capability) => !admissionPolicy.allowed_capabilities.includes(capability))) fail('PROVIDER_CAPABILITY_NOT_ALLOWED');
  if (scope !== null) normalizeScope(scope);
  return Object.freeze({
    ...descriptor,
    admission: Object.freeze({ status: 'admitted', policy_egress: admissionPolicy.allowed_egress, checked_scope: scope ? normalizeScope(scope).scope_id : null }),
  });
}

function operationCapability(operation) {
  const aliases = {
    retrieve: 'read',
    recall: 'read',
    read_memory: 'read',
    context_read: 'read',
    context_search: 'search',
    context_compile: 'compile',
    capture: 'capture_candidate',
    project: 'projection',
  };
  return aliases[operation] ?? operation;
}

function inspectResult(value, expectedScope, path = '$') {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) inspectResult(value[index], expectedScope, `${path}[${index}]`);
    return;
  }
  for (const [rawKey, nested] of Object.entries(value)) {
    const key = rawKey.toLowerCase().replaceAll('-', '_');
    if (key === 'authority' && nested !== 'none') fail('PROVIDER_AUTHORITY_MUTATION');
    if (key === 'current_truth' && nested !== false) fail('PROVIDER_TRUTH_MUTATION');
    if (FORBIDDEN_RESULT_KEYS.has(key)) fail('PROVIDER_AUTHORITY_MUTATION');
    if (FALSE_ONLY_RESULT_KEYS.has(key) && nested !== false) fail('PROVIDER_AUTHORITY_MUTATION');
    if (key === 'scope_id' && nested !== expectedScope.scope_id) fail('PROVIDER_SCOPE_MISMATCH');
    if (key === 'snapshot_digest' && expectedScope.snapshot_digest && nested !== expectedScope.snapshot_digest) fail('PROVIDER_SNAPSHOT_MISMATCH');
    if (key === 'source_snapshot_sha256' && expectedScope.snapshot_digest && nested !== expectedScope.snapshot_digest) fail('PROVIDER_SNAPSHOT_MISMATCH');
    if (key === 'path' && typeof nested === 'string') {
      if (!nested || nested.includes('\\') || nested.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(nested) || nested.split('/').some((part) => !part || part === '.' || part === '..')) fail('PROVIDER_UNSAFE_RESULT');
      if (expectedScope.paths && !expectedScope.paths.includes(nested)) fail('PROVIDER_SCOPE_OUT_OF_BOUNDS');
    }
    if ((key === 'paths' || key === 'source_paths' || key === 'evidence_paths') && Array.isArray(nested) && expectedScope.paths && nested.some((item) => typeof item !== 'string' || !expectedScope.paths.includes(item))) fail('PROVIDER_SCOPE_OUT_OF_BOUNDS');
    inspectResult(nested, expectedScope, `${path}.${rawKey}`);
  }
}

function validateInvocationScope(input, fallbackScope, descriptor) {
  const explicit = input?.scope ?? input?.context?.scope ?? (input?.scope_id !== undefined ? input : null);
  const candidate = explicit ? {
    ...fallbackScope,
    ...explicit,
    ...(explicit.snapshot_digest === undefined && fallbackScope.snapshot_digest ? { snapshot_digest: fallbackScope.snapshot_digest } : {}),
    ...(explicit.paths === undefined && fallbackScope.paths ? { paths: fallbackScope.paths } : {}),
  } : fallbackScope;
  const scope = normalizeScope(candidate);
  if (scope.scope_id !== fallbackScope.scope_id) fail('PROVIDER_SCOPE_MISMATCH');
  if (fallbackScope.snapshot_digest && scope.snapshot_digest && scope.snapshot_digest !== fallbackScope.snapshot_digest) fail('PROVIDER_SNAPSHOT_MISMATCH');
  if (fallbackScope.paths && scope.paths && scope.paths.some((item) => !fallbackScope.paths.includes(item))) fail('PROVIDER_SCOPE_OUT_OF_BOUNDS');
  for (const field of descriptor.scope_requirements.required_fields) {
    if (field === 'snapshot_digest' && !scope.snapshot_digest) fail('PROVIDER_SCOPE_SNAPSHOT_REQUIRED');
    if (field === 'paths' && !scope.paths) fail('PROVIDER_SCOPE_PATHS_REQUIRED');
  }
  return scope;
}

function wrapResult({ descriptor, operation, scope, result }) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('PROVIDER_RESULT_INVALID');
  inspectResult(result, scope);
  return Object.freeze({
    schema: PROVIDER_RESULT_SCHEMA,
    provider: { id: descriptor.provider_id, version: descriptor.version, kind: descriptor.provider_kind },
    operation,
    scope: clone(scope),
    classification: descriptor.provider_kind === 'RetrievalProvider' ? 'retrieved_candidate' : descriptor.provider_kind === 'MemoryProvider' ? 'recalled_memory' : descriptor.provider_kind === 'DistillationProvider' ? 'provider_judgement' : 'procedural_revision',
    authority: 'none',
    current_truth: false,
    provenance: { provider_id: descriptor.provider_id, provider_version: descriptor.version, grounding: clone(descriptor.grounding) },
    // Keep the native payload byte/field-for-byte unchanged under `result`.
    result: clone(result),
  });
}

/**
 * Registry that admits providers and invokes only declared capabilities.  It
 * deliberately has no write/admin/Mission operation, even if a provider
 * advertises those capabilities.
 */
export class ProviderRegistry {
  constructor({ scope, policy = {} } = {}) {
    this.scope = normalizeScope(scope);
    this.policy = normalizePolicy(policy);
    this.providers = new Map();
  }

  register(provider) {
    plainObject(provider, 'PROVIDER_IMPLEMENTATION_INVALID');
    const descriptor = admitProvider(provider.descriptor ?? provider.metadata ?? provider, { policy: this.policy, scope: this.scope });
    const implementation = provider.implementation ?? provider;
    if (typeof implementation.invoke !== 'function' && !descriptor.capabilities.some((capability) => typeof implementation[capability] === 'function')) fail('PROVIDER_IMPLEMENTATION_MISSING');
    if (this.providers.has(descriptor.provider_id)) fail('PROVIDER_ID_CONFLICT');
    this.providers.set(descriptor.provider_id, { descriptor, implementation });
    return descriptor;
  }

  get(providerId) {
    normalizeId(providerId, 'PROVIDER_ID_INVALID');
    return this.providers.get(providerId)?.descriptor ?? null;
  }

  list() { return [...this.providers.values()].map(({ descriptor }) => descriptor); }

  async invoke(providerId, operation, input = {}) {
    normalizeId(providerId, 'PROVIDER_ID_INVALID');
    if (typeof operation !== 'string' || !ID_RE.test(operation)) fail('PROVIDER_OPERATION_INVALID');
    const entry = this.providers.get(providerId);
    if (!entry) fail('PROVIDER_NOT_FOUND');
    const { descriptor, implementation } = entry;
    const capability = operationCapability(operation);
    if (!descriptor.capabilities.includes(capability)) fail('PROVIDER_OPERATION_UNSUPPORTED');
    if (['write_direct', 'admin', 'external_model_use'].includes(capability)) fail('PROVIDER_OPERATION_FORBIDDEN');
    plainObject(input, 'PROVIDER_INPUT_INVALID');
    const scope = validateInvocationScope(input, this.scope, descriptor);
    const invocation = { ...clone(input), scope: clone(scope) };
    let result;
    if (typeof implementation.invoke === 'function') result = await implementation.invoke(operation, invocation, { descriptor, scope: clone(scope) });
    else if (typeof implementation[operation] === 'function') result = await implementation[operation](invocation, { descriptor, scope: clone(scope) });
    else if (typeof implementation[capability] === 'function') result = await implementation[capability](invocation, { descriptor, scope: clone(scope) });
    else fail('PROVIDER_OPERATION_UNSUPPORTED');
    return wrapResult({ descriptor, operation, scope, result });
  }
}

export function createProviderRegistry(options) { return new ProviderRegistry(options); }
export const invokeProvider = async (registry, providerId, operation, input) => registry.invoke(providerId, operation, input);

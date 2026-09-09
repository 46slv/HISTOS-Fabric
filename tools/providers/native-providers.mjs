import { compileContextCapsule } from '../context/context-compiler.mjs';
import { searchSourceIndex } from '../index/source-index.mjs';
import { readMemoryRecord, recallMemory } from '../memory/evidence-memory.mjs';
import { createProviderDescriptor } from './provider-boundary.mjs';

/**
 * H01 candidate-zero adapter.  The underlying search/compile functions are
 * called directly and their payloads are returned unchanged; the provider
 * registry adds only an outer provenance/authority envelope.
 */
export function createNativeRetrievalProvider({ index, sourceRoot = null, providerId = 'native-h01', version = 'h01-native-v1' } = {}) {
  if (!index || typeof index !== 'object') throw new Error('NATIVE_RETRIEVAL_INDEX_REQUIRED');
  const descriptor = createProviderDescriptor({
    provider_id: providerId,
    provider_kind: 'RetrievalProvider',
    version,
    capabilities: ['read', 'search', 'snapshot', 'compile'],
    privacy: { egress: 'none', classification: 'project', secrets_allowed: false },
    grounding: { mode: 'deterministic', requires_evidence_refs: false, preserves_lineage: true, output_classes: ['current_source_observation', 'compiled_understanding'] },
    scope_requirements: { required_fields: ['scope_id', 'snapshot_digest', 'paths'] },
    status: 'qualified',
  });
  const provider = {
    descriptor,
    search(input = {}) {
      const requested = input.index ?? index;
      return searchSourceIndex({ index: requested, query: input.query, scope: input.scope, maxCandidates: input.maxCandidates ?? input.max_candidates ?? 30 });
    },
    compile(input = {}) {
      return compileContextCapsule({
        ...input,
        sourceRoot: input.sourceRoot ?? sourceRoot,
        index: input.index ?? index,
        maxTokens: input.maxTokens ?? input.max_tokens,
      });
    },
    snapshot(input = {}) {
      const scope = input.scope ?? index.scope;
      return { schema: 'histos.provider-snapshot/v1', scope, sources: index.sources.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) };
    },
    invoke(operation, input) {
      if (operation === 'context_search' || operation === 'search' || operation === 'retrieve') return this.search(input);
      if (operation === 'context_compile' || operation === 'compile') return this.compile(input);
      if (operation === 'snapshot') return this.snapshot(input);
      if (operation === 'context_read' || operation === 'read') {
        // H01 read is intentionally left to the service's exact-read API.  A
        // provider caller must inject a read function rather than get an
        // implicit path escape through this adapter.
        throw new Error('PROVIDER_OPERATION_UNSUPPORTED');
      }
      throw new Error('PROVIDER_OPERATION_UNSUPPORTED');
    },
  };
  return provider;
}

/**
 * H03 candidate-zero adapter.  No capture/write operation is exposed here;
 * host-owned captureMemory remains the trust boundary.  Reads retain the
 * original H03 record fields (including authority:none/current_truth:false).
 */
export function createNativeMemoryProvider({ memoryRoot, sourceRoot, evidenceRoot, verifyProvenance, scope: memoryScope = null, providerId = 'native-h03', version = 'h03-native-v1' } = {}) {
  if (typeof memoryRoot !== 'string' || !memoryRoot) throw new Error('NATIVE_MEMORY_ROOT_REQUIRED');
  const descriptor = createProviderDescriptor({
    provider_id: providerId,
    provider_kind: 'MemoryProvider',
    version,
    capabilities: ['read', 'search', 'snapshot'],
    privacy: { egress: 'none', classification: 'project', secrets_allowed: false },
    grounding: { mode: 'native', requires_evidence_refs: true, preserves_lineage: true, output_classes: ['recalled_memory', 'retained_evidence'] },
    scope_requirements: { required_fields: ['scope_id'] },
    status: 'qualified',
  });
  const bound = { memoryRoot, sourceRoot, evidenceRoot, verifyProvenance };
  const h03Scope = input => {
    const supplied = input.memoryScope ?? input.h03Scope ?? memoryScope;
    if (!supplied) return input.scope;
    return { ...supplied, scope_id: input.scope?.scope_id ?? supplied.scope_id };
  };
  const provider = {
    descriptor,
    read(input = {}) {
      return readMemoryRecord({ ...bound, ...input, scope: h03Scope(input), id: input.id });
    },
    recall(input = {}) {
      return recallMemory({ ...bound, ...input, scope: h03Scope(input) });
    },
    invoke(operation, input) {
      if (operation === 'read' || operation === 'read_memory') return this.read(input);
      if (operation === 'recall' || operation === 'retrieve' || operation === 'search') return this.recall(input);
      throw new Error('PROVIDER_OPERATION_UNSUPPORTED');
    },
  };
  return provider;
}

export { searchSourceIndex, compileContextCapsule, readMemoryRecord, recallMemory };

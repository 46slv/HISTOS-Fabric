import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { countTokens } from '../bench/context-capsule.mjs';
import { buildSourceIndex, searchSourceIndex } from '../index/source-index.mjs';
import { compileContextCapsule } from './context-compiler.mjs';

async function fixture(content = 'export function alpha(value) {\n  return value + 1;\n}\n') {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'histos-compiler-source-'));
  const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'histos-compiler-index-'));
  const sourcePath = 'a.mjs';
  await writeFile(path.join(sourceRoot, sourcePath), content);
  const { index } = await buildSourceIndex({ root: sourceRoot, indexRoot, scopeId: 'repo', paths: [sourcePath] });
  const scope = index.scope;
  const sourceMap = index.sources.map(({ path: indexedPath, sha256 }) => ({ path: indexedPath, sha256 }));
  const search = searchSourceIndex({ index, query: 'alpha value', scope });
  return {
    sourceRoot, indexRoot, sourcePath, index, scope, sourceMap, candidate: search.candidates[0],
    cleanup: () => Promise.all([rm(sourceRoot, { recursive: true, force: true }), rm(indexRoot, { recursive: true, force: true })]),
  };
}

test('compiler reopens source authority and deterministically counts the complete rendered surface', async () => {
  const f = await fixture();
  try {
    const input = { sourceRoot: f.sourceRoot, index: f.index, goal: 'find alpha', scope: f.scope, sourceMap: f.sourceMap, candidates: [f.candidate], maxTokens: 2000, currentTruthRefs: [{ id: 'truth', sha256: f.candidate.source_sha256 }], evidenceRefs: [{ id: 'e1', sha256: f.candidate.source_sha256 }], memory: [{ id: 'm1', status: 'verified' }] };
    const first = await compileContextCapsule(input); const second = await compileContextCapsule(input);
    assert.deepEqual(first, second); assert.equal(first.budget.rendered_tokens, countTokens(first.rendered_context));
    assert.ok(first.rendered_context.includes('why=')); assert.ok(first.rendered_context.includes('Truth ref:'));
    assert.equal(first.source_fragments[0].text, f.candidate.text);
    assert.equal(first.source_fragments[0].reopen.snapshot_digest, f.scope.snapshot_digest);
  } finally { await f.cleanup(); }
});
test('budget omits whole source-verified candidates and never exceeds the cl100k token cap', async () => {
  const lines = Array.from({ length: 20 }, (_, index) => `alpha_${index} ${'日本語 '.repeat(100)}`);
  const f = await fixture(`${lines.join('\n')}\n`);
  try {
    const source = f.index.sources[0];
    const candidates = lines.map((text, index) => ({ path: f.sourcePath, source_sha256: source.sha256, start_line: index + 1, end_line: index + 1, text, why_included: ['lexical:1'], reopen: { operation: 'context.read_source', scope_id: f.scope.scope_id, snapshot_digest: f.scope.snapshot_digest, path: f.sourcePath, start_line: index + 1, end_line: index + 1 } }));
    const result = await compileContextCapsule({ sourceRoot: f.sourceRoot, index: f.index, goal: 'alpha', scope: f.scope, sourceMap: f.sourceMap, candidates, maxTokens: 500 });
    assert.ok(result.budget.rendered_tokens <= 500); assert.ok(result.selection_receipt.omitted.length > 0);
    await assert.rejects(() => compileContextCapsule({ sourceRoot: f.sourceRoot, index: f.index, goal: 'alpha', scope: f.scope, sourceMap: f.sourceMap, candidates: [], maxTokens: 1 }), /BUDGET_BELOW_REQUIRED_PREAMBLE/);
  } finally { await f.cleanup(); }
});

test('altered text, impossible ranges, missing reasons and inconsistent reopen claims are refused', async () => {
  const f = await fixture();
  try {
    const base = { sourceRoot: f.sourceRoot, index: f.index, goal: 'alpha', scope: f.scope, sourceMap: f.sourceMap, maxTokens: 2000 };
    await assert.rejects(() => compileContextCapsule({ ...base, candidates: [{ ...f.candidate, text: 'export const forged = true;' }] }), /CANDIDATE_TEXT_MISMATCH/);
    const impossible = { ...f.candidate, end_line: 999999, reopen: { ...f.candidate.reopen, end_line: 999999 } };
    await assert.rejects(() => compileContextCapsule({ ...base, candidates: [impossible] }), /INVALID_SOURCE_RANGE/);
    await assert.rejects(() => compileContextCapsule({ ...base, candidates: [{ ...f.candidate, why_included: [] }] }), /MISSING_INCLUSION_REASON/);
    await assert.rejects(() => compileContextCapsule({ ...base, candidates: [{ ...f.candidate, reopen: { ...f.candidate.reopen, operation: 'caller.claim' } }] }), /STALE_OR_OUT_OF_SCOPE_CANDIDATE/);
  } finally { await f.cleanup(); }
});

test('deleted source and changed bytes are refused at compilation time', async () => {
  const deleted = await fixture();
  try {
    await rm(path.join(deleted.sourceRoot, deleted.sourcePath));
    await assert.rejects(() => compileContextCapsule({ sourceRoot: deleted.sourceRoot, index: deleted.index, goal: 'alpha', scope: deleted.scope, sourceMap: deleted.sourceMap, candidates: [deleted.candidate], maxTokens: 2000 }), /SOURCE_MISSING/);
  } finally { await deleted.cleanup(); }

  const stale = await fixture();
  try {
    await writeFile(path.join(stale.sourceRoot, stale.sourcePath), 'export const alpha = "changed";\n');
    await assert.rejects(() => compileContextCapsule({ sourceRoot: stale.sourceRoot, index: stale.index, goal: 'alpha', scope: stale.scope, sourceMap: stale.sourceMap, candidates: [stale.candidate], maxTokens: 2000 }), /SOURCE_STALE/);
  } finally { await stale.cleanup(); }
});

test('stale index, source-map digest, and out-of-scope inputs are refused', async () => {
  const f = await fixture();
  try {
    const base = { sourceRoot: f.sourceRoot, index: f.index, goal: 'alpha', scope: f.scope, sourceMap: f.sourceMap, candidates: [f.candidate], maxTokens: 2000 };
    await assert.rejects(() => compileContextCapsule({ ...base, scope: { ...f.scope, snapshot_digest: '0'.repeat(64) } }), /STALE_OR_OUT_OF_SCOPE_INDEX/);
    await assert.rejects(() => compileContextCapsule({ ...base, sourceMap: [{ ...f.sourceMap[0], sha256: 'b'.repeat(64) }] }), /SOURCE_MAP_OUT_OF_SCOPE/);
    await assert.rejects(() => compileContextCapsule({ ...base, scope: { ...f.scope, paths: [] }, sourceMap: [] }), /STALE_OR_OUT_OF_SCOPE_CANDIDATE/);
  } finally { await f.cleanup(); }
});

test('no-answer compilation validates index integrity, complete scope and live source identity', async () => {
  const f = await fixture();
  try {
    const input = { sourceRoot:f.sourceRoot,index:f.index,goal:'no match',scope:f.scope,sourceMap:[],candidates:[],maxTokens:2000 };
    const good = await compileContextCapsule(input);
    assert.equal(good.source_fragments.length,0);
    for(const index of [{...f.index,schema:'invalid'},structuredClone(f.index)]) {
      if(index.schema!=='invalid')index.sources[0].lines[0]='forged';
      await assert.rejects(()=>compileContextCapsule({...input,index}),/INDEX_CORRUPT/);
    }
    await assert.rejects(()=>compileContextCapsule({...input,scope:{...f.scope,paths:['outside.mjs']}}),/SCOPE_OUT_OF_BOUNDS/);
    await writeFile(path.join(f.sourceRoot,f.sourcePath),'changed');
    await assert.rejects(()=>compileContextCapsule(input),/SOURCE_STALE/);
    await rm(path.join(f.sourceRoot,f.sourcePath));
    await assert.rejects(()=>compileContextCapsule(input),/SOURCE_MISSING/);
  } finally { await f.cleanup(); }
});

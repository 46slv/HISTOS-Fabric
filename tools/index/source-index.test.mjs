import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSourceIndex, loadSourceIndex, readIndexedRange, searchSourceIndex } from './source-index.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-source-'));
  const indexRoot = await mkdtemp(path.join(os.tmpdir(), 'histos-index-'));
  await writeFile(path.join(root, 'alpha.mjs'), "export function alpha(value) {\n  return value + 1;\n}\n\nexport function beta() {\n  return 'beta';\n}\n");
  await writeFile(path.join(root, 'notes.md'), '# Recovery\n\nUse alpha after failure.\n');
  return { root, indexRoot, cleanup: () => Promise.all([rm(root, { recursive: true, force: true }), rm(indexRoot, { recursive: true, force: true })]) };
}

test('incremental add/modify/delete reuses only unchanged derived records', async () => {
  const f = await fixture();
  try {
    const first = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs', 'notes.md'] });
    assert.deepEqual(first.changes.added, ['alpha.mjs', 'notes.md']);
    const warm = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs', 'notes.md'] });
    assert.equal(warm.changes.reused_files, 2); assert.equal(warm.changes.parsed_files, 0);
    await writeFile(path.join(f.root, 'alpha.mjs'), "export function alpha(value) {\n  return value + 2;\n}\n");
    await writeFile(path.join(f.root, 'new.mjs'), 'export const fresh = true;\n');
    const changed = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs', 'new.mjs'] });
    assert.deepEqual(changed.changes.modified, ['alpha.mjs']); assert.deepEqual(changed.changes.added, ['new.mjs']); assert.deepEqual(changed.changes.deleted, ['notes.md']);
    assert.equal(changed.changes.parsed_files, 2); assert.equal(changed.changes.reused_files, 0);
  } finally { await f.cleanup(); }
});

test('search uses structure, returns exact reopen, and read fails on source drift', async () => {
  const f = await fixture();
  try {
    const { index } = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs', 'notes.md'], currentDiffPaths: ['alpha.mjs'] });
    const scope = index.scope;
    const result = searchSourceIndex({ index, scope, query: 'How does alpha return value after change?' });
    assert.equal(result.candidates[0].start_line, 1); assert.equal(result.candidates[0].end_line, 3);
    assert.ok(result.candidates[0].why_included.includes('current_diff'));
    const reopened = await readIndexedRange({ root: f.root, index, scope, sourcePath: 'alpha.mjs', startLine: 1, endLine: 3 });
    assert.equal(reopened.text, result.candidates[0].text);
    await writeFile(path.join(f.root, 'alpha.mjs'), 'changed without reindex\n');
    await assert.rejects(() => readIndexedRange({ root: f.root, index, scope, sourcePath: 'alpha.mjs', startLine: 1, endLine: 1 }), /SOURCE_STALE/);
  } finally { await f.cleanup(); }
});

test('scope, snapshot, missing source, diff, and named out-of-scope source fail closed', async () => {
  const f = await fixture();
  try {
    const { index } = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs'] });
    assert.throws(() => searchSourceIndex({ index, query: 'alpha', scope: { ...index.scope, scope_id: 'repo-b' } }), /SCOPE_MISMATCH/);
    assert.throws(() => searchSourceIndex({ index, query: 'alpha', scope: { ...index.scope, snapshot_digest: '0'.repeat(64) } }), /SNAPSHOT_MISMATCH/);
    const absent = searchSourceIndex({ index, query: 'What is in missing.mjs?', scope: index.scope });
    assert.equal(absent.receipt.reason, 'EXPLICIT_SOURCE_NOT_IN_SCOPE'); assert.deepEqual(absent.candidates, []);
    await assert.rejects(() => buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['missing.mjs'] }), /SOURCE_MISSING/);
    await assert.rejects(() => buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs'], currentDiffPaths: ['notes.md'] }), /DIFF_OUT_OF_SCOPE/);
  } finally { await f.cleanup(); }
});

test('persisted derived index corruption is rejected rather than reused', async () => {
  const f = await fixture();
  try {
    await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs'] });
    const file = path.join(f.indexRoot, 'source-index-v1.json');
    const value = JSON.parse(await readFile(file, 'utf8')); value.sources[0].lines[0] = 'poisoned';
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(() => loadSourceIndex({ indexRoot: f.indexRoot }), /INDEX_CORRUPT/);
    await assert.rejects(() => buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs'] }), /INDEX_CORRUPT/);
    const rebuilt = await buildSourceIndex({ root: f.root, indexRoot: f.indexRoot, scopeId: 'repo-a', paths: ['alpha.mjs'], forceRebuild: true });
    assert.equal(rebuilt.changes.parsed_files, 1);
    await loadSourceIndex({ indexRoot: f.indexRoot, expectedSnapshotDigest: rebuilt.index.scope.snapshot_digest });
  } finally { await f.cleanup(); }
});

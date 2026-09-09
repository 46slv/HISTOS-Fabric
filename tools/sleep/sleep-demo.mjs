import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { putCompiledUnderstanding } from '../understanding/compiled-understanding.mjs';
import { enqueueSleep, runSleep, inspectSleep, createH03SleepInspector, sleepDigest } from './sleep-consolidator.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function demonstrateSleep(outputRoot) {
  if (!path.isAbsolute(outputRoot)) throw new Error('ABSOLUTE_DEMO_ROOT_REQUIRED');
  // The parent must select a fresh private output directory. Never overwrite evidence.
  await mkdir(outputRoot, { recursive: false });
  const sourceRoot = path.join(outputRoot, 'fixture-source'), cacheRoot = path.join(outputRoot, 'compiled'), root = path.join(outputRoot, 'sleep');
  await mkdir(sourceRoot);
  const scopeId = 'h04-private-demo';
  const scope = { scope_id: scopeId, paths_by_kind: { source: ['changing.txt', 'stable.txt'] } }, roots = { source: sourceRoot };
  const common = { root, scopeId }, inspect = createH03SleepInspector({ understanding: { cacheRoot, scope, roots } });
  await writeFile(path.join(sourceRoot, 'changing.txt'), 'Locally created demonstration source version one.\n');
  await writeFile(path.join(sourceRoot, 'stable.txt'), 'Locally created unchanged demonstration source.\n');
  async function compile(key, filename, timestamp) {
    const bytes = await readFile(path.join(sourceRoot, filename));
    return (await putCompiledUnderstanding({ cacheRoot, scope, roots, understanding: { key,
      kind: 'architecture_overview', title: key, summary: `Demonstration snapshot of ${filename}`, details: 'Deterministic local fixture. No model or host acceptance claim.',
      dependencies: [{ kind: 'source', path: filename, sha256: sha256(bytes), bytes: bytes.length }],
      coverage: { inspected: [{ kind: 'source', path: filename }], not_inspected: ['Real scheduler and product host acceptance'] },
      created_at: timestamp, last_verified_at: timestamp } })).object;
  }
  const changing = await compile('changing', 'changing.txt', '2026-09-08T01:00:00.000Z');
  const stable = await compile('stable', 'stable.txt', '2026-09-08T01:00:00.000Z');
  const delta = (id, object) => ({ id, resource_id: object.key, kind: 'understanding', scope_id: scopeId, fingerprint: sleepDigest(object), declared_bytes: 1024 });
  const burst = Array.from({ length: 32 }, (_, i) => delta(`burst-${i}`, changing));
  await enqueueSleep({ ...common, events: [...burst, delta('stable-initial', stable)] });
  const first = await runSleep({ ...common, inspect, maxResources: 1 });
  const second = await runSleep({ ...common, inspect, maxResources: 1 });
  assert.equal(first.coalesced, 31); assert.equal(first.pending, 1); assert.equal(second.cursor, 33);
  const duplicate = await enqueueSleep({ ...common, events: burst }); assert.equal(duplicate.duplicates, 32);
  await writeFile(path.join(sourceRoot, 'changing.txt'), 'Locally created demonstration source version two.\n');
  await enqueueSleep({ ...common, events: [delta('changed-source', changing)] });
  const stale = await runSleep({ ...common, inspect });
  assert.equal(stale.failed, 1);
  assert.deepEqual((await inspectSleep(common)).usable_candidates.map(item => item.key), ['understanding:stable']);
  const refreshed = await compile('changing', 'changing.txt', '2026-09-08T01:01:00.000Z');
  await enqueueSleep({ ...common, events: [delta('refreshed-source', refreshed)] });
  const refresh = await runSleep({ ...common, inspect });
  const final = await inspectSleep(common);
  assert.equal(refresh.pending, 0); assert.equal(final.history['understanding:changing'].length, 1);
  assert.equal(final.cursor, 35); assert.equal(final.usable_candidates.length, 2);
  const report = { schema: 'histos.sleep-private-demonstration/v1', status: 'LOCAL_COMPONENT_DEMONSTRATION_PASS', full_h04: false,
    timestamp: new Date().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch },
    fixture_scope: scopeId, fixture_data: 'Created locally for this demonstration; no user source or external model content',
    first, second, duplicate, stale, refresh, final_coverage: final.coverage,
    limitations: ['No real F06 scheduler wake', 'No native client or production host acceptance', 'Wall budget is admission-only; H03 I/O cannot be forcibly interrupted', 'No model-generated summaries, automatic source deletion or autonomous candidate activation'] };
  await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(outputRoot, 'inspection.json'), `${JSON.stringify(final, null, 2)}\n`, { flag: 'wx' });
  const files = ['report.json', 'inspection.json', 'sleep/state.json'];
  const hashes = [];
  for (const file of files) { const bytes = await readFile(path.join(outputRoot, file)); hashes.push({ path: file, bytes: bytes.length, sha256: sha256(bytes) }); }
  await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(hashes, null, 2)}\n`, { flag: 'wx' });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--output-root' || !process.argv[3] || process.argv.length !== 4) throw new Error('USAGE: node tools/sleep/sleep-demo.mjs --output-root ABSOLUTE_FRESH_PRIVATE_DIRECTORY');
  process.stdout.write(`${JSON.stringify(await demonstrateSleep(path.resolve(process.argv[3])), null, 2)}\n`);
}

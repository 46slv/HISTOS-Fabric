import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  externalizeIfOversized,
  externalizePayload,
  readArtifact,
  searchArtifact,
} from './artifact-store.mjs';

async function withStore(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'histos-externalize-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('small payload stays inline at the threshold', async () => {
  await withStore(async (root) => {
    const result = await externalizeIfOversized({ root, payload: 'abcd', thresholdBytes: 4 });
    assert.equal(result.externalized, false);
    assert.equal(result.disposition, 'INLINE');
    assert.equal(result.inline_utf8, 'abcd');
  });
});

test('oversized payload externalizes and exact bytes can be recovered', async () => {
  await withStore(async (root) => {
    const payload = 'alpha\nbeta target\ngamma\n';
    const result = await externalizeIfOversized({
      root,
      payload,
      thresholdBytes: 8,
      previewBytes: 5,
      source: { kind: 'tool', id: 'synthetic' },
    });
    assert.equal(result.externalized, true);
    assert.equal(result.disposition, 'CREATED');
    assert.equal(result.preview_utf8, 'alpha');
    assert.equal(result.ref.retention, 'manual');

    const read = await readArtifact({ root, ref: result.ref, startByte: 0, maxBytes: 4096 });
    assert.equal(Buffer.from(read.bytes_base64, 'base64').toString('utf8'), payload);
    assert.equal(read.eof, true);
  });
});

test('empty externalized artifact still returns a valid reopen instruction', async () => {
  await withStore(async (root) => {
    const result = await externalizePayload({ root, payload: '', previewBytes: 0 });
    assert.equal(result.ref.bytes, 0);
    assert.equal(result.reopen.start_byte, 0);
    assert.equal(result.reopen.max_bytes, 1);
    const read = await readArtifact({ root, ref: result.ref, startByte: 0, maxBytes: result.reopen.max_bytes });
    assert.equal(read.text_utf8, '');
    assert.equal(read.eof, true);
  });
});

test('same bytes deduplicate to the same content address', async () => {
  await withStore(async (root) => {
    const first = await externalizePayload({ root, payload: 'same bytes' });
    const second = await externalizePayload({ root, payload: 'same bytes' });
    assert.equal(first.disposition, 'CREATED');
    assert.equal(second.disposition, 'EXISTS');
    assert.equal(first.ref.sha256, second.ref.sha256);
  });
});

test('stored-byte tampering is detected and never silently overwritten', async () => {
  await withStore(async (root) => {
    const result = await externalizePayload({ root, payload: 'trusted payload' });
    const artifactPath = path.join(root, 'sha256', result.ref.sha256.slice(0, 2), `${result.ref.sha256}.blob`);
    await writeFile(artifactPath, 'tampered');

    await assert.rejects(
      () => readArtifact({ root, ref: result.ref, startByte: 0, maxBytes: 10 }),
      /ARTIFACT_CORRUPT/,
    );
    await assert.rejects(
      () => externalizePayload({ root, payload: 'trusted payload' }),
      /ARTIFACT_CORRUPT/,
    );
    assert.equal((await readFile(artifactPath, 'utf8')), 'tampered');
  });
});

test('range reads are bounded and reject starts beyond EOF', async () => {
  await withStore(async (root) => {
    const result = await externalizePayload({ root, payload: '0123456789' });
    const read = await readArtifact({ root, ref: result.ref, startByte: 3, maxBytes: 4 });
    assert.equal(read.text_utf8, '3456');
    assert.equal(read.start_byte, 3);
    assert.equal(read.end_byte_exclusive, 7);
    assert.equal(read.eof, false);
    await assert.rejects(
      () => readArtifact({ root, ref: result.ref, startByte: 11, maxBytes: 1 }),
      /READ_RANGE_OUT_OF_BOUNDS/,
    );
  });
});

test('search returns exact line and byte reopen coordinates', async () => {
  await withStore(async (root) => {
    const payload = 'first\nSecond TARGET line\nthird target\nfourth\n';
    const result = await externalizePayload({ root, payload });
    const search = await searchArtifact({ root, ref: result.ref, query: 'target', maxMatches: 10 });
    assert.equal(search.match_count, 2);
    assert.deepEqual(search.matches.map((match) => match.line), [2, 3]);

    const reopened = await readArtifact({
      root,
      ref: result.ref,
      startByte: search.matches[0].start_byte,
      maxBytes: search.matches[0].end_byte_exclusive - search.matches[0].start_byte,
    });
    assert.equal(reopened.text_utf8, 'Second TARGET line');
  });
});

test('search byte coordinates stay exact across UTF-8 and CRLF lines', async () => {
  await withStore(async (root) => {
    const payload = 'αβ\n日本 TARGET\r\n終わり target\n';
    const result = await externalizePayload({ root, payload });
    const search = await searchArtifact({ root, ref: result.ref, query: 'target', maxMatches: 10 });
    assert.equal(search.match_count, 2);
    assert.deepEqual(search.matches.map((match) => match.line), [2, 3]);

    for (const match of search.matches) {
      const reopened = await readArtifact({
        root,
        ref: result.ref,
        startByte: match.start_byte,
        maxBytes: match.end_byte_exclusive - match.start_byte,
      });
      assert.equal(reopened.text_utf8, match.text);
    }
  });
});

test('search truncation is reported only when additional matches exist', async () => {
  await withStore(async (root) => {
    const result = await externalizePayload({ root, payload: 'hit one\nhit two\nmiss\n' });
    const exact = await searchArtifact({ root, ref: result.ref, query: 'hit', maxMatches: 2 });
    assert.equal(exact.match_count, 2);
    assert.equal(exact.total_match_count, 2);
    assert.equal(exact.truncated, false);

    const limited = await searchArtifact({ root, ref: result.ref, query: 'hit', maxMatches: 1 });
    assert.equal(limited.match_count, 1);
    assert.equal(limited.total_match_count, 2);
    assert.equal(limited.truncated, true);
  });
});

test('store refuses a symlinked content-address prefix directory', async () => {
  await withStore(async (root) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'histos-externalize-outside-'));
    try {
      const probe = await externalizePayload({ root, payload: 'probe' });
      const maliciousPayload = 'different payload for symlink guard';
      const crypto = await import('node:crypto');
      const sha = crypto.createHash('sha256').update(maliciousPayload).digest('hex');
      const prefix = path.join(root, 'sha256', sha.slice(0, 2));
      await rm(prefix, { recursive: true, force: true });
      await symlink(outside, prefix, process.platform === 'win32' ? 'junction' : 'dir');
      assert.ok(probe.ref.sha256);
      await assert.rejects(
        () => externalizePayload({ root, payload: maliciousPayload }),
        /UNSAFE_STORE_LAYOUT/,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

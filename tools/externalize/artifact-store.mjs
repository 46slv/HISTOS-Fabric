import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

const REF_SCHEMA = 'histos.externalized-artifact/v0';
const RESULT_SCHEMA = 'histos.externalize-result/v0';
const SHA256_RE = /^[a-f0-9]{64}$/;

function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function asBuffer(payload) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  throw new Error('INVALID_PAYLOAD: expected string, Buffer, or Uint8Array');
}

function assertPositiveInteger(value, label, { allowZero = false } = {}) {
  const minimumOk = allowZero ? value >= 0 : value > 0;
  if (!Number.isInteger(value) || !minimumOk) {
    throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
}

function artifactRelativePath(sha256) {
  return path.join('sha256', sha256.slice(0, 2), `${sha256}.blob`);
}

function assertArtifactRef(ref) {
  if (!ref || typeof ref !== 'object') throw new Error('INVALID_ARTIFACT_REF: expected object');
  if (ref.schema !== REF_SCHEMA) throw new Error(`INVALID_ARTIFACT_REF: expected schema ${REF_SCHEMA}`);
  if (!SHA256_RE.test(ref.sha256 ?? '')) throw new Error('INVALID_ARTIFACT_REF: invalid sha256');
  assertPositiveInteger(ref.bytes, 'artifact bytes', { allowZero: true });
  if (ref.retention !== 'manual') throw new Error('INVALID_ARTIFACT_REF: retention must be manual in v0');
  if (typeof ref.content_type !== 'string' || ref.content_type.length === 0) {
    throw new Error('INVALID_ARTIFACT_REF: content_type required');
  }
  return ref;
}

async function ensureStoreRoot(root) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('INVALID_STORE_ROOT: root required');
  await mkdir(root, { recursive: true });
  const rootReal = await realpath(root);
  const stat = await lstat(rootReal);
  if (!stat.isDirectory()) throw new Error('INVALID_STORE_ROOT: root must be a directory');
  return rootReal;
}

async function ensureArtifactDir(rootReal, sha256) {
  const shaRoot = path.join(rootReal, 'sha256');
  const prefixDir = path.join(shaRoot, sha256.slice(0, 2));
  await mkdir(prefixDir, { recursive: true });

  for (const candidate of [shaRoot, prefixDir]) {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`UNSAFE_STORE_LAYOUT: expected real directory: ${candidate}`);
    }
    const resolved = await realpath(candidate);
    const relative = path.relative(rootReal, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`UNSAFE_STORE_LAYOUT: directory escapes root: ${candidate}`);
    }
  }
  return prefixDir;
}

async function verifyStoredBytes(finalPath, expectedSha256, expectedBytes) {
  let stored;
  try {
    stored = await readFile(finalPath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('ARTIFACT_MISSING: referenced artifact does not exist');
    throw error;
  }
  if (stored.byteLength !== expectedBytes || digestBytes(stored) !== expectedSha256) {
    throw new Error('ARTIFACT_CORRUPT: stored bytes do not match content address');
  }
  return stored;
}

async function publishContentAddressed(rootReal, bytes, sha256) {
  const dir = await ensureArtifactDir(rootReal, sha256);
  const finalPath = path.join(dir, `${sha256}.blob`);

  try {
    await access(finalPath, fsConstants.F_OK);
    await verifyStoredBytes(finalPath, sha256, bytes.byteLength);
    return { finalPath, disposition: 'EXISTS' };
  } catch (error) {
    if (error?.message?.startsWith('ARTIFACT_CORRUPT')) throw error;
    if (error?.code !== 'ENOENT') {
      try {
        await access(finalPath, fsConstants.F_OK);
      } catch (accessError) {
        if (accessError?.code !== 'ENOENT') throw accessError;
      }
    }
  }

  const tempPath = path.join(dir, `.${sha256}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let tempCreated = false;
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    tempCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await link(tempPath, finalPath);
      return { finalPath, disposition: 'CREATED' };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await verifyStoredBytes(finalPath, sha256, bytes.byteLength);
      return { finalPath, disposition: 'EXISTS' };
    }
  } finally {
    if (tempCreated) await rm(tempPath, { force: true });
  }
}

function makePreview(bytes, maxBytes) {
  assertPositiveInteger(maxBytes, 'preview_bytes', { allowZero: true });
  if (maxBytes === 0 || bytes.byteLength === 0) return '';
  const prefix = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes));
  return prefix.toString('utf8');
}

export async function externalizePayload({
  root,
  payload,
  contentType = 'text/plain; charset=utf-8',
  source = null,
  previewBytes = 256,
}) {
  const bytes = asBuffer(payload);
  const sha256 = digestBytes(bytes);
  const rootReal = await ensureStoreRoot(root);
  const publication = await publishContentAddressed(rootReal, bytes, sha256);

  const ref = Object.freeze({
    schema: REF_SCHEMA,
    sha256,
    bytes: bytes.byteLength,
    content_type: contentType,
    retention: 'manual',
    source,
  });

  return Object.freeze({
    schema: RESULT_SCHEMA,
    disposition: publication.disposition,
    externalized: true,
    ref,
    preview_utf8: makePreview(bytes, previewBytes),
    reopen: Object.freeze({
      operation: 'context.read',
      sha256,
      start_byte: 0,
      max_bytes: Math.max(1, Math.min(bytes.byteLength, Math.max(previewBytes, 1))),
    }),
  });
}

export async function externalizeIfOversized({
  root,
  payload,
  thresholdBytes,
  contentType = 'text/plain; charset=utf-8',
  source = null,
  previewBytes = 256,
}) {
  assertPositiveInteger(thresholdBytes, 'threshold_bytes', { allowZero: true });
  const bytes = asBuffer(payload);
  if (bytes.byteLength <= thresholdBytes) {
    return Object.freeze({
      schema: RESULT_SCHEMA,
      disposition: 'INLINE',
      externalized: false,
      bytes: bytes.byteLength,
      content_type: contentType,
      source,
      inline_utf8: bytes.toString('utf8'),
    });
  }
  return externalizePayload({ root, payload: bytes, contentType, source, previewBytes });
}

async function loadVerifiedArtifact(root, ref) {
  const checked = assertArtifactRef(ref);
  const rootReal = await ensureStoreRoot(root);
  const relativePath = artifactRelativePath(checked.sha256);
  const finalPath = path.join(rootReal, relativePath);
  return verifyStoredBytes(finalPath, checked.sha256, checked.bytes);
}

export async function readArtifact({ root, ref, startByte = 0, maxBytes = 4096 }) {
  assertPositiveInteger(startByte, 'start_byte', { allowZero: true });
  assertPositiveInteger(maxBytes, 'max_bytes');
  const bytes = await loadVerifiedArtifact(root, ref);
  if (startByte > bytes.byteLength) throw new Error('READ_RANGE_OUT_OF_BOUNDS: start_byte exceeds artifact length');
  const endByte = Math.min(bytes.byteLength, startByte + maxBytes);
  const slice = bytes.subarray(startByte, endByte);
  return Object.freeze({
    schema: 'histos.context-read/v0',
    sha256: ref.sha256,
    start_byte: startByte,
    end_byte_exclusive: endByte,
    total_bytes: bytes.byteLength,
    eof: endByte === bytes.byteLength,
    bytes_base64: slice.toString('base64'),
    text_utf8: slice.toString('utf8'),
  });
}

export async function searchArtifact({ root, ref, query, maxMatches = 20 }) {
  if (typeof query !== 'string' || query.length === 0) throw new Error('INVALID_SEARCH_QUERY: query required');
  assertPositiveInteger(maxMatches, 'max_matches');
  const bytes = await loadVerifiedArtifact(root, ref);
  const needle = query.toLocaleLowerCase();
  const matches = [];
  const lines = [];
  let start = 0;
  for (let index = 0; index <= bytes.byteLength; index += 1) {
    if (index !== bytes.byteLength && bytes[index] !== 0x0a) continue;
    let contentEnd = index;
    if (contentEnd > start && bytes[contentEnd - 1] === 0x0d) contentEnd -= 1;
    lines.push({
      start_byte: start,
      end_byte_exclusive: contentEnd,
      text: bytes.subarray(start, contentEnd).toString('utf8'),
    });
    start = index + 1;
  }

  let totalMatches = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.text.toLocaleLowerCase().includes(needle)) continue;
    totalMatches += 1;
    if (matches.length >= maxMatches) continue;
    matches.push(Object.freeze({
      line: index + 1,
      start_byte: line.start_byte,
      end_byte_exclusive: line.end_byte_exclusive,
      text: line.text,
      reopen: Object.freeze({
        operation: 'context.read',
        sha256: ref.sha256,
        start_byte: line.start_byte,
        max_bytes: Math.max(line.end_byte_exclusive - line.start_byte, 1),
      }),
    }));
  }

  return Object.freeze({
    schema: 'histos.context-search/v0',
    sha256: ref.sha256,
    query,
    match_count: matches.length,
    total_match_count: totalMatches,
    truncated: totalMatches > matches.length,
    matches,
  });
}

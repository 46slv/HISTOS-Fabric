import { createHash } from 'node:crypto';

export function digestBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sealSnapshot(beforeBytes, afterBytes) {
  const beforeDigest = digestBytes(beforeBytes);
  const afterDigest = digestBytes(afterBytes);
  if (beforeDigest !== afterDigest) {
    throw new Error('SOURCE_MOVED: source changed while the capture was being sealed');
  }
  return { sha256: beforeDigest, bytes: beforeBytes.byteLength };
}

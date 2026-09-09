import { evaluateHeldOut, sealRecord, sha256 } from './typed-retrieval.mjs';

export const H06_SCOPE = Object.freeze({
  scope_id: 'project-h06-held-out',
  source_paths: ['alpha.md', 'beta.md', 'gamma.md'],
});

export const H06_SOURCES = Object.freeze([
  Object.freeze({ kind: 'source', path: 'alpha.md', sha256: sha256('alpha source'), bytes: Buffer.byteLength('alpha source') }),
  Object.freeze({ kind: 'source', path: 'beta.md', sha256: sha256('beta source'), bytes: Buffer.byteLength('beta source') }),
  Object.freeze({ kind: 'source', path: 'gamma.md', sha256: sha256('gamma source'), bytes: Buffer.byteLength('gamma source') }),
]);

function fixtureRecord(id, title, source, relations = {}) {
  return {
    id,
    kind: 'semantic',
    scope_id: H06_SCOPE.scope_id,
    title,
    summary: `${title} summary`,
    details: `${title} details`,
    status: 'verified',
    confidence: 1,
    references: [source],
    relations,
    created_at: '2026-09-08T01:00:00.000Z',
    last_verified_at: '2026-09-08T01:01:00.000Z',
    verification: { claim_sha256: sha256(`claim:${id}`) },
    authority: 'none',
    current_truth: false,
  };
}

export const H06_RECORDS = Object.freeze([
  sealRecord(fixtureRecord('alpha', 'Alpha incident', H06_SOURCES[0], { contradicts: ['beta'] })),
  sealRecord(fixtureRecord('beta', 'Beta correction', H06_SOURCES[1])),
  sealRecord(fixtureRecord('gamma', 'Gamma independent', H06_SOURCES[2])),
]);

export const H06_CASES = Object.freeze([
  { id: 'relation-case', kind: 'relation', query: 'Alpha', expected_ids: ['alpha', 'beta'] },
  { id: 'lexical-case', kind: 'control', query: 'Gamma', expected_ids: ['gamma'] },
  { id: 'no-answer', kind: 'control', query: 'not-present', expected_ids: [] },
]);

export function runH06Evaluation() {
  return evaluateHeldOut({ scope: H06_SCOPE, records: H06_RECORDS, sources: H06_SOURCES, cases: H06_CASES });
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  process.stdout.write(`${JSON.stringify(runH06Evaluation(), null, 2)}\n`);
}

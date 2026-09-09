import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  activationCapabilityEvidence,
  buildSkillProjectionManifest,
  inspectSkillProjection,
  normalizeProceduralRevision,
  projectSkill,
  renderSkillDocument,
  uninstallSkillProjection,
} from './skill-projection.mjs';

const digest = value => {
  // The implementation computes the source digest; tests only need stable
  // revision ids and therefore intentionally do not duplicate that algorithm.
  assert.ok(value);
};

function procedure(overrides = {}) {
  return {
    name: 'snapshot-review',
    description: 'Review an authorized source snapshot and reopen exact evidence before summarizing.',
    body: [
      '# Snapshot review',
      '',
      '1. Confirm the caller supplied project scope and snapshot identity.',
      '2. Search only the allowlisted snapshot and compile a bounded candidate.',
      '3. Reopen the exact artifact before explaining it; report stale or missing evidence.',
    ].join('\n'),
    source_revision: { id: 'procedure-v1' },
    review_status: 'accepted',
    evidence_refs: [{ id: 'review-proof-1', sha256: 'a'.repeat(64) }],
    ...overrides,
  };
}

async function fixtureRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'histos-skill-projection-'));
}

test('normalization requires a reviewed portable procedural revision', () => {
  const normalized = normalizeProceduralRevision(procedure());
  assert.equal(normalized.schema, 'histos.procedural-revision/v1');
  assert.equal(normalized.source_revision.id, 'procedure-v1');
  assert.match(normalized.source_revision.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(normalized.review_status, 'accepted');
  assert.equal(normalized.evidence_refs.length, 1);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), review_status: 'draft' }), /PROJECTION_REVIEW_REQUIRED/);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), name: '../escape' }), /PROJECTION_SKILL_NAME_INVALID/);
});

test('Codex and OpenCode projections share the exact portable SKILL.md body', async () => {
  const project = await fixtureRoot();
  try {
    const codexRoot = path.join(project, '.agents', 'codex-skills');
    const openCodeRoot = path.join(project, '.agents', 'opencode-skills');
    const codex = await projectSkill({ procedure: procedure(), target: 'codex', projectRoot: project, destinationRoot: codexRoot });
    const openCode = await projectSkill({ procedure: procedure(), target: 'opencode', projectRoot: project, destinationRoot: openCodeRoot });
    const codexDocument = await readFile(path.join(codexRoot, 'snapshot-review', 'SKILL.md'), 'utf8');
    const openCodeDocument = await readFile(path.join(openCodeRoot, 'snapshot-review', 'SKILL.md'), 'utf8');
    assert.equal(codexDocument, openCodeDocument);
    assert.equal(codex.manifest.compatibility.core_body_shared, true);
    assert.equal(openCode.manifest.compatibility.core_body_shared, true);
    assert.equal(codex.manifest.target.family, 'codex');
    assert.equal(openCode.manifest.target.family, 'opencode');
    assert.equal(codex.activation.status, 'NOT_RUN');
    assert.equal(openCode.activation.status, 'NOT_RUN');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('projection manifest is deterministic and activation evidence is explicit', () => {
  const first = buildSkillProjectionManifest({ procedure: procedure(), target: 'codex', targetPath: 'skills/snapshot-review' });
  const second = buildSkillProjectionManifest({ procedure: procedure(), target: 'codex', targetPath: 'skills/snapshot-review' });
  assert.deepEqual(first, second);
  assert.equal(first.activation.status, 'NOT_RUN');
  assert.equal(first.authority_boundary.authority, 'none');
  assert.equal(first.authority_boundary.current_truth, false);
  assert.equal(first.authority_boundary.permission_grant, false);
  assert.deepEqual(activationCapabilityEvidence({ target: 'opencode' }), {
    target: 'opencode', status: 'NOT_RUN', reason: 'activation_probe_not_run',
  });
  digest(first.source.sha256);
});

test('update uses compare-and-swap and refuses managed-file drift', async () => {
  const project = await fixtureRoot();
  try {
    const destination = path.join(project, '.agents', 'skills');
    const initial = await projectSkill({ procedure: procedure(), target: 'codex', projectRoot: project, destinationRoot: destination });
    const updated = await projectSkill({
      procedure: procedure({
        body: `${procedure().body}\n\n4. Record the exact reopened evidence reference.`,
        source_revision: { id: 'procedure-v2' },
      }),
      target: 'codex',
      projectRoot: project,
      destinationRoot: destination,
      mode: 'update',
      expectedProjectionId: initial.projection_id,
      expectedSourceRevision: 'procedure-v1',
    });
    assert.equal(updated.status, 'updated');
    assert.equal(updated.manifest.previous_projection_id, initial.projection_id);
    assert.equal(updated.source_revision, 'procedure-v2');

    const documentPath = path.join(destination, 'snapshot-review', 'SKILL.md');
    await writeFile(documentPath, `${await readFile(documentPath, 'utf8')}\nuser drift\n`);
    await assert.rejects(
      projectSkill({
        procedure: procedure({ source_revision: { id: 'procedure-v3' } }),
        target: 'codex', projectRoot: project, destinationRoot: destination, mode: 'update',
        expectedProjectionId: updated.projection_id,
      }),
      error => error.code === 'PROJECTION_DRIFT_CONFLICT',
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('uninstall removes only owned files and refuses unowned files or drift', async () => {
  const project = await fixtureRoot();
  try {
    const destination = path.join(project, '.agents', 'skills');
    const result = await projectSkill({ procedure: procedure(), target: 'opencode', projectRoot: project, destinationRoot: destination });
    const skillDir = path.join(destination, 'snapshot-review');
    await writeFile(path.join(skillDir, 'notes.md'), 'user-owned');
    await assert.rejects(
      uninstallSkillProjection({ projectRoot: project, destinationRoot: destination, skillName: 'snapshot-review', expectedProjectionId: result.projection_id }),
      error => error.code === 'PROJECTION_UNOWNED_FILE',
    );
    await rm(path.join(skillDir, 'notes.md'));
    const removed = await uninstallSkillProjection({ projectRoot: project, destinationRoot: destination, skillName: 'snapshot-review', expectedProjectionId: result.projection_id });
    assert.deepEqual(removed.removed, ['.histos-projection.json', 'SKILL.md']);
    await assert.rejects(readFile(path.join(skillDir, 'SKILL.md')), error => error.code === 'ENOENT');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('scope, secret, authority, path escape and unsupported target inputs fail closed', async () => {
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), api_key: 'sk-test-secret-value' }), /PROJECTION_UNSAFE_FIELD/);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), body: 'Set password=supersecret in the current Mission.' }), /PROJECTION_SECRET_REJECTED|PROJECTION_AUTHORITY_FORBIDDEN/);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), authority: 'operator' }), /PROJECTION_AUTHORITY_FORBIDDEN|PROJECTION_UNSAFE_FIELD/);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), mission_state: 'RUNNING' }), /PROJECTION_UNSAFE_FIELD/);
  assert.throws(() => normalizeProceduralRevision({ ...procedure(), scope: { scope_id: 'project', paths: ['../outside'] } }), /PROJECTION_SCOPE_INVALID/);
  assert.throws(() => buildSkillProjectionManifest({ procedure: procedure(), target: 'unknown', targetPath: 'skills/snapshot-review' }), /PROJECTION_TARGET_UNSUPPORTED/);
  const project = await fixtureRoot();
  const outside = path.join(path.dirname(project), `${path.basename(project)}-outside`);
  try {
    await assert.rejects(
      projectSkill({ procedure: procedure(), target: 'codex', projectRoot: project, destinationRoot: outside }),
      error => error.code === 'PROJECTION_DESTINATION_OUT_OF_SCOPE',
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('readback reports no drift for an untouched projection', async () => {
  const project = await fixtureRoot();
  try {
    const destination = path.join(project, 'project-local', 'skills');
    const result = await projectSkill({ procedure: procedure(), target: 'codex', projectRoot: project, destinationRoot: destination });
    const readback = await inspectSkillProjection({ projectRoot: project, destinationRoot: destination, skillName: 'snapshot-review' });
    assert.equal(readback.manifest.projection_id, result.projection_id);
    assert.deepEqual(readback.drift, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rendering is stable for an already normalized revision', () => {
  const normalized = normalizeProceduralRevision(procedure());
  assert.equal(renderSkillDocument(normalized), renderSkillDocument(normalized));
  assert.match(renderSkillDocument(normalized), /^---\nname: snapshot-review\ndescription:/u);
});


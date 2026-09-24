/**
 * Antigravity skills, discovered from real `SKILL.md` files under a temporary
 * home and workspace.
 *
 * What a user observes is the slash-command list the composer offers, so these
 * tests assert on the commands and scopes that come back, not on the roots the
 * facet happens to declare.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { providerSkillsService } from '@/modules/providers/services/skills.service.js';
import { AppError } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

const writeSkill = async (
  skillsRoot: string,
  directoryName: string,
  frontmatter: string,
): Promise<void> => {
  const skillDir = path.join(skillsRoot, directoryName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `${frontmatter}\n\nBody.\n`, 'utf8');
};

async function withSkillRoots(
  run: (roots: {
    workspacePath: string;
    projectRoot: string;
    cliUserRoot: string;
    configUserRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antigravity-skills-'));
  const workspacePath = path.join(homeDir, 'workspace');
  await fs.mkdir(workspacePath, { recursive: true });

  const restoreHomeDir = patchHomeDir(homeDir);
  try {
    await run({
      workspacePath,
      projectRoot: path.join(workspacePath, '.agents', 'skills'),
      cliUserRoot: path.join(homeDir, '.gemini', 'antigravity-cli', 'skills'),
      configUserRoot: path.join(homeDir, '.gemini', 'config', 'skills'),
    });
  } finally {
    restoreHomeDir();
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

test('a workspace skill is offered as a slash command in project scope', { concurrency: false }, async () => {
  await withSkillRoots(async ({ workspacePath, projectRoot }) => {
    await writeSkill(projectRoot, 'ship-it', '---\nname: ship-it\ndescription: Ship the branch.\n---');

    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath });

    assert.deepEqual(skills.map((skill) => ({
      name: skill.name,
      command: skill.command,
      scope: skill.scope,
      provider: skill.provider,
    })), [{ name: 'ship-it', command: '/ship-it', scope: 'project', provider: 'antigravity' }]);
    assert.equal(skills[0]?.description, 'Ship the branch.');
  });
});

test('both candidate global roots are scanned, since which one agy reads is unsettled', { concurrency: false }, async () => {
  // Open question Q2: only the IDE root was ever observed populated, so both
  // are offered rather than picking one and hiding the user's other skills.
  await withSkillRoots(async ({ workspacePath, cliUserRoot, configUserRoot }) => {
    await writeSkill(cliUserRoot, 'from-cli-root', '---\nname: from-cli-root\ndescription: A.\n---');
    await writeSkill(configUserRoot, 'from-config-root', '---\nname: from-config-root\ndescription: B.\n---');

    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath });

    assert.deepEqual(
      skills.map((skill) => skill.name).sort(),
      ['from-cli-root', 'from-config-root'],
    );
    assert.equal(skills.every((skill) => skill.scope === 'user'), true);
  });
});

test('project and global skills are listed together', { concurrency: false }, async () => {
  await withSkillRoots(async ({ workspacePath, projectRoot, cliUserRoot }) => {
    await writeSkill(projectRoot, 'local-one', '---\nname: local-one\ndescription: Local.\n---');
    await writeSkill(cliUserRoot, 'global-one', '---\nname: global-one\ndescription: Global.\n---');

    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath });

    assert.deepEqual(
      skills.map((skill) => `${skill.scope}:${skill.name}`).sort(),
      ['project:local-one', 'user:global-one'],
    );
  });
});

test('a malformed skill file does not hide the ones beside it', { concurrency: false }, async () => {
  await withSkillRoots(async ({ workspacePath, projectRoot }) => {
    await writeSkill(projectRoot, 'good', '---\nname: good\ndescription: Fine.\n---');
    await fs.mkdir(path.join(projectRoot, 'broken'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'broken', 'SKILL.md'), 'no frontmatter at all\n', 'utf8');

    const skills = await providerSkillsService.listProviderSkills('antigravity', { workspacePath });

    assert.ok(skills.some((skill) => skill.name === 'good'));
  });
});

test('no skill roots at all lists nothing instead of failing', { concurrency: false }, async () => {
  await withSkillRoots(async ({ workspacePath }) => {
    assert.deepEqual(await providerSkillsService.listProviderSkills('antigravity', { workspacePath }), []);
  });
});

test('antigravity skills are read-only — CloudCLI never writes into agy\'s roots', { concurrency: false }, async () => {
  // The facet declares no managed global root, which is what keeps the "new
  // skill" affordance from writing into a directory the IDE also scans.
  await withSkillRoots(async ({ workspacePath }) => {
    await assert.rejects(
      () => providerSkillsService.addProviderSkills('antigravity', {
        entries: [{ content: '---\nname: new-skill\ndescription: x\n---\n' }],
        workspacePath,
      } as never),
      (error: unknown) => error instanceof AppError
        && error.code === 'PROVIDER_SKILLS_WRITE_UNSUPPORTED'
        && error.statusCode === 400,
    );
  });
});

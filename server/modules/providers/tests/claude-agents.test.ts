import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import providerRouter from '@/modules/providers/provider.routes.js';
import {
  listClaudeAgents,
  readClaudeAgentPrompt,
  resolveClaudeAgentsDir,
} from '@/modules/providers/services/claude-agents.service.js';

// A custom Claude model can take its system prompt from one of the user's
// global agents. These tests pin how that directory is found, listed and read.
// Every test reads a temp directory passed in as `agentsDir`: on Windows,
// changing HOME does not move `os.homedir()`, so the real home is never used.

const withTempDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-agents-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const writeAgents = async (dir: string, files: Record<string, string>) => {
  await mkdir(dir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    await writeFile(path.join(dir, fileName), content);
  }
};

test('resolveClaudeAgentsDir prefers CLAUDE_CONFIG_DIR over the home directory', () => {
  const home = path.join(os.tmpdir(), 'some-home');

  assert.equal(resolveClaudeAgentsDir({}, home), path.join(home, '.claude', 'agents'));
  assert.equal(
    resolveClaudeAgentsDir({ CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'cfg') }, home),
    path.join(os.tmpdir(), 'cfg', 'agents'),
  );
  // Empty or blank means "not set".
  assert.equal(resolveClaudeAgentsDir({ CLAUDE_CONFIG_DIR: '' }, home), path.join(home, '.claude', 'agents'));
  assert.equal(resolveClaudeAgentsDir({ CLAUDE_CONFIG_DIR: '   ' }, home), path.join(home, '.claude', 'agents'));
});

test('listClaudeAgents takes the name from the frontmatter and falls back to the file name', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'file-name-differs.md': '---\nname: dispatch-coder\ndescription: Writes code\n---\nYou are a coder.\n',
      'no-name.md': '---\ndescription: Has no name key\n---\nBody.\n',
      'no-frontmatter.md': 'Just a prompt, no frontmatter.\n',
    });

    const agents = await listClaudeAgents({ agentsDir });

    assert.deepEqual(agents, [
      { name: 'dispatch-coder', description: 'Writes code', tools: null, disallowedTools: null },
      { name: 'no-frontmatter', description: '', tools: null, disallowedTools: null },
      { name: 'no-name', description: 'Has no name key', tools: null, disallowedTools: null },
    ]);
  });
});

test('listClaudeAgents parses tools and disallowedTools from a string or a list, and reports null when absent', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'comma.md': '---\nname: comma\ntools: Read, Grep,  Glob\n---\nBody.\n',
      'list.md': '---\nname: list\ntools:\n  - Read\n  - Bash\ndisallowedTools: [Write, Edit]\n---\nBody.\n',
      'denied.md': '---\nname: denied\ndisallowedTools: Write, Edit\n---\nBody.\n',
      'open.md': '---\nname: open\ndescription: No restriction\n---\nBody.\n',
    });

    const byName = Object.fromEntries(
      (await listClaudeAgents({ agentsDir })).map((agent) => [agent.name, agent]),
    );

    assert.deepEqual(byName.comma?.tools, ['Read', 'Grep', 'Glob']);
    assert.equal(byName.comma?.disallowedTools, null);
    assert.deepEqual(byName.list?.tools, ['Read', 'Bash']);
    assert.deepEqual(byName.list?.disallowedTools, ['Write', 'Edit']);
    assert.equal(byName.denied?.tools, null);
    assert.deepEqual(byName.denied?.disallowedTools, ['Write', 'Edit']);
    assert.equal(byName.open?.tools, null);
    assert.equal(byName.open?.disallowedTools, null);
  });
});

test('listClaudeAgents reads only top-level markdown files', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'top.md': '---\nname: top\n---\nBody.\n',
      'notes.txt': '---\nname: not-markdown\n---\nBody.\n',
    });
    await writeAgents(path.join(agentsDir, 'nested'), {
      'deep.md': '---\nname: deep\n---\nBody.\n',
    });

    const names = (await listClaudeAgents({ agentsDir })).map((agent) => agent.name);

    assert.deepEqual(names, ['top']);
  });
});

test('listClaudeAgents leaves out names a custom model could not save', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'valid.md': '---\nname: valid_agent-1\n---\nBody.\n',
      // The name is the frontmatter one, so a valid file name does not help.
      'valid-file-name.md': '---\nname: has space\n---\nBody.\n',
      'chinese.md': '---\nname: 中文助手\n---\nBody.\n',
      // No frontmatter name: the file name stands in, dots included.
      'dotted.name.md': 'Body.\n',
      [`${'a'.repeat(65)}.md`]: 'Body.\n',
      [`${'b'.repeat(64)}.md`]: 'Body.\n',
    });

    const names = (await listClaudeAgents({ agentsDir })).map((agent) => agent.name);

    // 64 characters is the longest name the save-time check accepts.
    assert.deepEqual(names, ['b'.repeat(64), 'valid_agent-1']);
    // Only the list is filtered: reading takes whatever name is stored.
    assert.equal(await readClaudeAgentPrompt('dotted.name', { agentsDir }), 'Body.');
  });
});

test('listClaudeAgents returns an empty list when the directory does not exist', async () => {
  await withTempDir(async (dir) => {
    assert.deepEqual(await listClaudeAgents({ agentsDir: path.join(dir, 'missing') }), []);
  });
});

test('listClaudeAgents skips a file it cannot read or parse instead of failing', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'good.md': '---\nname: good\n---\nBody.\n',
      'malformed.md': '---\nname: [unclosed\ndescription: "also open\n---\nBody.\n',
    });
    // A directory named like an agent cannot be read as a file.
    await mkdir(path.join(agentsDir, 'unreadable.md'));

    const names = (await listClaudeAgents({ agentsDir })).map((agent) => agent.name);

    assert.deepEqual(names, ['good']);
  });
});

test('listClaudeAgents reads frontmatter written with Windows line endings', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'crlf.md': '---\r\nname: crlf-agent\r\ndescription: Saved on Windows\r\ntools: Read, Grep\r\n---\r\nBody.\r\n',
    });

    assert.deepEqual(await listClaudeAgents({ agentsDir }), [
      { name: 'crlf-agent', description: 'Saved on Windows', tools: ['Read', 'Grep'], disallowedTools: null },
    ]);
  });
});

test('readClaudeAgentPrompt returns the trimmed body of the agent with that frontmatter name', async () => {
  await withTempDir(async (agentsDir) => {
    await writeAgents(agentsDir, {
      'file-name-differs.md': '---\nname: dispatch-coder\ndescription: Writes code\ntools: Read\n---\n\n\n  You are a coder.\n\n- Be brief.\n\n\n',
      'by-file-name.md': 'No frontmatter here.\n',
    });

    assert.equal(
      await readClaudeAgentPrompt('dispatch-coder', { agentsDir }),
      'You are a coder.\n\n- Be brief.',
    );
    // The file name only counts for an agent that has no frontmatter name.
    assert.equal(await readClaudeAgentPrompt('file-name-differs', { agentsDir }), null);
    assert.equal(await readClaudeAgentPrompt('by-file-name', { agentsDir }), 'No frontmatter here.');
  });
});

test('readClaudeAgentPrompt returns null for a missing agent, an empty body, an unreadable file or no directory', async () => {
  await withTempDir(async (dir) => {
    const agentsDir = path.join(dir, 'agents');
    await writeAgents(agentsDir, {
      'empty.md': '---\nname: empty\n---\n  \n\n',
      'other.md': '---\nname: other\n---\nBody.\n',
    });
    await mkdir(path.join(agentsDir, 'unreadable.md'));

    assert.equal(await readClaudeAgentPrompt('empty', { agentsDir }), null);
    assert.equal(await readClaudeAgentPrompt('ghost', { agentsDir }), null);
    assert.equal(await readClaudeAgentPrompt('unreadable', { agentsDir }), null);
    assert.equal(await readClaudeAgentPrompt('other', { agentsDir: path.join(dir, 'missing') }), null);
    // A name is only ever compared with frontmatter, never joined into a path.
    assert.equal(await readClaudeAgentPrompt('../agents/other', { agentsDir }), null);
  });
});

test('GET /api/providers/claude/agents serves the agent list from the resolved directory', async () => {
  await withTempDir(async (configDir) => {
    await writeAgents(path.join(configDir, 'agents'), {
      'coder.md': '---\nname: dispatch-coder\ndescription: Writes code\ntools: Read, Grep\n---\nYou are a coder.\n',
      'plain.md': 'Plain prompt.\n',
      // A name a model could not be saved with must not be offered.
      'dotted.md': '---\nname: has.dot\n---\nBody.\n',
    });

    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    const app = express().use('/api/providers', providerRouter);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/api/providers/claude/agents`);
      const payload = await response.json() as { success: boolean; data: { agents: unknown[] } };

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.deepEqual(payload.data.agents, [
        { name: 'dispatch-coder', description: 'Writes code', tools: ['Read', 'Grep'], disallowedTools: null },
        { name: 'plain', description: '', tools: null, disallowedTools: null },
      ]);

      // A directory that does not exist is an empty list, not an error.
      process.env.CLAUDE_CONFIG_DIR = path.join(configDir, 'missing');
      const emptyResponse = await fetch(`http://127.0.0.1:${port}/api/providers/claude/agents`);
      const emptyPayload = await emptyResponse.json() as { success: boolean; data: { agents: unknown[] } };
      assert.equal(emptyResponse.status, 200);
      assert.deepEqual(emptyPayload.data.agents, []);
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

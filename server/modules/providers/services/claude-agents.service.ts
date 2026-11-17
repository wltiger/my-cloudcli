import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseFrontMatter } from '@/shared/frontmatter.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

/**
 * What the model library needs to know about one global agent: the name
 * `claude --agent` takes, a one-line description, and the tool restrictions the
 * agent's frontmatter declares (`null` when it declares none for that key).
 */
type ClaudeAgentSummary = {
  name: string;
  description: string;
  tools: string[] | null;
  disallowedTools: string[] | null;
};

type ClaudeAgentFile = ClaudeAgentSummary & {
  /** Markdown after the frontmatter, untrimmed. */
  body: string;
};

type ClaudeAgentsOptions = {
  /** Directory to read instead of the resolved global one; tests pass a temp directory. */
  agentsDir?: string;
};

/**
 * Where the CLI keeps the user's global agents: `$CLAUDE_CONFIG_DIR/agents`
 * when that variable is set and not blank (the main chat forwards it to the
 * CLI), otherwise `~/.claude/agents`. `env` and `home` are parameters so a test
 * can resolve against its own values; on Windows `os.homedir()` ignores HOME.
 * Used by `listClaudeAgents` and `readClaudeAgentPrompt`, the one place the
 * agent list endpoint and the side-question fork agree on the directory.
 */
export function resolveClaudeAgentsDir(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): string {
  const configDirectory = env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(configDirectory || path.join(home, '.claude'), 'agents');
}

/**
 * Reads a `tools`/`disallowedTools` frontmatter value, which the CLI accepts as
 * a comma-separated string or a YAML list. A missing key is `null` (no
 * restriction declared); a key left empty is an empty list, which is a
 * restriction of its own.
 */
const readToolList = (value: unknown): string[] | null => {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return [];
  }

  let entries: string[];
  if (typeof value === 'string') {
    entries = value.split(',');
  } else if (Array.isArray(value)) {
    entries = value.filter((entry): entry is string => typeof entry === 'string');
  } else {
    return null;
  }

  return entries.map((entry) => entry.trim()).filter(Boolean);
};

/**
 * Parses every top-level `*.md` file of the agents directory, sorted by name.
 * A missing directory is an empty list, and a file that cannot be read or
 * whose frontmatter cannot be parsed is skipped: one bad agent must not hide
 * the others.
 */
const readClaudeAgentFiles = async (agentsDir: string): Promise<ClaudeAgentFile[]> => {
  let fileNames: string[];
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    fileNames = entries
      .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const agents: ClaudeAgentFile[] = [];
  for (const fileName of fileNames) {
    try {
      const parsed = parseFrontMatter(await readFile(path.join(agentsDir, fileName), 'utf8'));
      const data = readObjectRecord(parsed.data) ?? {};
      agents.push({
        name: readOptionalString(data.name) ?? path.basename(fileName, '.md'),
        description: readOptionalString(data.description) ?? '',
        tools: readToolList(data.tools),
        disallowedTools: readToolList(data.disallowedTools),
        body: parsed.content,
      });
    } catch {
      // Unreadable or malformed: leave this agent out and keep the rest.
    }
  }

  return agents.sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * Lists the global agents a Claude custom model can pick. The name is the
 * frontmatter `name` (what `claude --agent` matches), falling back to the file
 * name. Used by `GET /api/providers/claude/agents` in `provider.routes.ts`,
 * which feeds the model library's agent dropdown.
 */
export async function listClaudeAgents(
  options: ClaudeAgentsOptions = {},
): Promise<ClaudeAgentSummary[]> {
  const files = await readClaudeAgentFiles(options.agentsDir ?? resolveClaudeAgentsDir());
  return files.map((agent) => ({
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    disallowedTools: agent.disallowedTools,
  }));
}

/**
 * Reads the prompt of the agent called `name`: the markdown after its
 * frontmatter, trimmed. Null when no agent has that name, its file cannot be
 * read, or the body is empty, so a caller can tell "nothing to send" from a
 * prompt. The name is only compared with agent names, never joined into a path.
 * Used by the side-question fork, which cannot look an agent up by name itself.
 */
export async function readClaudeAgentPrompt(
  name: string,
  options: ClaudeAgentsOptions = {},
): Promise<string | null> {
  const files = await readClaudeAgentFiles(options.agentsDir ?? resolveClaudeAgentsDir());
  const prompt = files.find((agent) => agent.name === name)?.body.trim();
  return prompt || null;
}

import { useEffect, useRef, useState } from 'react';

import { authenticatedFetch, readApiJson } from '@/shared/api';
import type { ClaudeAgentSummary, LLMProvider, ProviderModelOption } from '@/shared/types';

/**
 * Claude-only per-model setting: replacing Claude Code's default system prompt
 * with a global agent's prompt or a custom text, for endpoints that reject
 * requests carrying the default one. See fork-customizations.md.
 *
 * `agent` and `prompt` both live in the form state whatever `mode` is, so
 * switching modes never loses what was typed; only the selected one is saved.
 */
export type ClaudeSystemPromptMode = 'default' | 'agent' | 'prompt';

export type ClaudeSystemPromptValue = {
  mode: ClaudeSystemPromptMode;
  agent: string;
  prompt: string;
};

export const EMPTY_SYSTEM_PROMPT: ClaudeSystemPromptValue = {
  mode: 'default',
  agent: '',
  prompt: '',
};

export const readClaudeSystemPromptFromOption = (
  provider: LLMProvider,
  option: ProviderModelOption,
): ClaudeSystemPromptValue => {
  if (provider !== 'claude') {
    return EMPTY_SYSTEM_PROMPT;
  }

  if (option.systemPromptAgent) {
    return { ...EMPTY_SYSTEM_PROMPT, mode: 'agent', agent: option.systemPromptAgent };
  }
  if (option.systemPrompt) {
    return { ...EMPTY_SYSTEM_PROMPT, mode: 'prompt', prompt: option.systemPrompt };
  }
  return EMPTY_SYSTEM_PROMPT;
};

/**
 * Only the selected source's key is present: the other key is absent rather
 * than `undefined`, and an update carrying neither is what clears a stored
 * choice. A selected source with nothing in it counts as the default.
 */
export const buildClaudeSystemPromptPayload = (
  provider: LLMProvider,
  value: ClaudeSystemPromptValue,
): { systemPromptAgent?: string; systemPrompt?: string } => {
  if (provider !== 'claude') {
    return {};
  }

  if (value.mode === 'agent') {
    const systemPromptAgent = value.agent.trim();
    return systemPromptAgent ? { systemPromptAgent } : {};
  }
  if (value.mode === 'prompt') {
    const systemPrompt = value.prompt.trim();
    return systemPrompt ? { systemPrompt } : {};
  }
  return {};
};

const AGENTS_URL = '/api/providers/claude/agents';
const MAX_PROMPT_LENGTH = 50000;
// Agent descriptions can run to several paragraphs; an <option> must stay one line.
const MAX_DESCRIPTION_LENGTH = 80;

const MODE_CHOICES: Array<{ mode: ClaudeSystemPromptMode; label: string }> = [
  // Not plain "Default": that text is also the catalog's built-in model row.
  { mode: 'default', label: 'Default prompt' },
  { mode: 'agent', label: 'Use an agent' },
  { mode: 'prompt', label: 'Custom prompt' },
];

const FIELD_CLASS_NAME = 'mt-1.5 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/** "limits tools: Read, Grep" for an allow-list, "blocks tools: Bash" for a deny-list; empty when the agent declares neither. */
const describeToolLimits = (agent: ClaudeAgentSummary): string => {
  const limits: string[] = [];
  if (agent.tools) {
    limits.push(agent.tools.length > 0 ? `limits tools: ${agent.tools.join(', ')}` : 'limits tools');
  }
  if (agent.disallowedTools) {
    limits.push(agent.disallowedTools.length > 0 ? `blocks tools: ${agent.disallowedTools.join(', ')}` : 'blocks tools');
  }
  return limits.join('; ');
};

const describeAgent = (agent: ClaudeAgentSummary): string => {
  const description = agent.description.replace(/\s+/g, ' ').trim();
  const shortDescription = description.length > MAX_DESCRIPTION_LENGTH
    ? `${description.slice(0, MAX_DESCRIPTION_LENGTH).trimEnd()}…`
    : description;
  const toolLimits = describeToolLimits(agent);
  return `${agent.name}${shortDescription ? ` — ${shortDescription}` : ''}${toolLimits ? ` (${toolLimits})` : ''}`;
};

type ClaudeSystemPromptFieldsProps = {
  value: ClaudeSystemPromptValue;
  onChange: (next: ClaudeSystemPromptValue) => void;
};

export default function ClaudeSystemPromptFields({ value, onChange }: ClaudeSystemPromptFieldsProps) {
  // null until the list answers. It is fetched the first time agent mode is
  // shown and kept for the life of the form, so switching modes never refetches.
  const [agents, setAgents] = useState<ClaudeAgentSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    if (value.mode !== 'agent' || requested.current) {
      return;
    }
    requested.current = true;

    const load = async () => {
      try {
        const response = await authenticatedFetch(AGENTS_URL);
        const payload = await readApiJson<{ data?: { agents?: ClaudeAgentSummary[] } }>(response);
        setAgents(payload.data?.agents ?? []);
      } catch (error) {
        console.error('Error loading Claude agents:', error);
        setLoadFailed(true);
      }
    };

    void load();
  }, [value.mode]);

  const loading = agents === null && !loadFailed;
  // Only a list that actually loaded can say the stored agent's file is gone;
  // while it loads or after it failed, the stored name is shown as it is.
  const storedAgentMissing = agents !== null
    && value.agent !== ''
    && !agents.some((agent) => agent.name === value.agent);

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
      <p id="custom-model-system-prompt-label" className="text-xs font-semibold text-foreground">
        System prompt
      </p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        Claude Code&apos;s default system prompt is used unless you replace it here. Some endpoints
        reject requests that carry it.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="custom-model-system-prompt-label"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5"
      >
        {MODE_CHOICES.map((choice) => (
          <label key={choice.mode} className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
            <input
              type="radio"
              name="custom-model-system-prompt-mode"
              checked={value.mode === choice.mode}
              onChange={() => onChange({ ...value, mode: choice.mode })}
              className="h-4 w-4 shrink-0 accent-primary"
            />
            {choice.label}
          </label>
        ))}
      </div>

      {value.mode === 'agent' && (
        <div className="mt-3">
          <label className="block text-xs font-semibold text-foreground" htmlFor="custom-model-system-prompt-agent">
            Agent
          </label>
          <select
            id="custom-model-system-prompt-agent"
            value={value.agent}
            disabled={loading}
            onChange={(event) => onChange({ ...value, agent: event.target.value })}
            className={`${FIELD_CLASS_NAME} h-10`}
          >
            {loading && !value.agent && <option value="">Loading agents…</option>}
            {!loading && <option value="">Choose an agent…</option>}
            {value.agent !== '' && (loading || loadFailed) && (
              <option value={value.agent}>{value.agent}</option>
            )}
            {agents?.map((agent) => (
              <option key={agent.name} value={agent.name}>{describeAgent(agent)}</option>
            ))}
            {storedAgentMissing && (
              <option value={value.agent}>{value.agent} (file not found)</option>
            )}
          </select>
          {loadFailed && (
            <p role="alert" className="mt-1.5 text-[11px] leading-4 text-destructive">
              Could not load agents
            </p>
          )}
          {agents?.length === 0 && (
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              No agents found in your global agents folder.
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Choosing an agent also applies its tool limits to the chat.
          </p>
        </div>
      )}

      {value.mode === 'prompt' && (
        <div className="mt-3">
          <label className="block text-xs font-semibold text-foreground" htmlFor="custom-model-system-prompt-text">
            System prompt text
          </label>
          <textarea
            id="custom-model-system-prompt-text"
            value={value.prompt}
            onChange={(event) => onChange({ ...value, prompt: event.target.value })}
            rows={8}
            placeholder="Write the full system prompt here"
            autoComplete="off"
            spellCheck={false}
            className={`${FIELD_CLASS_NAME} resize-y py-2 font-mono text-xs leading-5`}
          />
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Replaces Claude Code&apos;s default system prompt. Up to {MAX_PROMPT_LENGTH.toLocaleString('en-US')} characters.
          </p>
        </div>
      )}
    </div>
  );
}

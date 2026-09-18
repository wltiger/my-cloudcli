import { Input } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, ProviderModelOption } from '@/shared/types';

/**
 * Claude-only per-model settings: routing a custom model's sessions to a
 * self-hosted endpoint instead of the logged-in subscription, and declaring the
 * context window that model really accepts. See fork-customizations.md.
 *
 * `contextWindowK` is the raw text of the K-unit input (K = 1024 tokens) and is
 * deliberately independent of `enabled`: the unknown-model window assumption
 * applies to the model name, not to the endpoint.
 */
export type ClaudeCustomEndpointValue = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  effortLevels: string[];
  contextWindowK: string;
};

export const EMPTY_CUSTOM_ENDPOINT: ClaudeCustomEndpointValue = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  effortLevels: [],
  contextWindowK: '',
};

/** Must match `CUSTOM_MODEL_EFFORT_LEVELS` in `custom-model-endpoint.ts` on the server. */
const KNOWN_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * K means 1024 here, matching the server's own range check. The conversion
 * lives only in this file's read-back/payload helpers: the API, the database
 * and the runtime all carry raw tokens.
 */
const TOKENS_PER_K = 1024;

export const readClaudeCustomEndpointFromOption = (
  provider: LLMProvider,
  option: ProviderModelOption,
): ClaudeCustomEndpointValue => {
  if (provider !== 'claude') {
    return EMPTY_CUSTOM_ENDPOINT;
  }

  const contextWindowK = option.contextWindow ? String(option.contextWindow / TOKENS_PER_K) : '';
  if (!option.baseUrl) {
    return { ...EMPTY_CUSTOM_ENDPOINT, contextWindowK };
  }

  return {
    enabled: true,
    baseUrl: option.baseUrl,
    apiKey: option.apiKey ?? '',
    effortLevels: option.effort?.values.map((level) => level.value) ?? [],
    contextWindowK,
  };
};

/**
 * Tokens the declared K value stands for, or undefined when the field is empty
 * (which clears the declaration server-side). A field that holds something
 * unreadable resolves to 0 rather than undefined, so the server rejects it
 * instead of silently treating it as "cleared".
 */
const readDeclaredContextWindow = (contextWindowK: string): number | undefined => {
  const entered = contextWindowK.trim();
  if (!entered) {
    return undefined;
  }

  const units = Number(entered);
  return Number.isFinite(units) ? units * TOKENS_PER_K : 0;
};

export const buildClaudeCustomEndpointPayload = (
  provider: LLMProvider,
  value: ClaudeCustomEndpointValue,
): { baseUrl?: string; apiKey?: string; effortLevels?: string[]; contextWindow?: number } => {
  if (provider !== 'claude') {
    return {};
  }

  // The window rides along even with the endpoint pair switched off; the
  // endpoint fields still only exist when it is on.
  const contextWindow = readDeclaredContextWindow(value.contextWindowK);
  if (!value.enabled) {
    return { contextWindow };
  }

  return {
    baseUrl: value.baseUrl.trim(),
    apiKey: value.apiKey.trim(),
    effortLevels: value.effortLevels,
    contextWindow,
  };
};

/**
 * Same switch the settings tabs render, re-stated here rather than imported:
 * `SettingsToggle` is internal to the settings module, and a cross-module import
 * would both breach the module boundary and close a settings -> chat -> settings
 * import cycle.
 */
function EndpointToggle({ checked, onChange, ariaLabel }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 flex-shrink-0 touch-manipulation cursor-pointer items-center rounded-full border-2 transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px] bg-white' : 'translate-x-[2px] bg-foreground/60 dark:bg-foreground/80',
        )}
      />
    </button>
  );
}

type ClaudeCustomEndpointFieldsProps = {
  value: ClaudeCustomEndpointValue;
  onChange: (next: ClaudeCustomEndpointValue) => void;
};

export default function ClaudeCustomEndpointFields({ value, onChange }: ClaudeCustomEndpointFieldsProps) {
  const toggleEffortLevel = (level: string) => {
    const effortLevels = value.effortLevels.includes(level)
      ? value.effortLevels.filter((existing) => existing !== level)
      : [...value.effortLevels, level];
    onChange({ ...value, effortLevels });
  };

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Route to my own endpoint</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Use a self-hosted Base URL + API Key for this model instead of your Claude subscription.
          </p>
        </div>
        <EndpointToggle
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
          ariaLabel="Route this model to a custom Base URL and API Key"
        />
      </div>

      {value.enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-foreground" htmlFor="custom-model-base-url">
              Base URL
            </label>
            <Input
              id="custom-model-base-url"
              value={value.baseUrl}
              onChange={(event) => onChange({ ...value, baseUrl: event.target.value })}
              placeholder="e.g. http://localhost:11434"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 h-10 rounded-xl bg-background font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground" htmlFor="custom-model-api-key">
              API Key
            </label>
            <Input
              id="custom-model-api-key"
              value={value.apiKey}
              onChange={(event) => onChange({ ...value, apiKey: event.target.value })}
              placeholder="Sent as the standard Anthropic API key header"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 h-10 rounded-xl bg-background font-mono"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Reasoning effort (optional)</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Levels this endpoint accepts. Leave all unchecked to hide the Reasoning picker for this model.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {KNOWN_EFFORT_LEVELS.map((level) => (
                <label key={level} className="flex items-center gap-1.5 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={value.effortLevels.includes(level)}
                    onChange={() => toggleEffortLevel(level)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  {level}
                </label>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            Stored and returned unmasked. The endpoint must already speak the Anthropic Messages API —
            Anthropic does not support or endorse routing Claude Code through third-party endpoints.
          </p>
        </div>
      )}

      <div className="mt-3 border-t border-border/70 pt-3">
        <label className="block text-xs font-semibold text-foreground" htmlFor="custom-model-context-window">
          Context window (K, optional)
        </label>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          K means 1024 tokens, so 256 declares a 262144-token window. Only needed when this model&apos;s
          window differs from what Claude Code assumes for an unrecognized model name (200K). Leave it
          empty for subscription models and for any model using the <code>[1m]</code> name suffix.
        </p>
        <Input
          id="custom-model-context-window"
          type="number"
          inputMode="numeric"
          min={1}
          max={1024}
          step={1}
          value={value.contextWindowK}
          onChange={(event) => onChange({ ...value, contextWindowK: event.target.value })}
          placeholder="e.g. 256"
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 h-10 rounded-xl bg-background font-mono"
        />
      </div>
    </div>
  );
}

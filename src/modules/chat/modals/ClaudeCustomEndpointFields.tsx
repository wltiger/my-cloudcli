import { Input } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider, ProviderModelOption } from '@/shared/types';

/**
 * Claude-only: routes a custom model's sessions to a self-hosted endpoint
 * instead of the logged-in subscription. See fork-customizations.md.
 */
export type ClaudeCustomEndpointValue = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  effortLevels: string[];
};

export const EMPTY_CUSTOM_ENDPOINT: ClaudeCustomEndpointValue = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  effortLevels: [],
};

/** Must match `CUSTOM_MODEL_EFFORT_LEVELS` in `custom-model-endpoint.ts` on the server. */
const KNOWN_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const readClaudeCustomEndpointFromOption = (
  provider: LLMProvider,
  option: ProviderModelOption,
): ClaudeCustomEndpointValue => {
  if (provider !== 'claude' || !option.baseUrl) {
    return EMPTY_CUSTOM_ENDPOINT;
  }

  return {
    enabled: true,
    baseUrl: option.baseUrl,
    apiKey: option.apiKey ?? '',
    effortLevels: option.effort?.values.map((level) => level.value) ?? [],
  };
};

export const buildClaudeCustomEndpointPayload = (
  provider: LLMProvider,
  value: ClaudeCustomEndpointValue,
): { baseUrl?: string; apiKey?: string; effortLevels?: string[] } => {
  if (provider !== 'claude' || !value.enabled) {
    return {};
  }

  return { baseUrl: value.baseUrl.trim(), apiKey: value.apiKey.trim(), effortLevels: value.effortLevels };
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
    </div>
  );
}

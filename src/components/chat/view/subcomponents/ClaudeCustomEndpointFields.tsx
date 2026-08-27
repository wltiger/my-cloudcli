import SettingsToggle from '../../../settings/view/SettingsToggle';
import { Input } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelOption } from '../../../../types/app';

/**
 * Claude-only: routes a custom model's sessions to a self-hosted endpoint
 * instead of the logged-in subscription. See fork-customizations.md.
 */
export type ClaudeCustomEndpointValue = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
};

export const EMPTY_CUSTOM_ENDPOINT: ClaudeCustomEndpointValue = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
};

export const readClaudeCustomEndpointFromOption = (
  provider: LLMProvider,
  option: ProviderModelOption,
): ClaudeCustomEndpointValue => {
  if (provider !== 'claude' || !option.baseUrl) {
    return EMPTY_CUSTOM_ENDPOINT;
  }

  return { enabled: true, baseUrl: option.baseUrl, apiKey: option.apiKey ?? '' };
};

export const buildClaudeCustomEndpointPayload = (
  provider: LLMProvider,
  value: ClaudeCustomEndpointValue,
): { baseUrl?: string; apiKey?: string } => {
  if (provider !== 'claude' || !value.enabled) {
    return {};
  }

  return { baseUrl: value.baseUrl.trim(), apiKey: value.apiKey.trim() };
};

type ClaudeCustomEndpointFieldsProps = {
  value: ClaudeCustomEndpointValue;
  onChange: (next: ClaudeCustomEndpointValue) => void;
};

export default function ClaudeCustomEndpointFields({ value, onChange }: ClaudeCustomEndpointFieldsProps) {
  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Route to my own endpoint</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            Use a self-hosted Base URL + API Key for this model instead of your Claude subscription.
          </p>
        </div>
        <SettingsToggle
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
          <p className="text-[11px] leading-4 text-muted-foreground">
            Stored and returned unmasked. The endpoint must already speak the Anthropic Messages API —
            Anthropic does not support or endorse routing Claude Code through third-party endpoints.
          </p>
        </div>
      )}
    </div>
  );
}

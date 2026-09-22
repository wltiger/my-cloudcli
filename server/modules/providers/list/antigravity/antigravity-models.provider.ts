import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;

/**
 * Curated Antigravity catalog shipped as immutable CloudCLI defaults.
 *
 * `agy models` is the only enumeration the CLI offers, and it is TSV-only,
 * server-fetched and auth-gated: signed out it answers an empty list with
 * "Please sign in to view available models." (verified on 1.2.7). This
 * hardcoded catalog is therefore the source of truth, and it is what the
 * picker gets while signed out.
 *
 * Reasoning effort is **baked into the model id** (`-high`/`-medium`/`-low`)
 * rather than being a separate control, so `supportsEffort` is false and the
 * `--effort` flag is never passed — effort is expressed by choosing a model.
 *
 * No context-window figure is exposed anywhere (`agy models`, the config files
 * and the binary all lack one), so no option declares `contextWindow` and the
 * usage readout stays on the server-level default instead of showing an
 * invented number.
 */
export const ANTIGRAVITY_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (high)', description: 'Highest reasoning effort.' },
    { value: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (medium)', description: 'Balanced reasoning effort.' },
    { value: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (low)', description: 'Lowest reasoning effort.' },
    { value: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (high)', description: 'Highest reasoning effort.' },
    { value: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (medium)', description: 'Balanced reasoning effort.' },
    { value: 'gemini-3.7-flash-low', label: 'Gemini 3.7 Flash (low)', description: 'Lowest reasoning effort.' },
    { value: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (high)', description: 'Highest reasoning effort.' },
    { value: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (medium)', description: 'Balanced reasoning effort.' },
    { value: 'gemini-3.6-flash-low', label: 'Gemini 3.6 Flash (low)', description: 'Lowest reasoning effort.' },
    { value: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (high)', description: 'Highest reasoning effort.' },
    { value: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (low)', description: 'Lowest reasoning effort.' },
    { value: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (thinking)', description: 'Extended thinking.' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (medium)', description: 'Open-weight model, balanced reasoning effort.' },
  ],
  DEFAULT: 'gemini-3.8-flash-high',
};

/** Guards against a hung CLI keeping a probe pending forever. */
const AGY_MODELS_TIMEOUT_MS = 15_000;

/** How long a completed live-list answer is reused before it is refreshed. */
const LIVE_CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type LiveCatalog = {
  fetchedAt: number;
  /** Model ids the account can actually use; empty when signed out. */
  ids: string[];
};

/**
 * Fork-owned in-memory cache of the last live `agy models` answer.
 *
 * Upstream's provider adapters all return a source-controlled catalog with no
 * runtime discovery at all, and this fork only adds to that: the static catalog
 * above is still what `getSupportedModels` hands back on a cold process. The
 * live list is *merged into* this cache, never substituted for the catalog, so
 * a signed-out or unreachable server degrades to the catalog rather than to an
 * empty picker.
 */
let liveCatalog: LiveCatalog | null = null;
let liveCatalogRefresh: Promise<LiveCatalog | null> | null = null;

/**
 * Parses `agy models`, which prints TSV `id<TAB>display name` and rejects
 * `--output-format` on 1.2.7 despite its own changelog claiming otherwise.
 */
export const parseAgyModelsOutput = (stdout: string): string[] => {
  const ids: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.split('\t')[0]?.trim();
    // The "Please sign in to view available models." line and any banner fail
    // the id shape check, so a signed-out answer yields an empty list.
    if (id && /^[A-Za-z0-9._-]+$/.test(id)) {
      ids.push(id);
    }
  }
  return ids;
};

/**
 * Runs `agy models` once and returns the model ids it reported.
 *
 * `null` means the probe could not run at all (the CLI is missing or hung);
 * an empty array means it ran and reported no models, which is what a signed-out
 * CLI does. Callers must not collapse the two: only the second is an answer
 * about sign-in state.
 *
 * Shared with the auth facet, which races its own call of this against a much
 * shorter deadline when the cache below holds nothing fresh — sign-in state is
 * owned rather than borrowed, but an auth-status poll must never be able to sit
 * out the full timeout above.
 */
export function probeAntigravityModelIds(): Promise<string[] | null> {
  return new Promise((resolve) => {
    let child;
    try {
      // Auto-update is disabled for this child only — never for CloudCLI's own
      // process, so the user's terminal `agy` keeps updating.
      child = spawnFunction('agy', ['models'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: '1' },
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const settle = (ids: string[] | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(ids);
    };

    // `spawn` has no timeout option; a hung CLI has to be killed by hand.
    const timeoutHandle = setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // Already gone.
      }
      settle(null);
    }, AGY_MODELS_TIMEOUT_MS);

    let stdout = '';
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.on('error', () => settle(null));
    // The exit code carries no information here: a signed-out run and a failed
    // one both print nothing parseable, so the ids alone decide.
    child.on('close', () => settle(parseAgyModelsOutput(stdout)));
  });
}

/**
 * Refreshes the cached live list in the background, coalescing concurrent
 * callers. Never awaited on a path that answers a request — the catalog is
 * served from the static list until this lands.
 */
const refreshAntigravityModelIds = (): Promise<LiveCatalog | null> => {
  if (liveCatalogRefresh) {
    return liveCatalogRefresh;
  }

  liveCatalogRefresh = probeAntigravityModelIds()
    .then((ids) => {
      liveCatalog = { fetchedAt: Date.now(), ids: ids ?? [] };
      return liveCatalog;
    })
    .catch(() => null)
    .finally(() => {
      liveCatalogRefresh = null;
    });

  return liveCatalogRefresh;
};

const isLiveCatalogFresh = (): boolean => (
  liveCatalog !== null && Date.now() - liveCatalog.fetchedAt < LIVE_CATALOG_REFRESH_INTERVAL_MS
);

/**
 * The cached live model ids, but only while they are still fresh.
 *
 * Exported for the auth facet: a cache the models-list path has already warmed
 * answers "is this account signed in" for free, so no second `agy models` child
 * process is spawned for it. `null` means this cache has no current answer —
 * never that the account is signed out.
 */
export const readFreshAntigravityModelIds = (): string[] | null => (
  isLiveCatalogFresh() && liveCatalog ? liveCatalog.ids : null
);

/**
 * Merges the live list into the static catalog.
 *
 * Catalog entries always win on a shared id, and live-only ids are appended
 * rather than replacing the list — the live list is merged, never substituted —
 * so a model the account can use but the catalog has never heard of becomes
 * visible, while a known model stays selectable even when the live list omits
 * it.
 */
export const mergeLiveModelIds = (
  base: ProviderModelsDefinition,
  liveIds: string[],
): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [...base.OPTIONS];
  const seen = new Set(options.map((option) => option.value));

  for (const id of liveIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    options.push({ value: id, label: id, description: 'Reported by `agy models`.' });
  }

  return { ...base, OPTIONS: options, DEFAULT: base.DEFAULT };
};

/** Provider registry model adapter for Antigravity predefined models. */
export class AntigravityProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!isLiveCatalogFresh()) {
      // Deliberately not awaited: the catalog is returned without waiting on
      // the network, and the refresh lands in the cache for the next call.
      void refreshAntigravityModelIds();
    }

    return liveCatalog
      ? mergeLiveModelIds(ANTIGRAVITY_PREDEFINED_MODELS, liveCatalog.ids)
      : ANTIGRAVITY_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // `agy` records no per-conversation model anywhere readable — neither
    // `transcript.jsonl` nor the `conversation_summaries.db` index carries one
    // — so a session the app has never recorded a model for falls back to the
    // catalog default.
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}

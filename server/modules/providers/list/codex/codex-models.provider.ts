import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

export const CODEX_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'gpt-5.6-sol',
      label: 'gpt-5.6-sol',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'gpt-5.6-terra',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'gpt-5.6-luna',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'gpt-5.5',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  DEFAULT: 'gpt-5.6-sol',
};

type CodexCachedModel = {
  slug?: string;
  display_name?: string;
  description?: string;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{
    effort?: string;
    description?: string;
  }>;
};

const CODEX_MODELS_CACHE_PATH = path.join(os.homedir(), '.codex', 'models_cache.json');
const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

// `models_cache.json` is a point-in-time snapshot that nothing here ever
// refreshes. The bundled `codex` binary can report its actual current model
// list (custom model providers included) via `debug models`, but only
// through this CLI subcommand — the SDK's JS API doesn't expose it. Codex is
// listed in provider-models.service.ts's UNCACHED_PROVIDERS, so this runs at
// most once per server process — cached here for the rest of its lifetime.
const CODEX_DEBUG_MODELS_TIMEOUT_MS = 8000;

const require = createRequire(import.meta.url);
let cachedLiveModels: CodexCachedModel[] | null = null;

const isCodexCachedModel = (value: unknown): value is CodexCachedModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.slug));
};

const resolveCodexBinPath = async (): Promise<string | null> => {
  try {
    const packageJsonPath = require.resolve('@openai/codex/package.json');
    const packageJson = readObjectRecord(JSON.parse(await readFile(packageJsonPath, 'utf8')));
    const binEntry = readOptionalString(readObjectRecord(packageJson?.bin)?.codex);
    return binEntry ? path.join(path.dirname(packageJsonPath), binEntry) : null;
  } catch {
    return null;
  }
};

const fetchLiveCodexModels = async (): Promise<CodexCachedModel[] | null> => {
  if (cachedLiveModels) {
    return cachedLiveModels;
  }

  const binPath = await resolveCodexBinPath();
  if (!binPath) {
    return null;
  }

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [binPath, 'debug', 'models'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let errorOutput = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('codex debug models timed out'));
      }, CODEX_DEBUG_MODELS_TIMEOUT_MS);

      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { errorOutput += chunk; });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `codex debug models exited with code ${code}`));
        }
      });
    });

    const parsed = readObjectRecord(JSON.parse(stdout));
    const models = Array.isArray(parsed?.models) ? parsed.models.filter(isCodexCachedModel) : [];
    if (models.length === 0) {
      return null;
    }

    cachedLiveModels = models;
    return models;
  } catch {
    return null;
  }
};

const readCodexPriority = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
);

const mapCodexModel = (model: CodexCachedModel): ProviderModelOption => {
  const effortValues = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => {
        const value = readOptionalString(level?.effort);
        if (!value) {
          return null;
        }

        return {
          value,
          description: readOptionalString(level?.description),
        };
      })
      .filter((level): level is NonNullable<typeof level> => Boolean(level))
    : [];

  return {
    value: model.slug as string,
    label: readOptionalString(model.display_name) ?? (model.slug as string),
    description: readOptionalString(model.description),
    effort: effortValues.length > 0
      ? {
          default: readOptionalString(model.default_reasoning_level) ?? undefined,
          values: effortValues,
        }
      : undefined,
  };
};

const buildCodexModelsDefinition = (models: CodexCachedModel[]): ProviderModelsDefinition => {
  const sortedModels = [...models]
    .filter((model) => model.visibility === 'list' && model.supported_in_api !== false)
    .sort((left, right) => readCodexPriority(left.priority) - readCodexPriority(right.priority));

  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of sortedModels) {
    const mappedModel = mapCodexModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CODEX_FALLBACK_MODELS;
  }

  return {
    OPTIONS: options,
    DEFAULT: options[0]?.value ?? CODEX_FALLBACK_MODELS.DEFAULT,
  };
};

export class CodexProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const liveModels = await fetchLiveCodexModels();
    if (liveModels) {
      return buildCodexModelsDefinition(liveModels);
    }

    try {
      const raw = await readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
      const parsed = readObjectRecord(JSON.parse(raw));
      const models = Array.isArray(parsed?.models)
        ? parsed.models.filter(isCodexCachedModel)
        : [];

      return buildCodexModelsDefinition(models);
    } catch {
      return CODEX_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}

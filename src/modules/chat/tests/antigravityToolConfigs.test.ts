import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { TOOL_CONFIGS } from '@/modules/chat/tools/configs/toolConfigs';

/**
 * The backend maps every `agy` tool onto a shape this registry reads, and one
 * fixture pins both halves of that contract: `expected` is what the mapper
 * writes, `mustRender` the input keys a card has to show. The backend asserts
 * the first half; this asserts the second. A rename to a name with no config
 * would otherwise fall to the Default card, and a config reading a key the
 * mapper never writes would draw an empty one — both silently.
 */

type FixtureCase = {
  agyName: string;
  expected: { toolName: string; input: Record<string, unknown> };
  mustRender: string[];
};

const FIXTURE_PATH = '../../../../server/modules/providers/tests/fixtures/antigravity-tool-mapping.json';
const { cases } = JSON.parse(
  readFileSync(fileURLToPath(new URL(FIXTURE_PATH, import.meta.url)), 'utf8'),
) as { cases: FixtureCase[] };

/** Every string a config's input getters produce for one input. */
const renderedText = (toolName: string, input: Record<string, unknown>): string[] => {
  const config = TOOL_CONFIGS[toolName].input;
  const texts: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      texts.push(value);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };

  [
    config.getValue?.(input),
    config.getSecondary?.(input),
    typeof config.title === 'function' ? config.title(input) : config.title,
    config.getContentProps?.(input),
  ].forEach(collect);
  return texts;
};

cases.forEach(({ agyName, expected, mustRender }, index) => {
  if (mustRender.length === 0) {
    return;
  }

  test(`case ${index}: ${agyName} → ${expected.toolName} shows ${mustRender.join(', ')}`, () => {
    assert.ok(TOOL_CONFIGS[expected.toolName], `${expected.toolName} has no config and would render as Default`);

    const text = renderedText(expected.toolName, expected.input);
    for (const key of mustRender) {
      const value = String(expected.input[key]);
      assert.ok(
        text.some((rendered) => rendered.includes(value)),
        `${expected.toolName} does not show ${key} (${value})`,
      );
    }
  });
});

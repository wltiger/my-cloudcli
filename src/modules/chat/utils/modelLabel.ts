/**
 * Readable labels for raw model ids the provider catalog doesn't list.
 *
 * A model set through the Claude Code CLI (rather than CloudCLI's own switcher)
 * arrives as a full id like `claude-sonnet-4-5-20250929`, which no catalog entry
 * matches. Rather than showing that whole string, the composer shows a short
 * label — but only when the id matches a recognisable Claude model-id shape:
 * `claude-` + family + optional version + optional build date + optional
 * long-context marker. Anything else returns null so the caller keeps the raw
 * id, because a guessed label can silently collapse two different models into
 * one name. See docs/adr/0001-strict-model-label-fallback.md.
 */
const MODEL_FAMILY_LABELS: Record<string, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku',
  fable: 'Fable',
};

/** The catalog spells the 1M-context variants `sonnet[1m]`; raw ids may too. */
const LONG_CONTEXT_MARKER = '[1m]';

const LONG_CONTEXT_LABEL = '[1M]';

const CLAUDE_PREFIX = 'claude-';

const BUILD_DATE_PATTERN = /^\d{8}$/;

const VERSION_PART_PATTERN = /^\d{1,3}$/;

const MAX_VERSION_PARTS = 2;

export const prettifyModelLabel = (rawId: unknown): string | null => {
  if (typeof rawId !== 'string') {
    return null;
  }

  let id = rawId.trim().toLowerCase();
  if (!id.startsWith(CLAUDE_PREFIX)) {
    return null;
  }

  const hasLongContext = id.endsWith(LONG_CONTEXT_MARKER);
  if (hasLongContext) {
    id = id.slice(0, -LONG_CONTEXT_MARKER.length);
  } else if (id.includes('[')) {
    // An unknown marker: not a shape we can read confidently.
    return null;
  }

  const [family, ...rest] = id.slice(CLAUDE_PREFIX.length).split('-');
  const familyLabel = MODEL_FAMILY_LABELS[family];
  if (!familyLabel) {
    return null;
  }

  // A trailing 8-digit build date is dropped from the label.
  const versionParts = BUILD_DATE_PATTERN.test(rest[rest.length - 1] ?? '')
    ? rest.slice(0, -1)
    : rest;
  if (versionParts.length > MAX_VERSION_PARTS
    || !versionParts.every((part) => VERSION_PART_PATTERN.test(part))) {
    return null;
  }

  const version = versionParts.join('.');
  return [familyLabel, version, hasLongContext ? LONG_CONTEXT_LABEL : '']
    .filter(Boolean)
    .join(' ');
};

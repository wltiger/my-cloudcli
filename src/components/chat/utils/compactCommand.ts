import type { SlashCommand } from '../hooks/useSlashCommands';

export const COMPACT_COMMAND_NAME = '/compact';

type CompactCommandOptions = {
  /** The active provider's Compact capability, as reported by the backend. */
  supported: boolean;
  /** Localized menu description. */
  description: string;
  /** Per-command usage counts, used to keep the menu's existing sort order. */
  usage: Record<string, number>;
};

/**
 * Adds the Compact entry to a fetched slash-command list.
 *
 * Compact has no backend command counterpart on purpose: it must reach the
 * provider verbatim rather than being executed as a UI action, so it is
 * offered client-side and only when the provider can actually run it. Keeping
 * this out of the fetching effect matters — the capability arrives after the
 * command list does, and depending on it there would refetch the whole list
 * a second time on every session open.
 */
export function withCompactCommand(
  commands: SlashCommand[],
  { supported, description, usage }: CompactCommandOptions,
): SlashCommand[] {
  if (!supported || commands.some((command) => command.name === COMPACT_COMMAND_NAME)) {
    return commands;
  }

  const compactCommand = {
    name: COMPACT_COMMAND_NAME,
    description,
    namespace: 'builtin',
    type: 'compact',
    metadata: { type: 'builtin' },
  } as SlashCommand;

  // Re-sort rather than append so Compact competes on usage like every other
  // command, matching how the fetched list was already ordered.
  return [...commands, compactCommand].sort(
    (commandA, commandB) => (usage[commandB.name] || 0) - (usage[commandA.name] || 0),
  );
}

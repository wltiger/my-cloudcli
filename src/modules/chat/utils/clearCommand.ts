import type { SlashCommand } from '@/shared/types';

export const CLEAR_COMMAND_NAME = '/clear';

type ClearCommandOptions = {
  /** The active provider's Clear capability, as reported by the backend. */
  supported: boolean;
  /** Localized menu description. */
  description: string;
  /** Per-command usage counts, used to keep the menu's existing sort order. */
  usage: Record<string, number>;
};

/**
 * Adds the Clear entry to a fetched slash-command list.
 *
 * Deliberately a second function rather than a generalization of
 * `withCompactCommand`: the two entries disagree about what selecting them
 * means. Compact must reach the provider verbatim, while Clear reaches no
 * provider at all — it retires the open conversation and opens an empty one,
 * so the composer intercepts it on its own `clear` type. Kept out of the
 * fetching effect for the same reason Compact is: the capability arrives after
 * the command list does.
 */
export function withClearCommand(
  commands: SlashCommand[],
  { supported, description, usage }: ClearCommandOptions,
): SlashCommand[] {
  if (!supported || commands.some((command) => command.name === CLEAR_COMMAND_NAME)) {
    return commands;
  }

  const clearCommand = {
    name: CLEAR_COMMAND_NAME,
    description,
    namespace: 'builtin',
    type: 'clear',
    metadata: { type: 'builtin' },
  } as SlashCommand;

  // Re-sort rather than append so Clear competes on usage like every other
  // command, matching how the fetched list was already ordered.
  return [...commands, clearCommand].sort(
    (commandA, commandB) => (usage[commandB.name] || 0) - (usage[commandA.name] || 0),
  );
}

/**
 * Opening the command palette from anywhere, without prop-drilling into it.
 *
 * The palette owns its own `open` state and its only trigger upstream is the
 * Cmd/Ctrl+K listener — unreachable on a touch device. A window event keeps
 * the fork's extra entry points decoupled: upstream gains one listener, and
 * callers never need a handle on the palette.
 */
export type CommandPalettePage = 'actions' | 'files' | 'sessions' | 'commits' | 'branches';

export const OPEN_COMMAND_PALETTE_EVENT = 'cloudcli:open-command-palette';

export type OpenCommandPaletteDetail = { page?: CommandPalettePage };

export function openCommandPalette(page?: CommandPalettePage): void {
  window.dispatchEvent(
    new CustomEvent<OpenCommandPaletteDetail>(OPEN_COMMAND_PALETTE_EVENT, { detail: { page } }),
  );
}

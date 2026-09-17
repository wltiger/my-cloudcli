/**
 * Whether the status tab above the composer is visible — one question with
 * two consumers: the composer renders the tab, and the transcript reserves
 * bottom space for it. Keeping a single definition stops the two from
 * drifting; their last drift let the tab cover the last message while a
 * session only held background work (ADR 0012: turn-in-flight and
 * background-work-outstanding are separate signals, and a consumer keeps its
 * old meaning until it is explicitly pointed at the one it means).
 *
 * Visibility only: nothing that gates a send reads this — the run-admission
 * check, the composer's queue gate and the transcript-refresh suppression
 * all keep reading turn-in-flight alone.
 */
export function isActivityIndicatorVisible({
  turnInFlight,
  backgroundWorkOutstanding,
  hasPendingPermissions,
}: {
  turnInFlight: boolean;
  backgroundWorkOutstanding: boolean;
  hasPendingPermissions: boolean;
}): boolean {
  return (turnInFlight || backgroundWorkOutstanding) && !hasPendingPermissions;
}

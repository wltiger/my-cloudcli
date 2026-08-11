import { scheduledTriggerService } from '@/modules/scheduled-triggers/services/scheduled-trigger.service.js';

const POLL_INTERVAL_MS = 30 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollOnce(): void {
  scheduledTriggerService.fireDueTriggers().catch((error) => {
    console.error('[ScheduledTriggers] Poll failed:', error instanceof Error ? error.message : error);
  });
}

/** Starts the boot-time poller. Idempotent — a second call is a no-op. */
export function startScheduledTriggerPoller(): void {
  if (pollTimer) {
    return;
  }

  // Recover anything left `firing` by a crash/unclean shutdown before the
  // first poll, so it's eligible to be claimed again instead of stuck forever.
  scheduledTriggerService.recoverStuckTriggers();

  // Fire once immediately so a trigger missed while the server was down
  // (and still within its grace window) resumes without waiting a full
  // poll interval.
  pollOnce();

  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled triggers.
  pollTimer.unref?.();
}

export function stopScheduledTriggerPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

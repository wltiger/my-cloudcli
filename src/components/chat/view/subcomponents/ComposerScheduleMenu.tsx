import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';

import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import type { ScheduledTrigger } from '../../hooks/useScheduledTrigger';

import { ComposerMenuHeading, ComposerMenuSurface } from './ComposerMenuPrimitives';

interface ComposerScheduleMenuProps {
  pendingTrigger: ScheduledTrigger | null;
  isLoading: boolean;
  onSchedule: (triggerAt: Date, messageContent: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

const RELATIVE_PRESET_MINUTES = [10, 60];
const DEFAULT_DRAFT_OFFSET_MINUTES = 5;
// Common "round" check-in times through the day, matched against the clock
// (not derived from `now`) so the grid preset always lands on one of these.
const GRID_HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toTimeString(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * There is no date picker at all — a bare "HH:mm" always means "the next
 * occurrence of that clock time": today if it hasn't passed yet, tomorrow
 * (at most 24h out) if it has. This is a pure, always-fresh computation, not
 * stored state, so nothing can "lock in" a stale today-vs-tomorrow decision.
 */
function resolveDraftDate(draftTime: string, now: Date): Date {
  const [hours, minutes] = draftTime.split(':').map(Number);
  const candidate = new Date(now);
  candidate.setHours(hours, minutes, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function isTomorrow(resolvedDate: Date, now: Date): boolean {
  return resolvedDate.getDate() !== now.getDate()
    || resolvedDate.getMonth() !== now.getMonth()
    || resolvedDate.getFullYear() !== now.getFullYear();
}

/** The next on-the-hour mark strictly after `now` (e.g. now=1:30 -> 2:00). */
function nextHourMark(now: Date): Date {
  const candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setHours(candidate.getHours() + 1);
  }
  return candidate;
}

/** The next `GRID_HOURS` mark strictly after `now` (e.g. now=14:57 -> 15:00; now=22:10 -> tomorrow 00:00). */
function nextGridMark(now: Date): Date {
  const candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);
  for (const hour of GRID_HOURS) {
    candidate.setHours(hour);
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(GRID_HOURS[0], 0, 0, 0);
  return candidate;
}

function defaultDraftTime(): string {
  return toTimeString(new Date(Date.now() + DEFAULT_DRAFT_OFFSET_MINUTES * 60_000));
}

/** Matches the native time input's own locale-driven format (12h "6:00 PM" vs 24h "18:00"), so labels never disagree with it. */
function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ComposerScheduleMenu({
  pendingTrigger,
  isLoading,
  onSchedule,
  onCancel,
}: ComposerScheduleMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(isOpen, close, 22 * 16);
  const [draftTime, setDraftTime] = useState(defaultDraftTime);
  const [draftMessage, setDraftMessage] = useState('continue');

  const heading = pendingTrigger
    ? t('composer.schedulePendingLabel', {
      time: new Date(pendingTrigger.triggerAt.replace(' ', 'T') + 'Z').toLocaleString(),
      defaultValue: 'Scheduled for {{time}}',
    })
    : t('composer.scheduleHeading', { defaultValue: 'Send a message later' });

  // Reopening always starts from a clean, current default — not whatever
  // was left over from a previous open, an edited-but-unsent draft, or a
  // trigger that was just cancelled.
  const handleToggleOpen = useCallback(() => {
    updateAnchor();
    if (!isOpen) {
      setDraftTime(defaultDraftTime());
      setDraftMessage('continue');
    }
    setIsOpen((current) => !current);
  }, [isOpen, updateAnchor]);

  const applyTimePreset = useCallback((date: Date) => {
    setDraftTime(toTimeString(date));
  }, []);

  // The +10/60min buttons add to whatever is currently drafted (not to
  // "now") so they can be clicked repeatedly to stack — e.g. two +10min
  // clicks land on +20min, composing with a prior preset/manual pick.
  const applyDelta = useCallback((minutes: number) => {
    const resolved = resolveDraftDate(draftTime, new Date());
    setDraftTime(toTimeString(new Date(resolved.getTime() + minutes * 60_000)));
  }, [draftTime]);

  const handleConfirm = useCallback(async () => {
    const triggerAt = resolveDraftDate(draftTime, new Date());
    if (Number.isNaN(triggerAt.getTime())) {
      return;
    }
    await onSchedule(triggerAt, draftMessage);
    setIsOpen(false);
  }, [draftTime, draftMessage, onSchedule]);

  const handleCancel = useCallback(async () => {
    await onCancel();
    setIsOpen(false);
  }, [onCancel]);

  const now = new Date();
  const resolvedDraftDate = resolveDraftDate(draftTime, now);
  const showsTomorrow = isTomorrow(resolvedDraftDate, now);
  const hourMark = nextHourMark(now);
  const gridMark = nextGridMark(now);
  const tomorrowShortcut = new Date(now);
  tomorrowShortcut.setHours(0, 5, 0, 0);
  const presetButtons = [
    ...RELATIVE_PRESET_MINUTES.map((minutes) => ({
      key: `delta-${minutes}`,
      label: t('composer.presetInMinutes', { minutes, defaultValue: '+{{minutes}}min' }),
      onClick: () => applyDelta(minutes),
    })),
    {
      key: 'hour',
      label: formatClockTime(hourMark),
      onClick: () => applyTimePreset(hourMark),
    },
    {
      key: 'grid',
      label: formatClockTime(gridMark),
      onClick: () => applyTimePreset(gridMark),
    },
    {
      key: 'tomorrow',
      label: formatClockTime(tomorrowShortcut),
      onClick: () => applyTimePreset(tomorrowShortcut),
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggleOpen}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          pendingTrigger
            ? 'border-blue-300/60 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-600/40 dark:bg-blue-900/15 dark:text-blue-300 dark:hover:bg-blue-900/25'
            : 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted'
        }`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('composer.scheduleButton', { defaultValue: 'Schedule a trigger' })}
        title={t('composer.scheduleButton', { defaultValue: 'Schedule a trigger' })}
      >
        <Clock className="h-4 w-4" />
      </button>

      {isOpen && anchor && createPortal(
        <ComposerMenuSurface anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>

          {pendingTrigger ? (
            <div className="px-2.5 pb-2">
              <button
                type="button"
                disabled={isLoading}
                onClick={handleCancel}
                className="w-full rounded-lg border border-border/60 px-3 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-accent disabled:opacity-50"
              >
                {t('composer.schedulePendingCancel', { defaultValue: 'Cancel scheduled trigger' })}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-2.5 pb-2">
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('composer.scheduleTimeLabel', { defaultValue: 'Send at' })}
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={draftTime}
                    onChange={(event) => { if (event.target.value) setDraftTime(event.target.value); }}
                    className="rounded-lg border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
                  />
                  {showsTomorrow && (
                    <span className="text-xs text-muted-foreground">
                      {t('composer.presetTomorrow', { defaultValue: 'Tomorrow' })}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-1 whitespace-nowrap">
                {presetButtons.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={preset.onClick}
                    className="rounded-full border border-border/60 px-1.5 py-0.5 text-xs text-foreground/80 transition-colors hover:bg-accent"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('composer.scheduleMessageLabel', { defaultValue: 'Message' })}
                <input
                  type="text"
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  className="rounded-lg border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
                />
              </label>
              <button
                type="button"
                disabled={isLoading}
                onClick={handleConfirm}
                className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {t('composer.scheduleConfirm', { defaultValue: 'Schedule' })}
              </button>
            </div>
          )}
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { ScheduleMessagePopover } from '@/modules/chat/composer/ScheduleMessagePopover';

/**
 * Seam: the schedule popover's `onSchedule`, which ChatInterface turns into the
 * scheduled message's options. Fork entry 31: the user picks what happens if
 * the session is busy when the message comes due — sent on time (the default,
 * upstream's behaviour) or waiting until the session is free.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

const openPopover = () => {
  const onSchedule = vi.fn<(scheduledFor: Date, onBusy: 'interrupt' | 'wait') => void>();
  render(<ScheduleMessagePopover disabled={false} onSchedule={onSchedule} />);
  fireEvent.click(screen.getByRole('button', { name: /schedule/i }));
  return onSchedule;
};

const row = (label: RegExp) => {
  const found = screen.getAllByRole('menuitemradio').find((item) => label.test(item.textContent ?? ''));
  assert.ok(found, `a row matching ${label}`);
  return found;
};

test('a message is scheduled to go out on time unless the user says otherwise', () => {
  const onSchedule = openPopover();

  assert.equal(row(/^Send on time/).getAttribute('aria-checked'), 'true');
  fireEvent.click(screen.getAllByRole('menuitemradio').find((item) => /15/.test(item.textContent ?? ''))!);

  assert.equal(onSchedule.mock.calls.length, 1);
  assert.equal(onSchedule.mock.calls[0]?.[1], 'interrupt');
});

test('choosing Wait schedules the message to wait for a busy session', () => {
  const onSchedule = openPopover();

  fireEvent.click(row(/^Wait/));
  assert.equal(row(/^Wait/).getAttribute('aria-checked'), 'true', 'the choice is shown, and the popover stays open');
  fireEvent.click(screen.getAllByRole('menuitemradio').find((item) => /15/.test(item.textContent ?? ''))!);

  assert.equal(onSchedule.mock.calls[0]?.[1], 'wait');
});

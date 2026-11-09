import { useTranslation } from 'react-i18next';

import { ComposerMenuHeading, ComposerMenuItem } from '@/modules/chat/composer/ComposerMenuPrimitives';

/**
 * What a scheduled message does when it comes due while its session is busy
 * (fork entry 31). `interrupt` is upstream's behaviour and the default.
 */
export type ScheduleBusyMode = 'interrupt' | 'wait';

type ScheduleBusyModeToggleProps = {
  value: ScheduleBusyMode;
  onChange: (value: ScheduleBusyMode) => void;
};

/**
 * Rendered inside chat's ScheduleMessagePopover, above the times, so the
 * choice is made before a time is picked (picking one schedules at once).
 * Either way a message the session can take without stopping anything goes
 * straight in; the choice only matters when it cannot.
 */
export function ScheduleBusyModeToggle({ value, onChange }: ScheduleBusyModeToggleProps) {
  const { t } = useTranslation('chat');

  return (
    <div role="group" aria-label={t('schedule.busy.heading', { defaultValue: 'If the session is busy then' })}>
      <ComposerMenuHeading>{t('schedule.busy.heading', { defaultValue: 'If the session is busy then' })}</ComposerMenuHeading>
      <ComposerMenuItem
        label={t('schedule.busy.interrupt.label', { defaultValue: 'Send on time' })}
        description={t('schedule.busy.interrupt.description', { defaultValue: 'Stops a running turn or background work if it has to' })}
        isSelected={value === 'interrupt'}
        onSelect={() => onChange('interrupt')}
      />
      <ComposerMenuItem
        label={t('schedule.busy.wait.label', { defaultValue: 'Wait' })}
        description={t('schedule.busy.wait.description', { defaultValue: 'Sends once the turn and its background work have finished' })}
        isSelected={value === 'wait'}
        onSelect={() => onChange('wait')}
      />
    </div>
  );
}

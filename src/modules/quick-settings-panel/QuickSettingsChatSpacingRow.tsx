import { StretchHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { normalizeChatSpacingLevel } from '@/shared/chatSpacing';
import { useChatSpacingLevel } from '@/shared/hooks/useChatSpacing';
import { SETTING_ROW_CLASS } from '@/shared/constants';

/**
 * Chat message spacing, self-contained like the dark mode and language rows:
 * it reads and writes the shared `chatSpacingLevel` storage key on its own
 * instead of going through the panel's boolean-only preference plumbing.
 */
export default function QuickSettingsChatSpacingRow() {
  const { t } = useTranslation('settings');
  const [level, setLevel] = useChatSpacingLevel();

  return (
    <div className={SETTING_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <StretchHorizontal className="h-4 w-4 text-muted-foreground" />
        {t('appearanceSettings.chatSpacing.label', 'Message spacing')}
      </span>
      <select
        value={level}
        onChange={(event) => setLevel(normalizeChatSpacingLevel(event.target.value))}
        aria-label={t('appearanceSettings.chatSpacing.label', 'Message spacing')}
        className="w-auto min-w-[120px] max-w-[160px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="spacious">{t('appearanceSettings.chatSpacing.spacious', 'Spacious')}</option>
        <option value="compact">{t('appearanceSettings.chatSpacing.compact', 'Compact')}</option>
        <option value="none">{t('appearanceSettings.chatSpacing.none', 'None')}</option>
      </select>
    </div>
  );
}

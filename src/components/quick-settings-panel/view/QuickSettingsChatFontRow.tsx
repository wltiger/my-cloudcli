import { Type } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatFontLevel } from '../../chat/hooks/useChatTypography';
import { normalizeChatFontLevel } from '../../chat/utils/chatTypography';
import { SETTING_ROW_CLASS } from '../constants';

/**
 * Reading font size, self-contained like the chat spacing row: it reads and
 * writes the shared `chatFontLevel` storage key on its own instead of going
 * through the panel's boolean-only preference plumbing.
 */
export default function QuickSettingsChatFontRow() {
  const { t } = useTranslation('settings');
  const [level, setLevel] = useChatFontLevel();

  return (
    <div className={SETTING_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <Type className="h-4 w-4 text-muted-foreground" />
        {t('appearanceSettings.chatFontSize.label', 'Reading font size')}
      </span>
      <select
        value={level}
        onChange={(event) => setLevel(normalizeChatFontLevel(event.target.value))}
        aria-label={t('appearanceSettings.chatFontSize.label', 'Reading font size')}
        className="w-auto min-w-[120px] max-w-[160px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="small">{t('appearanceSettings.chatFontSize.small', 'Small')}</option>
        <option value="medium">{t('appearanceSettings.chatFontSize.medium', 'Medium')}</option>
        <option value="large">{t('appearanceSettings.chatFontSize.large', 'Large')}</option>
        <option value="xlarge">{t('appearanceSettings.chatFontSize.xlarge', 'X-Large')}</option>
      </select>
    </div>
  );
}

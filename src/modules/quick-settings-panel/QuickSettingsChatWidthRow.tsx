import { MoveHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { normalizeChatWidthLevel } from '@/shared/chatTypography';
import { useChatWidthLevel } from '@/shared/hooks/useChatTypography';
import { SETTING_ROW_CLASS } from '@/shared/constants';

/**
 * Content column width, sharing the `chatWidthLevel` storage key with the full
 * Settings modal so a change in either surface reaches the other.
 */
export default function QuickSettingsChatWidthRow() {
  const { t } = useTranslation('settings');
  const [level, setLevel] = useChatWidthLevel();

  return (
    <div className={SETTING_ROW_CLASS}>
      <span className="flex items-center gap-2 text-sm text-foreground">
        <MoveHorizontal className="h-4 w-4 text-muted-foreground" />
        {t('appearanceSettings.chatWidth.label', 'Content width')}
      </span>
      <select
        value={level}
        onChange={(event) => setLevel(normalizeChatWidthLevel(event.target.value))}
        aria-label={t('appearanceSettings.chatWidth.label', 'Content width')}
        className="w-auto min-w-[120px] max-w-[160px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="standard">{t('appearanceSettings.chatWidth.standard', 'Standard')}</option>
        <option value="wide">{t('appearanceSettings.chatWidth.wide', 'Wide')}</option>
        <option value="wider">{t('appearanceSettings.chatWidth.wider', 'Wider')}</option>
        <option value="full">{t('appearanceSettings.chatWidth.full', 'Full')}</option>
      </select>
    </div>
  );
}

import { useTranslation } from 'react-i18next';

import QuickSettingsChatFontRow from './QuickSettingsChatFontRow';
import QuickSettingsChatSpacingRow from './QuickSettingsChatSpacingRow';
import QuickSettingsChatWidthRow from './QuickSettingsChatWidthRow';
import QuickSettingsSection from './QuickSettingsSection';

/**
 * Every quick setting this fork adds on top of upstream's panel lives here.
 *
 * Upstream's `QuickSettingsContent` mounts this as its last child, so adding or
 * removing a fork setting never touches an upstream file again — the only edit
 * over there is one append-only line at the end of the panel body.
 */
export default function ForkQuickSettings() {
  const { t } = useTranslation('settings');

  return (
    <QuickSettingsSection title={t('appearanceSettings.chatSpacing.title', 'Chat')}>
      <QuickSettingsChatFontRow />
      <QuickSettingsChatWidthRow />
      <QuickSettingsChatSpacingRow />
      <p className="ml-3 text-xs text-muted-foreground">
        {t(
          'appearanceSettings.chatSpacing.description',
          'Horizontal space around chat messages on mobile screens.',
        )}
      </p>
    </QuickSettingsSection>
  );
}

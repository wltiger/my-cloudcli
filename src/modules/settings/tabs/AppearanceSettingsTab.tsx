import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '@/shared/ui';
import type { CodeEditorSettingsState, ProjectSortOrder } from '@/shared/types';
import { normalizeChatSpacingLevel } from '@/shared/chatSpacing';
import type { ChatSpacingLevel } from '@/shared/chatSpacing';
import { normalizeChatFontLevel, normalizeChatWidthLevel } from '@/shared/chatTypography';
import type { ChatFontLevel, ChatWidthLevel } from '@/shared/chatTypography';
import { LanguageSelector } from '@/modules/i18n';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
  chatSpacingLevel: ChatSpacingLevel;
  onChatSpacingLevelChange: (value: ChatSpacingLevel) => void;
  chatFontLevel: ChatFontLevel;
  onChatFontLevelChange: (value: ChatFontLevel) => void;
  chatWidthLevel: ChatWidthLevel;
  onChatWidthLevelChange: (value: ChatWidthLevel) => void;
};

/** Rendered by Settings for the "appearance" tab, covering theme, project sorting and code editor preferences. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
  chatSpacingLevel,
  onChatSpacingLevelChange,
  chatFontLevel,
  onChatFontLevelChange,
  chatWidthLevel,
  onChatWidthLevelChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.chatSpacing.title', 'Chat')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.chatSpacing.label', 'Message spacing')}
            description={t(
              'appearanceSettings.chatSpacing.description',
              'Horizontal space around chat messages on mobile screens.',
            )}
          >
            <select
              value={chatSpacingLevel}
              onChange={(event) => onChatSpacingLevelChange(normalizeChatSpacingLevel(event.target.value))}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="spacious">{t('appearanceSettings.chatSpacing.spacious', 'Spacious')}</option>
              <option value="compact">{t('appearanceSettings.chatSpacing.compact', 'Compact')}</option>
              <option value="none">{t('appearanceSettings.chatSpacing.none', 'None')}</option>
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.chatFontSize.label', 'Reading font size')}
            description={t(
              'appearanceSettings.chatFontSize.description',
              'Size of the text you read in chat: message bodies and the questions an agent asks. Code, tool cards and timestamps keep their own sizes.',
            )}
          >
            <select
              value={chatFontLevel}
              onChange={(event) => onChatFontLevelChange(normalizeChatFontLevel(event.target.value))}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="small">{t('appearanceSettings.chatFontSize.small', 'Small')}</option>
              <option value="medium">{t('appearanceSettings.chatFontSize.medium', 'Medium')}</option>
              <option value="large">{t('appearanceSettings.chatFontSize.large', 'Large')}</option>
              <option value="xlarge">{t('appearanceSettings.chatFontSize.xlarge', 'X-Large')}</option>
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.chatWidth.label', 'Content width')}
            description={t(
              'appearanceSettings.chatWidth.description',
              'How wide the message column runs on a large screen. No effect on narrow screens, which are already narrower than every level.',
            )}
          >
            <select
              value={chatWidthLevel}
              onChange={(event) => onChatWidthLevelChange(normalizeChatWidthLevel(event.target.value))}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="standard">{t('appearanceSettings.chatWidth.standard', 'Standard')}</option>
              <option value="wide">{t('appearanceSettings.chatWidth.wide', 'Wide')}</option>
              <option value="wider">{t('appearanceSettings.chatWidth.wider', 'Wider')}</option>
              <option value="full">{t('appearanceSettings.chatWidth.full', 'Full')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

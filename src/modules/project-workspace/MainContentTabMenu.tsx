import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionMenu } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import type { AppTab } from '@/shared/types';
import { PluginIcon } from '@/modules/plugins';
import type { TabDefinition } from '@/modules/project-workspace/WorkspaceTabs';

type MainContentTabMenuProps = {
  tabs: TabDefinition[];
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
};

/**
 * Rendered by WorkspaceTabs as its mobile branch. The pill strip collapses into a single
 * button so the header title keeps its width — with 4-6 tabs plus one per
 * enabled plugin, the strip otherwise leaves the title under 150px on a phone.
 *
 * Uses ActionMenu's portal mode on purpose: the header's tab slot is
 * `overflow-hidden`, which would clip an absolutely-positioned menu.
 */
export default function MainContentTabMenu({ tabs, activeTab, setActiveTab }: MainContentTabMenuProps) {
  const { t } = useTranslation();

  const renderIcon = (tab: TabDefinition, isActive: boolean) => (
    tab.kind === 'builtin' ? (
      <tab.icon className="h-3.5 w-3.5" strokeWidth={isActive ? 2.2 : 1.8} />
    ) : (
      <PluginIcon
        pluginName={tab.pluginName}
        iconFile={tab.iconFile}
        className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
      />
    )
  );

  const activeDefinition = tabs.find((tab) => tab.id === activeTab);

  const items: ActionMenuItem[] = tabs.map((tab, index) => ({
    key: tab.id,
    label: tab.kind === 'builtin' ? t(tab.labelKey) : tab.label,
    iconNode: renderIcon(tab, tab.id === activeTab),
    isActive: tab.id === activeTab,
    showDividerBefore: tab.kind === 'plugin' && tabs[index - 1]?.kind === 'builtin',
    onSelect: () => setActiveTab(tab.id),
  }));

  return (
    <ActionMenu
      label={t('mainContent.switchTab', { defaultValue: 'Switch tab' })}
      items={items}
      triggerIcon={activeDefinition ? renderIcon(activeDefinition, true) : undefined}
      iconOnly
      showChevron
      portal
      variant="ghost"
      size="sm"
      className="rounded-lg bg-muted/60 p-[3px]"
      triggerClassName="h-auto gap-1 rounded-md bg-background px-2 py-[5px] text-foreground shadow-sm hover:bg-background [&_svg]:size-3.5"
      menuClassName="max-h-[60vh] overflow-y-auto"
    />
  );
}

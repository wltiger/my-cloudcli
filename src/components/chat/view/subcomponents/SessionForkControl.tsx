import { GitFork } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Per-message entry point for Fork.
 *
 * Deliberately knows nothing about providers: it renders an Anchor the backend
 * already resolved and hands it back on click. Whether the fork keeps or drops
 * the anchored row, and whether the active provider can fork at all, is decided
 * before this ever renders.
 */
const SessionForkControl = ({
  anchor,
  messageType,
  onFork,
}: {
  anchor: string;
  messageType: 'user' | 'assistant';
  onFork: (anchor: string) => void;
}) => {
  const { t } = useTranslation('chat');
  const label = t('fork.action');
  const toneClass = messageType === 'user'
    ? 'text-muted-foreground hover:text-foreground'
    : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300';

  return (
    <button
      type="button"
      onClick={() => onFork(anchor)}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors ${toneClass}`}
    >
      <GitFork className="h-3.5 w-3.5" />
    </button>
  );
};

export default SessionForkControl;

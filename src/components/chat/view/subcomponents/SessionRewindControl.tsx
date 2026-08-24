import { Rewind } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Per-message entry point for Rewind, offered only on the reader's own
 * messages — unlike Fork, which is offered on both sides.
 *
 * Like Fork's control it knows nothing about providers: it renders an Anchor
 * the backend already resolved and hands it back on click. Which transcript row
 * that Anchor names, and whether the active provider can rewind at all, is
 * decided before this ever renders.
 */
const SessionRewindControl = ({
  anchor,
  onRewind,
}: {
  anchor: string;
  onRewind: (anchor: string) => void;
}) => {
  const { t } = useTranslation('chat');
  const label = t('rewind.action');

  return (
    <button
      type="button"
      onClick={() => onRewind(anchor)}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      <Rewind className="h-3.5 w-3.5" />
    </button>
  );
};

export default SessionRewindControl;

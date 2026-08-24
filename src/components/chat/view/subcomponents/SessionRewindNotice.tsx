import { useEffect } from 'react';
import { Rewind, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChatWidthClasses } from '../../hooks/useChatTypography';

/**
 * States what a pending Rewind will do, above the composer it prefilled.
 *
 * Nothing has happened yet while this is on screen — pressing send is what
 * performs the Rewind (ADR 0006), and Esc backs out with the conversation
 * unchanged. The Esc listener lives here rather than in the composer's key
 * handler so the whole gesture stays in one fork-owned file; it is capture
 * phase for the same reason the abort listener is, and a pending Rewind and an
 * in-flight run can never coexist, so the two never compete.
 */
export default function SessionRewindNotice({
  leavingCount,
  restoresFiles,
  onCancel,
}: {
  leavingCount: number;
  /**
   * Whether this provider's Rewind also puts tracked files back. It is settled
   * by the provider rather than chosen here, and it is the one thing the reader
   * has to be told *before* they press send, because it moves their working
   * tree — so it gets a line of its own rather than a clause.
   */
  restoresFiles: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation('chat');
  const widthClasses = useChatWidthClasses();

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [onCancel]);

  return (
    <div className={`settings-content-enter mx-auto mb-2 ${widthClasses.column} rounded-xl rounded-t-none border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2`}>
      <div className="flex items-start gap-2.5">
        <Rewind className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary/70">
            <span>{t('rewind.label')}</span>
            <span className="normal-case text-muted-foreground/60">
              · {t('rewind.escToCancel')}
            </span>
          </div>
          <p className="mt-0.5 break-words text-sm text-foreground/90">
            {t('rewind.leavingContext', { count: leavingCount })}
          </p>
          {restoresFiles && (
            <p className="mt-1 break-words text-sm font-medium text-foreground/90">
              {t('rewind.filesRollBack')}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          aria-label={t('rewind.cancel')}
          title={t('rewind.cancel')}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

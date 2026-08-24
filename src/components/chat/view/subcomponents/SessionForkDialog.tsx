import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';

/**
 * Naming step of Fork. Nothing is created until the reader confirms, so
 * cancelling here leaves both the original session and the sidebar untouched.
 *
 * `suggestedName` is resolved by the backend before this opens, because the
 * frontend only holds the first page of a project's sessions and cannot tell
 * whether a name is already taken.
 */
const SessionForkDialog = ({
  isOpen,
  suggestedName,
  isForking,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  suggestedName: string;
  isForking: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) => {
  const { t } = useTranslation('chat');
  const [name, setName] = useState(suggestedName);

  // Each opening starts from the freshly suggested name, including a second
  // fork of the same session, whose suggestion carries the next sequence number.
  useEffect(() => {
    if (isOpen) {
      setName(suggestedName);
    }
  }, [isOpen, suggestedName]);

  const canConfirm = name.trim().length > 0 && !isForking;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isForking && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-2xl border-border/80 bg-popover p-0 shadow-2xl">
        <DialogTitle>{t('fork.dialogTitle')}</DialogTitle>

        <div className="space-y-3 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('fork.dialogTitle')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('fork.dialogDescription')}</p>
          </div>
          <Input
            autoFocus
            value={name}
            disabled={isForking}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canConfirm) {
                onConfirm(name.trim());
              }
            }}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/20 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isForking} className="rounded-xl">
            {t('fork.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => onConfirm(name.trim())} disabled={!canConfirm} className="rounded-xl">
            {isForking ? t('fork.creating') : t('fork.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SessionForkDialog;

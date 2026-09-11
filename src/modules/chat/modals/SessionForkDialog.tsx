import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';

/**
 * Naming step of Fork, opened once the fork already exists and is on screen.
 *
 * Cancelling is therefore not an undo: it issues no request at all and leaves
 * the fork under the name the backend created it with. That is deliberate — it
 * is what lets this whole dialog be deleted later with no behaviour to unpick.
 *
 * `suggestedName` is resolved by the backend before this opens, because the
 * frontend only holds the first page of a project's sessions and cannot tell
 * whether a name is already taken.
 */
const SessionForkDialog = ({
  isOpen,
  suggestedName,
  isRenaming,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  suggestedName: string;
  isRenaming: boolean;
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

  const canConfirm = name.trim().length > 0 && !isRenaming;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isRenaming && onClose()}>
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
            disabled={isRenaming}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canConfirm) {
                onConfirm(name.trim());
              }
            }}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/20 px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isRenaming} className="rounded-xl">
            {t('fork.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={() => onConfirm(name.trim())} disabled={!canConfirm} className="rounded-xl">
            {isRenaming ? t('fork.renaming') : t('fork.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SessionForkDialog;

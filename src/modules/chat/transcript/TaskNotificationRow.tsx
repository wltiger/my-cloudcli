import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage } from '@/shared/types';
import { cn } from '@/shared/utils';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

/**
 * Dot colour per outcome. A status with no entry — an informational notice, or
 * one a provider reports while the task still runs — keeps the amber the row
 * always used.
 */
const STATUS_DOT_CLASSES: Record<string, string> = {
  completed: 'bg-green-400 dark:bg-green-500',
  failed: 'bg-red-400 dark:bg-red-500',
  cancelled: 'bg-gray-400 dark:bg-gray-500',
};

/**
 * A background-task notice: a status dot and a one-line summary. When the
 * notice carries more than that line — a finished command's output — the row
 * expands to show it.
 *
 * Rendered by chat's MessageComponent for task notifications.
 */
export default function TaskNotificationRow({ message }: { message: ChatMessage }) {
  const summary = String(message.content || '');
  const body = typeof message.taskBody === 'string' ? message.taskBody.trim() : '';
  // A short notice's summary is already its whole body; a chevron that reveals
  // the same line again would only be noise.
  const hasBody = body.length > 0 && body !== summary;
  // A document has no chevron to click, so an export shows the body outright.
  const isExporting = useIsExportingTranscript();
  const [openState, setOpen] = useState(false);
  const open = hasBody && (openState || isExporting);

  const toggle = () => {
    if (hasBody) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div className="w-full">
      <div
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasBody && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={cn(
          'flex items-center gap-2 py-0.5 outline-none',
          hasBody && 'cursor-pointer focus-visible:ring-1 focus-visible:ring-ring',
        )}
      >
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full',
            STATUS_DOT_CLASSES[String(message.taskStatus)] ?? 'bg-amber-400 dark:bg-amber-500',
          )}
        />
        <span className="text-xs text-gray-500 dark:text-gray-400">{summary}</span>
        {hasBody && (
          <ChevronRight
            className={cn(
              'h-3 w-3 flex-shrink-0 text-gray-400 transition-transform duration-200 dark:text-gray-500',
              open && 'rotate-90',
            )}
          />
        )}
      </div>

      {open && (
        <pre className="settings-content-enter ml-3.5 mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border/50 bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {body}
        </pre>
      )}
    </div>
  );
}

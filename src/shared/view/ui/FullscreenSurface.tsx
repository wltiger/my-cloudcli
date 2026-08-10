import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/utils';

interface FullscreenSurfaceProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** Extra classes for the scrollable body. */
  className?: string;
  closeLabel?: string;
  children: React.ReactNode;
}

/**
 * Full-viewport reading surface: a portaled `inset-0` panel with a compact
 * header and a scrollable body. Used by anything in chat that is too cramped
 * to read inline on a phone (long messages, AskUserQuestion panels).
 */
const FullscreenSurface: React.FC<FullscreenSurfaceProps> = ({
  open,
  onClose,
  title,
  className,
  closeLabel = 'Close',
  children,
}) => {
  React.useEffect(() => {
    if (!open) return;

    // Capture phase so Escape closes the surface without also reaching the
    // content's own Escape handling (e.g. AskUserQuestion's "skip all").
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div
        className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <button
          type="button"
          onClick={onClose}
          title={closeLabel}
          aria-label={closeLabel}
          className="-mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className={cn('flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-safe-area-inset-bottom', className)}>
        {children}
      </div>
    </div>,
    document.body
  );
};

interface FullscreenToggleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/** The "expand to fullscreen" affordance that opens a `FullscreenSurface`. */
const FullscreenToggleButton: React.FC<FullscreenToggleButtonProps> = ({ label, className, ...props }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={cn('inline-flex items-center rounded px-1 py-0.5 transition-colors', className)}
    {...props}
  >
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
    </svg>
  </button>
);

export { FullscreenSurface, FullscreenToggleButton };

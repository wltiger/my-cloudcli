import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { useFetchedVoices } from '@/modules/chat';
import { cn } from '@/shared/utils';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

type VoiceComboBoxFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

// A free-typeable text input plus, once a voice list has been fetched, a
// dropdown-arrow trigger that opens a floating menu of every fetched voice.
// Typing never filters or auto-closes the menu — only the arrow, an outside
// click, or Escape do. Replaces a plain <input list=…>+<datalist>, whose
// browser-native suggestion filtering hid options that didn't match
// already-typed text.
export default function VoiceComboBoxField({ label, value, onChange, placeholder }: VoiceComboBoxFieldProps) {
  const voices = useFetchedVoices();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="relative" ref={containerRef}>
        <input
          className={inputClass}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        {voices.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((isOpen) => !isOpen)}
            aria-label={label}
            aria-expanded={open}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        )}
        {open && voices.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
            {voices.map((voice) => (
              <button
                key={voice}
                type="button"
                onClick={() => {
                  onChange(voice);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-accent"
              >
                {voice}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
}

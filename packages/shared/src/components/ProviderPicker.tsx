import { useState, useRef, useEffect } from 'react';

export type ProviderId = 'claude' | 'gemini' | 'codex';

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  installed: boolean;
  enabled: boolean;
  isPrimary: boolean;
  resolvedPath?: string | null;
}

export interface ProviderPickerProps {
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  enabledProviders: ProviderStatus[];
  size?: 'sm' | 'md';
  className?: string;
}

const PROVIDER_BADGES: Record<ProviderId, string> = {
  claude: 'CC',
  gemini: 'G',
  codex: 'CX',
};

export default function ProviderPicker({
  value,
  onChange,
  enabledProviders,
  size = 'sm',
  className = '',
}: ProviderPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const current = enabledProviders.find((p) => p.id === value);
  const currentLabel = current?.displayName ?? value;

  const isSm = size === 'sm';
  const btnPadding = isSm ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800
          text-zinc-100 hover:bg-zinc-700 transition-colors ${btnPadding}`}
      >
        <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1 py-0.5 text-zinc-300">
          {PROVIDER_BADGES[value] ?? value}
        </span>
        <span>{currentLabel}</span>
        <svg
          className={`h-3 w-3 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 min-w-[180px] rounded-md border border-zinc-700
            bg-zinc-800 py-1 shadow-lg"
        >
          {enabledProviders.map((provider) => {
            const isActive = provider.id === value;
            const isDisabled = !provider.installed || !provider.enabled;

            return (
              <button
                key={provider.id}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) {
                    onChange(provider.id);
                    setOpen(false);
                  }
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors
                  ${isDisabled
                    ? 'cursor-not-allowed text-zinc-500'
                    : isActive
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                  }`}
              >
                <span
                  className={`font-mono text-[10px] leading-none rounded px-1 py-0.5
                    ${isDisabled ? 'bg-zinc-800 text-zinc-600' : 'bg-zinc-600 text-zinc-300'}`}
                >
                  {PROVIDER_BADGES[provider.id]}
                </span>
                <span className="flex-1 text-left">{provider.displayName}</span>
                {provider.isPrimary && (
                  <span className="text-[10px] text-amber-400 font-medium">(primary)</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

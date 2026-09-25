import { useState, useRef, useEffect } from 'react';
import type { AccountStatus } from '../lib/launch-flags.js';

export interface AccountPickerProps {
  value: string;
  onChange: (accountId: string) => void;
  accounts: AccountStatus[];
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Picks which credential identity a session launches under.
 *
 * Renders nothing when there is only one account, so a user who has never set
 * up a second login sees the launch dialog exactly as it was before accounts
 * existed. Mirrors ProviderPicker's markup so the two sit together cleanly.
 */
export default function AccountPicker({
  value,
  onChange,
  accounts,
  size = 'sm',
  className = '',
}: AccountPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  if (accounts.length < 2) return null;

  const current = accounts.find((a) => a.id === value) ?? accounts[0];
  const isSm = size === 'sm';
  const btnPadding = isSm ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800
          text-zinc-100 hover:bg-zinc-700 transition-colors ${btnPadding}`}
      >
        <span className="font-mono text-[10px] leading-none rounded bg-zinc-700 px-1 py-0.5 text-zinc-300">
          {(current?.label ?? '?').slice(0, 2).toUpperCase()}
        </span>
        <span>{current?.label ?? value}</span>
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

      {open && (
        <div
          className="absolute left-0 z-50 mt-1 min-w-[200px] rounded-md border border-zinc-700
            bg-zinc-800 py-1 shadow-lg"
        >
          {accounts.map((account) => {
            const isActive = account.id === value;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => {
                  onChange(account.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm transition-colors
                  ${isActive
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                  }`}
              >
                <span className="truncate">{account.label}</span>
                {account.isDefault && (
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">primary</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

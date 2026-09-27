import { Fragment } from 'react';
import { KeyRound, Check, ChevronDown, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DEFAULT_ACCOUNT_ID, getSelectableAccounts } from '@/lib/launch-flags';
import type { ProviderId, ProviderStatus } from '@/lib/launch-flags';

interface SessionAccountMenuProps {
  provider: ProviderId;
  providerStatuses: ProviderStatus[];
  currentAccount?: string;
  onAccountSelect: (accountId: string) => void;
}

/**
 * Switches which credential identity a live session runs under.
 *
 * Unlike the model menu, this cannot be done by typing into the running REPL —
 * the account is chosen by CLAUDE_CONFIG_DIR at spawn time, so selecting one
 * relaunches the CLI with `--resume`. That is safe because session transcripts
 * live in a `projects/` directory shared by every account and carry no account
 * identity, so the conversation continues intact under the new subscription.
 *
 * Local model endpoints (kind 'local') are listed too: switching to one resumes
 * the same conversation on a model server on this machine, and back again.
 *
 * Renders nothing unless there is more than one account to choose from.
 */
export default function SessionAccountMenu({
  provider,
  providerStatuses,
  currentAccount,
  onAccountSelect,
}: SessionAccountMenuProps) {
  const accounts = getSelectableAccounts(provider, providerStatuses);
  if (accounts.length < 2) return null;

  const activeId = currentAccount ?? DEFAULT_ACCOUNT_ID;
  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  const ActiveIcon = active?.kind === 'local' ? Cpu : KeyRound;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Change which account or local model this session runs on"
        >
          <ActiveIcon className="h-4 w-4" />
          <span className="max-w-24 truncate">{active?.label ?? activeId}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Runs on
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.map((account, i) => (
          <Fragment key={account.id}>
            {account.kind === 'local' && accounts[i - 1]?.kind !== 'local' && (
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Local models
              </DropdownMenuLabel>
            )}
            <DropdownMenuItem
              onSelect={() => {
                if (account.id !== activeId) onAccountSelect(account.id);
              }}
              className="gap-2"
            >
              <Check
                className={cn('h-3.5 w-3.5', account.id === activeId ? 'opacity-100' : 'opacity-0')}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate">{account.label}</div>
                {account.kind === 'local' && account.model && (
                  <div className="truncate text-[11px] text-muted-foreground">{account.model}</div>
                )}
              </div>
              {account.isDefault && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  primary
                </span>
              )}
            </DropdownMenuItem>
          </Fragment>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Switching relaunches the CLI and resumes this conversation. Anything
          still running is stopped first. A long conversation may not fit a
          local model's context window.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, Plus, RefreshCw, KeyRound, CheckCircle2, AlertCircle, Wrench } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import TerminalView, { type TerminalViewHandle } from '@/components/sessions/TerminalView';
import { invalidateLaunchFlagsCache } from '@/lib/launch-flags';
import { extractLoginUrl } from '@/lib/login-url';
import LocalModelsSection from './LocalModelsSection';
import { ExternalLink, Copy } from 'lucide-react';
import type { ProviderId, AccountStatus } from '@/lib/launch-flags';

interface LinkReport {
  linked: string[];
  copied: string[];
  skipped: Array<{ entry: string; reason: string }>;
}

interface AccountsResponse {
  supported: boolean;
  primaryHome: string | null;
  accounts: AccountStatus[];
}

const PROVIDER: ProviderId = 'claude';

const inputClass =
  'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground';

/**
 * Admin-only management of the credential identities a provider can launch under.
 *
 * Adding an account creates a second config dir whose skills, agents, plugins and
 * — importantly — `projects/` (all session history) are junctioned back to the
 * primary dir. Only the credentials differ, so a session started under one
 * account can be resumed under the other.
 */
export default function AiAccountsPage() {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Add-form state
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // Login terminal state
  const [loginTerminal, setLoginTerminal] = useState<{ id: string; accountId: string; configDir: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The CLI asks for its OAuth code at a plain prompt inside the terminal.
  // Offering a normal input here means the code never has to survive terminal
  // focus and clipboard handling to get there.
  const terminalRef = useRef<TerminalViewHandle | null>(null);
  const [authCode, setAuthCode] = useState('');
  // The service runs as LocalSystem in session 0, so the CLI cannot actually
  // open a browser in the user's desktop despite announcing that it will. The
  // URL it prints is the only way in, and it is hard-wrapped across rows, so
  // copying it out of the terminal yields a broken link. Recover it instead.
  const loginOutputRef = useRef('');
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load accounts (${res.status})`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  // Stop polling on unmount so a navigated-away login doesn't leak a timer.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /**
   * Poll until the CLI reports the account signed in. The server answers from
   * `claude auth status`, so this works whether credentials land in a file or in
   * Windows Credential Manager, and it returns the signed-in email so the notice
   * can confirm WHICH account was linked.
   */
  const pollUntilAuthenticated = useCallback((accountId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      // Give up after 10 minutes rather than polling forever.
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts/${accountId}`, { credentials: 'include' });
        if (!res.ok) return;
        const acct = await res.json() as AccountStatus;
        if (acct.authenticated) {
          if (pollRef.current) clearInterval(pollRef.current);
          // The launch dialog caches provider status; drop it so the new
          // account shows up in the picker without a page reload.
          invalidateLaunchFlagsCache();
          const who = acct.email ? ` as ${acct.email}` : '';
          const plan = acct.subscriptionType ? ` (${acct.subscriptionType})` : '';
          setNotice(`"${acct.label}" is signed in${who}${plan} and ready to use.`);
          setLoginTerminal(null);
          void fetchAccounts();
        }
      } catch { /* transient — keep polling */ }
    }, 3000);
  }, [fetchAccounts]);

  async function handleAdd() {
    const id = newId.trim().toLowerCase();
    if (!id) return;
    setBusy('add');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, label: newLabel.trim() || id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      const report = body.report as LinkReport;
      setNotice(
        `Created ${body.account.configDir}. Shared: ${report.linked.join(', ') || 'nothing new'}.` +
        (report.skipped.length ? ` Skipped: ${report.skipped.map((s) => `${s.entry} (${s.reason})`).join('; ')}.` : ''),
      );
      setNewId('');
      setNewLabel('');
      await fetchAccounts();
      // Go straight into the login — that is the only remaining step.
      await handleLogin(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleLogin(accountId: string) {
    setBusy(`login:${accountId}`);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts/${accountId}/login`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setAuthCode('');
      loginOutputRef.current = '';
      setLoginUrl(null);
      setCopied(false);
      setLoginTerminal({ id: body.terminalId, accountId, configDir: body.configDir });
      pollUntilAuthenticated(accountId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRepair(accountId: string, resyncFiles: boolean) {
    setBusy(`repair:${accountId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts/${accountId}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resyncFiles }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      const report = body.report as LinkReport;
      setNotice(
        `Relinked: ${report.linked.join(', ') || 'nothing missing'}.` +
        (report.copied.length ? ` Copied: ${report.copied.join(', ')}.` : ''),
      );
      await fetchAccounts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleSetDefault(accountId: string) {
    setBusy(`default:${accountId}`);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts/${accountId}/set-default`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      invalidateLaunchFlagsCache();
      await fetchAccounts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(account: AccountStatus) {
    const ok = window.confirm(
      `Remove "${account.label}"?\n\nThis deletes ${account.configDir} and its saved credentials. ` +
      'Shared skills, agents and session history are junctions and are NOT affected.',
    );
    if (!ok) return;
    setBusy(`delete:${account.id}`);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/providers/${PROVIDER}/accounts/${account.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      invalidateLaunchFlagsCache();
      setNotice(`Removed "${account.label}".`);
      if (loginTerminal?.accountId === account.id) setLoginTerminal(null);
      await fetchAccounts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading accounts…</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> AI Accounts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with more than one Claude account and pick which one a session runs
          under. Skills, agents, plugins and session history are shared between
          accounts — only the subscription being billed changes.
        </p>
        {data?.primaryHome && (
          <p className="mt-2 text-xs font-mono text-muted-foreground">
            Primary config dir: {data.primaryHome}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      {!data?.supported && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Multiple accounts are not supported for this provider yet.
        </div>
      )}

      {/* --- Existing accounts --- */}
      <div className="space-y-2">
        {/* Local model endpoints come back in this list too; they get their own section. */}
        {(data?.accounts ?? []).filter((a) => a.kind !== 'local').map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{account.label}</span>
                {account.isDefault && <Badge variant="secondary">primary</Badge>}
                {account.authenticated ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                    <CheckCircle2 className="h-3 w-3" /> signed in
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                    <AlertCircle className="h-3 w-3" /> not signed in
                  </span>
                )}
              </div>
              {account.email && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {account.email}
                  {account.orgName ? ` · ${account.orgName}` : ''}
                  {account.subscriptionType ? ` · ${account.subscriptionType}` : ''}
                </div>
              )}
              <div className="mt-0.5 truncate text-xs font-mono text-muted-foreground">
                {account.configDir}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!account.isDefault && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === `login:${account.id}`}
                    onClick={() => void handleLogin(account.id)}
                  >
                    <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                    {account.authenticated ? 'Re-login' : 'Sign in'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title="Re-create any missing junctions and re-copy settings.json from the primary dir"
                    disabled={busy === `repair:${account.id}`}
                    onClick={() => void handleRepair(account.id, true)}
                  >
                    <Wrench className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === `delete:${account.id}`}
                    onClick={() => void handleDelete(account)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === `default:${account.id}`}
                onClick={() => void handleSetDefault(account.id)}
                title="Preselect this account in launch dialogs"
              >
                Make default
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* --- Add an account --- */}
      {data?.supported && (
        <div className="rounded-md border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-medium text-foreground">Add an account</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">Id</label>
              <Input
                className={inputClass}
                placeholder="personal"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">Label</label>
              <Input
                className={inputClass}
                placeholder="Personal"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
            </div>
            <Button disabled={!newId.trim() || busy === 'add'} onClick={() => void handleAdd()}>
              {busy === 'add'
                ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                : <Plus className="h-3.5 w-3.5 mr-1.5" />}
              Create &amp; sign in
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers and dashes. The config dir is created next to
            the primary one (e.g. <span className="font-mono">.claude-personal</span>),
            with skills, agents, plugins and session history linked back to it.
          </p>
        </div>
      )}

      {/* --- Login terminal --- */}
      {loginTerminal && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Sign in to &quot;{loginTerminal.accountId}&quot;
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setLoginTerminal(null)}>Close</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Running <span className="font-mono">claude auth login</span> against{' '}
            <span className="font-mono">{loginTerminal.configDir}</span>. SI Hive runs
            as a Windows service and cannot open a browser for you, so use the link
            below, sign in as the account you want, then paste the code it gives you.
            This page detects the sign-in on its own.
          </p>

          {loginUrl ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <a
                href={loginUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open the sign-in page
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(loginUrl)
                    .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
                    .catch(() => setError('Could not copy - select the link and copy it manually.'));
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Use this rather than copying from the terminal: the URL is wrapped
                there, and a wrapped copy fails the sign-in.
              </span>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
              Waiting for the sign-in link...
            </div>
          )}

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const code = authCode.trim();
              if (!code) return;
              // raw: the CLI's code prompt does not enable bracketed-paste mode,
              // so the wrapper would arrive as literal escape bytes.
              const sent = terminalRef.current?.sendInput(code, true, { raw: true });
              if (sent) setAuthCode('');
              else setError('Terminal is not connected — try Sign in again.');
            }}
          >
            <div className="flex-1 min-w-[260px] space-y-1">
              <label className="block text-xs text-muted-foreground">Sign-in code</label>
              <Input
                className={inputClass}
                placeholder="Paste the code from the browser"
                value={authCode}
                autoFocus
                onChange={(e) => setAuthCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!authCode.trim()}>Submit code</Button>
          </form>
          <div className="h-[420px] overflow-hidden rounded-md border border-border">
            <TerminalView
              ref={terminalRef}
              onOutput={(chunk) => {
                // Only the opening banner carries the URL, so cap the buffer.
                if (loginOutputRef.current.length < 20000) {
                  loginOutputRef.current += chunk;
                  if (!loginUrl) {
                    const found = extractLoginUrl(loginOutputRef.current, 100);
                    if (found) setLoginUrl(found);
                  }
                }
              }}
              terminalId={loginTerminal.id}
              cwd={data?.primaryHome ?? undefined}
              provider={PROVIDER}
              account={loginTerminal.accountId}
            />
          </div>
        </div>
      )}

      <div className="border-t border-border pt-6">
        <LocalModelsSection onSetDefault={handleSetDefault} onChanged={() => void fetchAccounts()} />
      </div>
    </div>
  );
}

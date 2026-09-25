import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldCheck, Github, Globe, Building2, KeyRound, UserRound, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, Copy,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { API_BASE } from '@/lib/api-config';
import SchemaForm, { type ConfigField, type SchemaValues } from './SchemaForm';

const ICONS: Record<string, LucideIcon> = { Github, Globe, Building2, KeyRound, UserRound };

interface ProviderType { type: string; displayName: string; icon: string; configSchema: ConfigField[] }
interface ProviderConn { id: string; type: string; label: string; settings: SchemaValues; secrets: Record<string, string>; verifiedAt?: string }
interface Settings {
  enabled: boolean;
  active: boolean;
  disabledByEnv: boolean;
  providers: ProviderConn[];
  allowedDomains: string[];
  allowedEmails: string[];
  callbackBase: string;
  admins: { oid: string; email: string; displayName: string }[];
}
interface LocalAccount { username: string; createdAt: string; role: string }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/**
 * Settings → Authentication. Login is off by default (single user on this
 * machine). Turning it on requires a sign-in method that an admin has
 * already used successfully, so nobody locks themselves out.
 */
export default function AuthenticationTab() {
  const [params] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [types, setTypes] = useState<ProviderType[]>([]);
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [draft, setDraft] = useState<{ id?: string; type: string; label: string; values: SchemaValues } | null>(null);
  const [domains, setDomains] = useState('');
  const [emails, setEmails] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', admin: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    params.get('tested') === '1' ? { ok: true, text: 'Test sign-in succeeded — you are signed in with that provider.' } : null,
  );

  const typeById = useMemo(() => new Map(types.map((t) => [t.type, t])), [types]);
  const hasLocal = settings?.providers.some((p) => p.type === 'local') ?? false;

  async function load() {
    const [s, t] = await Promise.all([api<Settings>('/api/auth/settings'), api<ProviderType[]>('/api/auth/provider-types')]);
    setSettings(s);
    setTypes(t);
    setDomains(s.allowedDomains.join('\n'));
    setEmails(s.allowedEmails.join('\n'));
    if (s.providers.some((p) => p.type === 'local')) setAccounts(await api<LocalAccount[]>('/api/auth/local-accounts'));
  }

  useEffect(() => { load().catch((e) => setMessage({ ok: false, text: (e as Error).message })); }, []);

  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      await load();
      if (success) setMessage({ ok: true, text: success });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function saveDraft() {
    if (!draft) return;
    const schema = typeById.get(draft.type)?.configSchema ?? [];
    const settingsBody: SchemaValues = {};
    const secrets: Record<string, string> = {};
    for (const f of schema) {
      const v = draft.values[f.key] ?? f.default;
      if (f.type === 'secret') { if (typeof v === 'string' && v) secrets[f.key] = v; }
      else if (v !== undefined) settingsBody[f.key] = v;
    }
    const body = JSON.stringify({ type: draft.type, label: draft.label, settings: settingsBody, secrets });
    void run('draft', async () => {
      if (draft.id) await api(`/api/auth/providers/${encodeURIComponent(draft.id)}`, { method: 'PUT', body });
      else await api('/api/auth/providers', { method: 'POST', body });
      setDraft(null);
    }, 'Saved. Use "Test sign-in" to verify it.');
  }

  if (!settings) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Authentication</h1>
        <p className="text-sm text-muted-foreground mt-1">
          By default SI Hive has no login: it only listens on this machine and treats you as its admin.
          Turn login on to let several people use one SI Hive (for example on a shared server).
        </p>
      </div>

      {message && (
        <p className={`flex items-center gap-1.5 text-sm ${message.ok ? 'text-green-500' : 'text-destructive'}`}>
          {message.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{message.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Require sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground">{settings.active ? 'Login is ON' : 'Login is off'}</span>
              <p className="text-xs text-muted-foreground">
                When on, SI Hive listens on all network interfaces and every request needs a signed-in user.
                Recovery: start SI Hive with <code>HIVE_AUTH_DISABLED=1</code>.
              </p>
              {settings.disabledByEnv && <p className="text-xs text-amber-500">HIVE_AUTH_DISABLED=1 is set — login is forced off.</p>}
            </div>
            <Switch
              checked={settings.enabled}
              disabled={busy !== null}
              onCheckedChange={(v) => void run('enable', () => api('/api/auth/settings', { method: 'PUT', body: JSON.stringify({ enabled: v }) }), v ? 'Login is on. Restart SI Hive to accept connections from other machines.' : 'Login is off.')}
            />
          </div>
          {settings.admins.length > 0 && (
            <p className="text-xs text-muted-foreground">Admins: {settings.admins.map((a) => a.email || a.displayName).join(', ')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sign-in methods</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {settings.providers.length === 0 && <p className="text-sm text-muted-foreground">None configured.</p>}
          {settings.providers.map((p) => {
            const t = typeById.get(p.type);
            const Icon = ICONS[t?.icon ?? ''] ?? KeyRound;
            return (
              <div key={p.id} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <span className="font-medium text-foreground">{p.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t?.displayName}</span>
                    {p.type !== 'local' && (p.verifiedAt
                      ? <Badge variant="secondary" className="ml-2 text-[10px]">Verified</Badge>
                      : <Badge variant="destructive" className="ml-2 text-[10px]">Not tested</Badge>)}
                  </div>
                  {p.type !== 'local' && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => { window.location.href = `${API_BASE}/auth/login/${encodeURIComponent(p.id)}?test=1`; }}>Test sign-in</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDraft({ id: p.id, type: p.type, label: p.label, values: { ...p.settings } })}>Edit</Button>
                    </>
                  )}
                  <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => { if (confirm(`Remove ${p.label}?`)) void run(`del-${p.id}`, () => api(`/api/auth/providers/${encodeURIComponent(p.id)}`, { method: 'DELETE' })); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {p.type !== 'local' && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Redirect / callback URL to register with the provider:</span>
                    <code className="bg-secondary px-1.5 py-0.5 rounded">{settings.callbackBase}{p.id}</code>
                    <button aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(`${settings.callbackBase}${p.id}`)}><Copy className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            );
          })}

          {!draft && (
            <div className="flex flex-wrap gap-2 pt-1">
              {types.filter((t) => t.type !== 'local' || !hasLocal).map((t) => {
                const Icon = ICONS[t.icon] ?? KeyRound;
                return (
                  <Button key={t.type} variant="outline" size="sm" onClick={() => {
                    if (t.type === 'local') void run('local', () => api('/api/auth/providers', { method: 'POST', body: JSON.stringify({ type: 'local' }) }), 'Password sign-in enabled — create an admin account below.');
                    else setDraft({ type: t.type, label: t.displayName, values: {} });
                  }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /><Icon className="h-3.5 w-3.5 mr-1" />{t.displayName}
                  </Button>
                );
              })}
            </div>
          )}

          {draft && (
            <div className="rounded-md border border-border p-4 space-y-4">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-foreground">Name on the sign-in button</span>
                <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <SchemaForm
                fields={typeById.get(draft.type)?.configSchema ?? []}
                values={draft.values}
                savedSecrets={draft.id ? settings.providers.find((p) => p.id === draft.id)?.secrets : undefined}
                onChange={(k, v) => setDraft({ ...draft, values: { ...draft.values, [k]: v } })}
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy !== null} onClick={saveDraft}>{busy === 'draft' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who may sign up</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            The first person to sign in becomes admin. After that, new people can sign in only if their email matches below,
            or they're in the admin group configured on the provider.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Allowed domains</span>
              <Textarea rows={4} value={domains} placeholder={'example.com'} onChange={(e) => setDomains(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Allowed emails</span>
              <Textarea rows={4} value={emails} placeholder={'alex@example.org'} onChange={(e) => setEmails(e.target.value)} />
            </label>
          </div>
          <Button size="sm" disabled={busy !== null} onClick={() => void run('allow', () => api('/api/auth/settings', { method: 'PUT', body: JSON.stringify({ allowedDomains: lines(domains), allowedEmails: lines(emails) }) }), 'Saved.')}>Save</Button>
        </CardContent>
      </Card>

      {hasLocal && (
        <Card>
          <CardHeader><CardTitle>Local accounts</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {accounts.map((a) => (
              <div key={a.username} className="flex items-center gap-3 text-sm">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-foreground">{a.username}</span>
                {a.role === 'admin' && <Badge variant="secondary" className="text-[10px]">Admin</Badge>}
                <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => { if (confirm(`Delete ${a.username}?`)) void run(`acct-${a.username}`, () => api(`/api/auth/local-accounts/${encodeURIComponent(a.username)}`, { method: 'DELETE' })); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2 items-end">
              <Input placeholder="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
              <Input type="password" autoComplete="new-password" placeholder="password (10+ chars)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
              <div className="flex items-center gap-2">
                <Switch checked={newUser.admin} onCheckedChange={(v) => setNewUser({ ...newUser, admin: v })} />
                <span className="text-xs text-muted-foreground">Admin</span>
              </div>
            </div>
            <Button size="sm" disabled={busy !== null || !newUser.username || !newUser.password}
              onClick={() => void run('acct', async () => { await api('/api/auth/local-accounts', { method: 'POST', body: JSON.stringify(newUser) }); setNewUser({ username: '', password: '', admin: false }); }, 'Account saved.')}>
              Create / reset password
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Github, Gitlab, GitBranch, Ticket, SquareKanban, Plug, Layers, Plus, Loader2, CheckCircle2, XCircle, Trash2, Pencil, Star,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { API_BASE } from '@/lib/api-config';
import SchemaForm, { type ConfigField, type SchemaValues } from './SchemaForm';

type Kind = 'git' | 'tracker';

interface ProviderInfo {
  id: string;
  displayName: string;
  icon: string;
  kinds: Kind[];
  configSchema: ConfigField[];
}

interface Connection {
  id: string;
  providerId: string;
  providerName: string;
  label: string;
  kinds: Kind[];
  settings: SchemaValues;
  secrets: Record<string, string>;
  defaultTracker?: boolean;
  available: boolean;
}

interface TestResult {
  ok: boolean;
  results?: { kind: string; ok: boolean; user?: string; error?: string }[];
  error?: string;
}

/** Icons referenced by name from provider definitions; unknown names fall back to Plug. */
const ICONS: Record<string, LucideIcon> = { Github, Gitlab, GitBranch, Ticket, SquareKanban, Layers, Plug };

const KIND_LABELS: Record<Kind, string> = { git: 'Code hosting', tracker: 'Ticket tracking' };

interface Draft {
  id?: string;
  providerId: string;
  label: string;
  kinds: Kind[];
  values: SchemaValues;
  defaultTracker: boolean;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

/**
 * Settings → Integrations: connect git hosts and ticket trackers. Every form
 * is generated from the provider's configSchema, so new providers appear here
 * automatically once registered on the server.
 */
export default function IntegrationsTab() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, TestResult>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [p, c] = await Promise.all([
      api<ProviderInfo[]>('/api/integrations/providers'),
      api<Connection[]>('/api/integrations'),
    ]);
    setProviders(p);
    setConnections(c);
  }

  useEffect(() => { load().catch((e) => setError((e as Error).message)); }, []);

  const byId = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const draftProvider = draft ? byId.get(draft.providerId) : undefined;

  function startNew(p: ProviderInfo) {
    setTest({});
    setDraft({ providerId: p.id, label: p.displayName, kinds: p.kinds, values: {}, defaultTracker: !connections.some((c) => c.kinds.includes('tracker')) });
  }

  function startEdit(c: Connection) {
    setTest({});
    setDraft({ id: c.id, providerId: c.providerId, label: c.label, kinds: c.kinds, values: { ...c.settings }, defaultTracker: !!c.defaultTracker });
  }

  function draftBody(d: Draft) {
    const schema = byId.get(d.providerId)?.configSchema ?? [];
    const settings: SchemaValues = {};
    const secrets: Record<string, string> = {};
    for (const f of schema) {
      const v = d.values[f.key] ?? f.default;
      if (f.type === 'secret') { if (typeof v === 'string' && v) secrets[f.key] = v; }
      else if (v !== undefined) settings[f.key] = v;
    }
    return { id: d.id, providerId: d.providerId, label: d.label, kinds: d.kinds, settings, secrets, defaultTracker: d.defaultTracker };
  }

  async function runDraftTest() {
    if (!draft) return;
    setBusy('draft-test');
    try {
      setTest({ draft: await api<TestResult>('/api/integrations/test', { method: 'POST', body: JSON.stringify(draftBody(draft)) }) });
    } catch (e) {
      setTest({ draft: { ok: false, error: (e as Error).message } });
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy('draft-save');
    setError(null);
    try {
      const body = JSON.stringify(draftBody(draft));
      if (draft.id) await api(`/api/integrations/${encodeURIComponent(draft.id)}`, { method: 'PUT', body });
      else await api('/api/integrations', { method: 'POST', body });
      setDraft(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function testSaved(id: string) {
    setBusy(`test-${id}`);
    try {
      const r = await api<TestResult>(`/api/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' });
      setTest((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTest((t) => ({ ...t, [id]: { ok: false, error: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(c: Connection) {
    if (!confirm(`Remove "${c.label}"? Its saved token is deleted too.`)) return;
    await api(`/api/integrations/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    await load();
  }

  const renderTest = (r: TestResult | undefined) => r && (
    <div className="space-y-1 text-sm">
      {r.error && <p className="flex items-center gap-1.5 text-destructive"><XCircle className="h-4 w-4" />{r.error}</p>}
      {r.results?.map((x) => (
        <p key={x.kind} className={`flex items-center gap-1.5 ${x.ok ? 'text-green-500' : 'text-destructive'}`}>
          {x.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {KIND_LABELS[x.kind as Kind] ?? x.kind}: {x.ok ? `connected as ${x.user}` : x.error}
        </p>
      ))}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect where your code lives and where your tickets live. Both are optional — SI Hive works fully without them.
          Tokens are stored encrypted on this machine.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {connections.length === 0 && <p className="text-sm text-muted-foreground">Nothing connected yet.</p>}
          {connections.map((c) => {
            const Icon = ICONS[byId.get(c.providerId)?.icon ?? ''] ?? Plug;
            return (
              <div key={c.id} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{c.label}</span>
                      <span className="text-xs text-muted-foreground">{c.providerName}</span>
                      {c.kinds.map((k) => <Badge key={k} variant="secondary" className="text-[10px]">{KIND_LABELS[k]}</Badge>)}
                      {c.defaultTracker && <Badge className="text-[10px] gap-1"><Star className="h-3 w-3" />Default tracker</Badge>}
                      {!c.available && <Badge variant="destructive" className="text-[10px]">Provider not installed</Badge>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void testSaved(c.id)}>
                    {busy === `test-${c.id}` && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Test
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(c)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove(c)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                </div>
                {renderTest(test[c.id])}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!draft && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" />Add a connection</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {providers.map((p) => {
              const Icon = ICONS[p.icon] ?? Plug;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => startNew(p)}
                  className="flex items-center gap-2 rounded-md border border-border p-3 text-left hover:bg-secondary/60 transition-colors"
                  data-track={`settings.integrations.add.${p.id}`}
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{p.displayName}</div>
                    <div className="text-[11px] text-muted-foreground">{p.kinds.map((k) => KIND_LABELS[k]).join(' + ')}</div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {draft && draftProvider && (
        <Card>
          <CardHeader>
            <CardTitle>{draft.id ? `Edit ${draft.label}` : `Connect ${draftProvider.displayName}`}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">Name</span>
              <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            </label>

            {draftProvider.kinds.length > 1 && (
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Use this connection for</span>
                {draftProvider.kinds.map((k) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{KIND_LABELS[k]}</span>
                    <Switch
                      checked={draft.kinds.includes(k)}
                      onCheckedChange={(on) => setDraft({ ...draft, kinds: on ? [...new Set([...draft.kinds, k])] : draft.kinds.filter((x) => x !== k) })}
                    />
                  </div>
                ))}
              </div>
            )}

            <SchemaForm
              fields={draftProvider.configSchema}
              values={draft.values}
              savedSecrets={draft.id ? connections.find((c) => c.id === draft.id)?.secrets : undefined}
              onChange={(key, value) => setDraft({ ...draft, values: { ...draft.values, [key]: value } })}
            />

            {draft.kinds.includes('tracker') && (
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-foreground">Default tracker</span>
                  <p className="text-xs text-muted-foreground">Used for projects that don't choose a tracker of their own.</p>
                </div>
                <Switch checked={draft.defaultTracker} onCheckedChange={(v) => setDraft({ ...draft, defaultTracker: v })} />
              </div>
            )}

            {renderTest(test.draft)}

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={busy !== null || draft.kinds.length === 0} onClick={() => void runDraftTest()}>
                {busy === 'draft-test' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Test
              </Button>
              <Button size="sm" disabled={busy !== null || draft.kinds.length === 0} onClick={() => void saveDraft()}>
                {busy === 'draft-save' && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

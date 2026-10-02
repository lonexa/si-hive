import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, KeyRound, Plus, PlugZap, Server, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { peerApi, type PeerInfo } from '@/lib/peer-handoff';

interface TokenMeta {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface PeersResponse {
  peers: PeerInfo[];
  tokens: TokenMeta[];
  self: { name: string; url: string | null; publicUrl: string | null };
}

const inputClass = 'h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground';

/**
 * Settings → Peers. Pair this SI Hive with others (e.g. an always-on server)
 * so a session can be sent there with its code and brought back.
 *
 * Pairing is two one-way grants: each Hive issues a token for the other, and
 * the other saves it with this Hive's address.
 */
export default function PeersTab() {
  const [data, setData] = useState<PeersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<{ label: string; token: string } | null>(null);
  const [tokenLabel, setTokenLabel] = useState('');
  const [form, setForm] = useState({ label: '', baseUrl: '', token: '' });
  const [busy, setBusy] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  const load = useCallback(() => {
    peerApi<PeersResponse>('/api/peers')
      .then((d) => { setData(d); setPublicUrl(d.self.publicUrl ?? ''); })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await fn(); load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2"><Server className="h-4 w-4" /> Peer Hives</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hand a session to another SI Hive (say, an always-on server you reach from your phone) and bring it back later.
          The session&apos;s history and its project&apos;s code, including uncommitted and untracked files, move with it.
          Nothing is pushed to your git host.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2 whitespace-pre-wrap">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground flex gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" /> <span>{notice}</span>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">1. Let another Hive connect to this one</h3>
        <p className="text-xs text-muted-foreground">
          Issue a token here, then paste it on the other Hive under &quot;Hives this one can send to&quot;, together with this
          Hive&apos;s address{data?.self.url ? <> (<span className="font-mono">{data.self.url}</span>)</> : ''}. Name the token
          the way you name that Hive below, so sessions it hands back are linked to it.
        </p>
        <div className="flex flex-wrap gap-2">
          <input className={`${inputClass} flex-1 min-w-[12rem]`} placeholder="Who it's for, e.g. Desktop (same name as in step 2)"
            value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} />
          <Button size="sm" disabled={busy || !tokenLabel.trim()} className="gap-1.5" onClick={() => act(async () => {
            const r = await peerApi<{ token: string; meta: TokenMeta }>('/api/peers/tokens', { label: tokenLabel.trim() });
            setNewToken({ label: r.meta.label, token: r.token });
            setTokenLabel('');
          })}>
            <KeyRound className="h-4 w-4" /> Issue token
          </Button>
        </div>
        {newToken && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
            <div>Token for <strong>{newToken.label}</strong>. Copy it now: it won&apos;t be shown again.</div>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded bg-background px-2 py-1 text-xs">{newToken.token}</code>
              <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(newToken.token); setNotice('Token copied.'); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {(data?.tokens.length ?? 0) > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {data!.tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1">{t.label}</span>
                <span className="text-xs text-muted-foreground">
                  issued {new Date(t.createdAt).toLocaleDateString()}
                  {t.lastUsedAt ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}` : ''}
                </span>
                <Button size="sm" variant="ghost" title="Revoke" disabled={busy}
                  onClick={() => act(async () => { await peerApi(`/api/peers/tokens/${t.id}`, undefined, 'DELETE'); })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">2. Hives this one can send to</h3>
        <p className="text-xs text-muted-foreground">
          The other Hive&apos;s address (e.g. its Tailscale name and port) and a token issued there for this Hive.
        </p>
        {(data?.peers.length ?? 0) > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {data!.peers.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <span className="font-medium">{p.label}</span>
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{p.baseUrl}</span>
                {!p.hasToken && <span className="text-xs text-destructive">no token</span>}
                <Button size="sm" variant="ghost" title="Test connection" disabled={busy} onClick={() => act(async () => {
                  const r = await peerApi<{ name: string; version: string }>(`/api/peers/${p.id}/test`, {});
                  setNotice(`${p.label} answered: ${r.name}, SI Hive ${r.version}.`);
                })}>
                  <PlugZap className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" title="Remove" disabled={busy}
                  onClick={() => act(async () => { await peerApi(`/api/peers/${p.id}`, undefined, 'DELETE'); })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
          <input className={inputClass} placeholder="Name, e.g. Home server" value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input className={inputClass} placeholder="Address, e.g. https://server.your-tailnet.ts.net" value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <input className={`${inputClass} sm:col-span-2 font-mono`} placeholder="Token issued by that Hive (hivepeer_…)" value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })} />
        </div>
        <Button size="sm" className="gap-1.5" disabled={busy || !form.label.trim() || !form.baseUrl.trim() || !form.token.trim()}
          onClick={() => act(async () => {
            await peerApi('/api/peers', { label: form.label.trim(), baseUrl: form.baseUrl.trim(), token: form.token.trim() });
            setNotice(`Connected to ${form.label.trim()}.`);
            setForm({ label: '', baseUrl: '', token: '' });
          })}>
          <Plus className="h-4 w-4" /> Add and test
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">This Hive&apos;s address</h3>
        <p className="text-xs text-muted-foreground">
          How peers reach this Hive, so they can link back to it and bring sessions home. Leave empty to use the address
          your browser is on{data?.self.url ? '' : ' (currently localhost, which other machines can\'t use)'}.
        </p>
        <div className="flex gap-2">
          <input className={`${inputClass} flex-1`} placeholder="https://this-machine.your-tailnet.ts.net" value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)} />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(async () => {
            await peerApi('/api/peers/self', { publicUrl: publicUrl.trim() }, 'PUT');
            setNotice('Saved.');
          })}>Save</Button>
        </div>
      </section>
    </div>
  );
}

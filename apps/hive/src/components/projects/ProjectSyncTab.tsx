import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, GitBranch, Loader2, RefreshCw, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { peerApi, type PeerInfo } from '@/lib/peer-handoff';

interface ProjectSide {
  name: string;
  path: string;
  isGit: boolean;
  rootCommit: string | null;
  branch: string | null;
  headSha: string | null;
  originUrl: string | null;
  changes: number;
  lastCommitAt: string | null;
  busy: boolean;
}

type SyncStatus =
  | 'in-sync' | 'only-here' | 'only-there' | 'ahead' | 'behind' | 'diverged'
  | 'changes-here' | 'changes-there' | 'changes-both' | 'not-git' | 'unrelated';

interface SyncRow {
  name: string;
  here?: ProjectSide;
  there?: ProjectSide;
  status: SyncStatus;
  detail: string;
  canSend: boolean;
  canGet: boolean;
}

interface AutoSyncReport {
  at: string;
  actions: string[];
  skipped: string[];
  error?: string;
}

interface CompareResponse {
  peer: PeerInfo & { autoSync: boolean };
  peerName: string;
  rows: SyncRow[];
  autoSync: AutoSyncReport | null;
}

const STATUS_STYLE: Record<SyncStatus, { label: string; tone: 'ok' | 'act' | 'warn' }> = {
  'in-sync': { label: 'In sync', tone: 'ok' },
  'only-here': { label: 'Only here', tone: 'act' },
  'only-there': { label: 'Only there', tone: 'act' },
  ahead: { label: 'Newer here', tone: 'act' },
  behind: { label: 'Newer there', tone: 'act' },
  'changes-here': { label: 'Changes here', tone: 'act' },
  'changes-there': { label: 'Changes there', tone: 'act' },
  'changes-both': { label: 'Changes on both', tone: 'warn' },
  diverged: { label: 'Diverged', tone: 'warn' },
  'not-git': { label: 'Not git', tone: 'warn' },
  unrelated: { label: 'Name clash', tone: 'warn' },
};

const TONE = {
  ok: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  act: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

/**
 * Projects → Sync: every project folder on this machine and a peer Hive side
 * by side, with Send / Get to bring one side up to date — commits, uncommitted
 * and untracked files, as one git transfer. Nothing goes through GitHub.
 */
export default function ProjectSyncTab() {
  const [peers, setPeers] = useState<PeerInfo[] | null>(null);
  const [peerId, setPeerId] = useState('');
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string; canReplace?: boolean }>>({});

  useEffect(() => {
    peerApi<{ peers: PeerInfo[] }>('/api/peers')
      .then((d) => { setPeers(d.peers); if (d.peers[0]) setPeerId(d.peers[0].id); })
      .catch((e: Error) => { setPeers([]); setError(e.message); });
  }, []);

  const load = useCallback(() => {
    if (!peerId) return;
    setLoading(true);
    setError(null);
    peerApi<CompareResponse>(`/api/peer-sync/${peerId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [peerId]);
  useEffect(load, [load]);

  async function act(rowKey: string, fn: () => Promise<{ notes?: string[]; targetRoot?: string }>, done: string) {
    setBusy(rowKey);
    setMessages((m) => { const n = { ...m }; delete n[rowKey]; return n; });
    try {
      const r = await fn();
      setMessages((m) => ({ ...m, [rowKey]: { ok: true, text: [done, ...(r.notes ?? [])].join(' ') } }));
      load();
    } catch (e) {
      const text = (e as Error).message;
      setMessages((m) => ({ ...m, [rowKey]: { ok: false, text, canReplace: /differ from the incoming version/.test(text) } }));
    } finally {
      setBusy(null);
    }
  }

  if (peers === null) return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (peers.length === 0) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground space-y-2 max-w-2xl">
        <div className="flex items-center gap-2 text-foreground font-medium"><Server className="h-4 w-4" /> No other Hive connected</div>
        <p>Pair this SI Hive with another one (say, an always-on server) to keep your projects the same on both machines.</p>
        <Button asChild size="sm" variant="secondary"><Link to="/settings?tab=peers">Settings → Peers</Link></Button>
      </div>
    );
  }

  const peer = data?.peer ?? peers.find((p) => p.id === peerId);
  const counts = (data?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
    const tone = STATUS_STYLE[r.status].tone;
    acc[tone] = (acc[tone] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sync with</span>
          <select value={peerId} onChange={(e) => setPeerId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground">
            {peers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground">
            {counts.ok ?? 0} in sync · {counts.act ?? 0} to sync · {counts.warn ?? 0} need you
          </span>
        )}
        {peer && (
          <label className="ml-auto flex items-center gap-2 text-sm text-foreground"
            title="Every 10 minutes, bring over committed work when one side is simply newer and both sides are clean. Anything else waits for you.">
            <Switch
              checked={!!data?.peer.autoSync}
              onCheckedChange={(v) => {
                peerApi(`/api/peers/${peerId}`, { autoSync: v }, 'PUT').then(load).catch((e: Error) => setError(e.message));
              }}
            />
            Auto-sync safe changes
          </label>
        )}
      </div>

      {data?.autoSync && (
        <div className="text-xs text-muted-foreground">
          Last auto-sync {new Date(data.autoSync.at).toLocaleString()}: {data.autoSync.error
            ? <span className="text-destructive">{data.autoSync.error}</span>
            : data.autoSync.actions.length ? data.autoSync.actions.join('; ') : 'nothing to do'}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex gap-2 whitespace-pre-wrap">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {loading && !data && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Comparing projects with {peer?.label}…</div>}

      {data && (
        <div className="rounded-md border border-border divide-y divide-border">
          <div className="hidden sm:grid grid-cols-[minmax(0,1.3fr)_8rem_minmax(0,2fr)_auto] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Project</span><span>Status</span><span>Details</span><span className="text-right">Action</span>
          </div>
          {data.rows.map((r) => {
            const rowKey = `${r.name}:${r.here?.path ?? ''}:${r.there?.path ?? ''}`;
            const s = STATUS_STYLE[r.status];
            const msg = messages[rowKey];
            const plainHere = r.here && !r.here.isGit;
            const doSend = (replaceDiffering = false) => act(rowKey, () => peerApi(`/api/peer-sync/${peerId}/send`, { path: r.here!.path, replaceDiffering }), `Sent to ${peer?.label}.`);
            const doGet = (replaceDiffering = false) => act(rowKey, () => peerApi(`/api/peer-sync/${peerId}/get`, {
              path: r.there!.path, name: r.there!.name, originUrl: r.there!.originUrl, rootCommit: r.there!.rootCommit, replaceDiffering,
            }), `Updated from ${peer?.label}.`);
            return (
              <div key={rowKey} className="px-3 py-2 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.3fr)_8rem_minmax(0,2fr)_auto] gap-x-3 gap-y-1 items-center">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    {(r.here?.branch || r.there?.branch) && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />{r.here?.branch ?? r.there?.branch}
                        {r.here?.originUrl || r.there?.originUrl ? ' · GitHub' : ' · local'}
                      </div>
                    )}
                  </div>
                  <div><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', TONE[s.tone])}>{s.label}</span></div>
                  <div className="text-xs text-muted-foreground min-w-0">
                    {r.detail}
                    {(r.here?.busy || r.there?.busy) && <span className="text-amber-600 dark:text-amber-400"> · a session is running {r.here?.busy ? 'here' : 'there'}</span>}
                  </div>
                  <div className="flex justify-end gap-1.5">
                    {busy === rowKey && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground self-center" />}
                    {plainHere && (
                      <Button size="sm" variant="secondary" disabled={!!busy}
                        onClick={() => act(rowKey, () => peerApi('/api/peer-sync/init', { path: r.here!.path }), 'Now a local git repository.')}>
                        Make local git
                      </Button>
                    )}
                    {r.canSend && r.here && (
                      <Button size="sm" variant="secondary" disabled={!!busy} className="gap-1"
                        title={`Make ${peer?.label} match this machine`}
                        onClick={() => doSend()}>
                        <ArrowUpFromLine className="h-3.5 w-3.5" /> Send
                      </Button>
                    )}
                    {r.canGet && r.there && (
                      <Button size="sm" variant="secondary" disabled={!!busy} className="gap-1"
                        title={`Make this machine match ${peer?.label}`}
                        onClick={() => doGet()}>
                        <ArrowDownToLine className="h-3.5 w-3.5" /> Get
                      </Button>
                    )}
                  </div>
                </div>
                {msg && (
                  <div className={cn('mt-1 flex gap-1.5 text-xs whitespace-pre-wrap', msg.ok ? 'text-muted-foreground' : 'text-destructive')}>
                    {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                    <span>{msg.text}</span>
                  </div>
                )}
                {msg?.canReplace && (
                  <div className="mt-1 flex justify-end">
                    <Button size="sm" variant="destructive" disabled={!!busy}
                      onClick={() => (r.canSend && r.here ? doSend(true) : doGet(true))}>
                      Replace {r.canSend && r.here ? 'there' : 'here'}, keeping a backup
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

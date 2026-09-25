import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn, timeAgo } from '@/lib/utils';
import { API_BASE } from '@/lib/api-config';

interface NowSession {
  slug: string;
  project: string;
  status: string;
  model?: string;
  lastActivity: string;
}

interface NowRow {
  oid: string;
  displayName: string;
  email: string;
  online: boolean;
  updatedAt: string | null;
  machineName: string | null;
  working: number;
  waiting: number;
  errorCount: number;
  total: number;
  topProject: string | null;
  topStatus: string | null;
  sessions: NowSession[];
  availability: Availability | null;
  manualStatus: string | null;
}

type Availability = 'available' | 'busy' | 'away' | 'dnd';

const AVAILABILITY_META: Record<Availability, { label: string; dot: string; text: string }> = {
  available: { label: 'Available', dot: 'bg-status-green', text: 'text-status-green' },
  busy: { label: 'Busy', dot: 'bg-status-yellow', text: 'text-status-yellow' },
  away: { label: 'Away', dot: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
  dnd: { label: 'Do not disturb', dot: 'bg-status-red', text: 'text-status-red' },
};

const POLL_MS = 20_000;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

export default function NowTab() {
  const [rows, setRows] = useState<NowRow[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [myNote, setMyNote] = useState('');

  const setStatus = useCallback(async (availability: Availability | null, manualStatus: string | null) => {
    try {
      await fetch(`${API_BASE}/api/now/status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability, manualStatus }),
      });
    } catch { /* best-effort */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/now/board`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { board: NowRow[]; warning?: string };
      setRows(data.board || []);
      setWarning(data.warning || null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const h = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(h);
  }, [load]);

  // Online + busy first, then online idle, then offline.
  const sorted = [...rows].sort((a, b) => {
    const score = (r: NowRow) => (r.online ? 2 : 0) + (r.total > 0 ? 1 : 0);
    return score(b) - score(a);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Who's online right now and what their AI sessions are doing. Updates every ~20s; each person's
        SI Hive publishes its own snapshot.
      </p>

      {/* My status */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2">
        <span className="text-xs font-medium text-muted-foreground">My status:</span>
        {(Object.keys(AVAILABILITY_META) as Availability[]).map((a) => (
          <button
            key={a}
            onClick={() => { void setStatus(a, myNote.trim() || null).then(load); }}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-accent flex items-center gap-1.5"
          >
            <span className={cn('h-2 w-2 rounded-full', AVAILABILITY_META[a].dot)} />
            {AVAILABILITY_META[a].label}
          </button>
        ))}
        <input
          value={myNote}
          onChange={(e) => setMyNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void setStatus('available', myNote.trim() || null).then(load); }}
          placeholder="Optional note (e.g. in a meeting until 3pm)"
          className="flex-1 min-w-[12rem] h-7 px-2 text-xs rounded border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
        <button
          onClick={() => { setMyNote(''); void setStatus(null, null).then(load); }}
          className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>

      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      {warning && <Card className="p-3 text-sm text-amber-500 border-amber-500/40">{warning}</Card>}
      {loaded && rows.length === 0 && !warning && (
        <div className="text-sm text-muted-foreground">No users found yet.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {sorted.map((r) => (
          <Card key={r.oid} className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">
                  {initials(r.displayName)}
                </div>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-card',
                    r.availability ? AVAILABILITY_META[r.availability].dot : r.online ? 'bg-status-green' : 'bg-muted-foreground/40',
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{r.displayName}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {r.availability ? (
                    <span className={AVAILABILITY_META[r.availability].text}>{AVAILABILITY_META[r.availability].label}</span>
                  ) : (
                    r.online ? 'Online' : 'Offline'
                  )}
                  {r.machineName ? ` · ${r.machineName}` : ''}
                  {r.updatedAt ? ` · ${timeAgo(r.updatedAt)}` : ''}
                </div>
              </div>
            </div>

            {r.manualStatus && (
              <div className="text-xs text-foreground/80 italic truncate" title={r.manualStatus}>“{r.manualStatus}”</div>
            )}

            {r.total > 0 ? (
              <>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {r.working > 0 && <Badge variant="outline" className="text-[10px] text-status-green border-status-green/40">{r.working} working</Badge>}
                  {r.waiting > 0 && <Badge variant="outline" className="text-[10px] text-status-yellow border-status-yellow/40">{r.waiting} waiting</Badge>}
                  {r.errorCount > 0 && <Badge variant="outline" className="text-[10px] text-status-red border-status-red/40">{r.errorCount} error</Badge>}
                </div>
                {r.topProject && (
                  <div className="text-xs text-muted-foreground truncate">
                    Active: <span className="text-foreground">{r.topProject}</span>
                    {r.topStatus ? ` (${r.topStatus})` : ''}
                  </div>
                )}
                {r.sessions.length > 0 && (
                  <div className="space-y-0.5 pt-0.5">
                    {r.sessions.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="truncate flex-1">{s.project}</span>
                        <span className="shrink-0">{s.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground italic">No active sessions</div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

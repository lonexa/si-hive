import { useCallback, useEffect, useState } from 'react';
import { Card } from '@hive/shared/components/ui/card';
import { Badge } from '@hive/shared/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';

interface ByUser {
  user: string; displayName: string; sessions: number; messages: number; toolUses: number;
  activeSeconds: number; tokens: number; projects: number; models: string[]; lastActiveAt: string;
}
interface ByProject {
  project: string; sessions: number; users: number; activeSeconds: number; messages: number; tokens: number; lastActiveAt: string;
}
interface ByModel { model: string; sessions: number; tokens: number }
interface Daily { day: string; sessions: number; users: number; activeSeconds: number }

interface TeamUsage {
  byUser: ByUser[];
  byProject: ByProject[];
  byModel: ByModel[];
  daily: Daily[];
  summary: { totalSessions: number; activeUsers: number; totalActiveSeconds: number; totalMessages: number; totalTokens: number };
  days: number;
  warning?: string;
}

const RANGES = [7, 30, 90];

function fmtHours(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function projectName(p: string): string {
  if (!p || p === '(unknown)') return '(unknown)';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function shortModel(m: string): string {
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export default function AiUsageTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TeamUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/team/ai-usage?days=${days}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as TeamUsage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.sessions) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Team AI Usage</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Claude sessions, messages, and active time per teammate and project. Usage only — no cost.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`text-xs px-2.5 py-1 rounded border ${days === r ? 'border-foreground/60 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      {data?.warning && (
        <Card className="p-3 text-sm text-amber-500 border-amber-500/40">{data.warning}</Card>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      )}

      {data && !data.warning && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat label="Active users" value={data.summary.activeUsers} />
            <Stat label="Sessions" value={data.summary.totalSessions.toLocaleString()} />
            <Stat label="Active time" value={fmtHours(data.summary.totalActiveSeconds)} />
            <Stat label="Messages" value={data.summary.totalMessages.toLocaleString()} />
            <Stat label="Tokens" value={fmtTokens(data.summary.totalTokens)} />
          </div>

          {/* Daily trend */}
          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Daily sessions</div>
            <div className="flex items-end gap-0.5 h-24">
              {data.daily.length === 0 && <div className="text-xs text-muted-foreground">No activity.</div>}
              {data.daily.map((d) => (
                <div key={d.day} className="flex-1 group relative" title={`${d.day}: ${d.sessions} sessions, ${d.users} users, ${fmtHours(d.activeSeconds)}`}>
                  <div className="bg-primary/70 rounded-t" style={{ height: `${Math.max(2, (d.sessions / maxDaily) * 96)}px` }} />
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Per-user */}
            <Card className="p-3 lg:col-span-2">
              <div className="text-xs font-medium text-muted-foreground mb-2">By teammate</div>
              <div className="divide-y divide-border">
                <div className="flex items-center gap-2 pb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span className="flex-1">User</span>
                  <span className="w-12 text-right">Sess</span>
                  <span className="w-14 text-right">Active</span>
                  <span className="w-14 text-right">Msgs</span>
                  <span className="w-14 text-right">Tokens</span>
                </div>
                {data.byUser.length === 0 && <div className="text-xs text-muted-foreground py-2">No usage data.</div>}
                {data.byUser.map((u) => (
                  <div key={u.user} className="flex items-center gap-2 py-1.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{u.displayName}</div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {u.models.map((m) => (
                          <Badge key={m} variant="outline" className="text-[9px] px-1 py-0">{shortModel(m)}</Badge>
                        ))}
                      </div>
                    </div>
                    <span className="w-12 text-right tabular-nums">{u.sessions}</span>
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{fmtHours(u.activeSeconds)}</span>
                    <span className="w-14 text-right tabular-nums text-muted-foreground">{u.messages.toLocaleString()}</span>
                    <span className="w-14 text-right tabular-nums">{fmtTokens(u.tokens)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Per-project + per-model */}
            <div className="space-y-3">
              <Card className="p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">Top projects</div>
                <div className="space-y-1.5">
                  {data.byProject.length === 0 && <div className="text-xs text-muted-foreground">No data.</div>}
                  {data.byProject.slice(0, 12).map((p) => (
                    <div key={p.project} className="flex items-center gap-2 text-sm" title={p.project}>
                      <span className="flex-1 truncate font-mono text-xs">{projectName(p.project)}</span>
                      <span className="text-muted-foreground text-xs">{p.users}u</span>
                      <span className="w-12 text-right tabular-nums">{p.sessions}</span>
                      <span className="w-12 text-right text-muted-foreground text-xs">{fmtHours(p.activeSeconds)}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-3">
                <div className="text-xs font-medium text-muted-foreground mb-2">Models</div>
                <div className="space-y-1.5">
                  {data.byModel.length === 0 && <div className="text-xs text-muted-foreground">No data.</div>}
                  {data.byModel.map((m) => (
                    <div key={m.model} className="flex items-center justify-between text-sm">
                      <span className="truncate font-mono text-xs">{shortModel(m.model)}</span>
                      <span className="text-muted-foreground text-xs">{m.sessions} sess · {fmtTokens(m.tokens)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </Card>
  );
}

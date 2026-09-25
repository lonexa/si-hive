import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { API_BASE } from '@/lib/api-config';
import { findNavItem } from '@/components/layout/nav-config';
import { LogIn, MousePointerClick, Moon, Sparkles, Clock } from 'lucide-react';

const RANGES = [7, 30, 90];

// ── Shared formatters ─────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '0m';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtMinutes(min: number): string {
  return fmtDuration((min || 0) * 60);
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n || 0}`;
}
function fmtUSD(n: number): string {
  if (!n) return '$0.00';
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}
function fmtTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function routeLabel(route: string): string {
  if (!route || route === '(unknown)') return 'Unknown page';
  const item = findNavItem(route);
  if (item) return item.label;
  // Fall back to a prettified last path segment.
  const seg = route.split('/').filter(Boolean).pop() || route;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Page shell ────────────────────────────────────────────────────────

export default function UsagePage() {
  const [days, setDays] = useState(30);

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">SI Hive Usage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Who used SI Hive, what they did, and what it cost.
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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">User Activity</TabsTrigger>
          <TabsTrigger value="projects">Projects &amp; AI</TabsTrigger>
          <TabsTrigger value="adoption">Feature Adoption</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab days={days} /></TabsContent>
        <TabsContent value="activity"><ActivityTab days={days} /></TabsContent>
        <TabsContent value="projects"><ProjectsTab days={days} /></TabsContent>
        <TabsContent value="adoption"><AdoptionTab days={days} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Generic fetch hook ────────────────────────────────────────────────

function useApi<T>(path: string, enabled = true): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}${path}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, enabled]);
  return { data, loading, error };
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function Warn({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <Card className="p-3 text-sm text-amber-500 border-amber-500/40">{msg}</Card>;
}

// ── Tab: Overview ─────────────────────────────────────────────────────

interface OverviewData {
  summary: { activeUsers: number; totalEvents: number; totalActiveMinutes: number; aiSessions: number; totalTokens: number; estCostUSD: number };
  daily: Array<{ day: string; events: number; users: number }>;
  topProjects: Array<{ project: string; sessions: number; users: number; tokens: number; estCostUSD: number; lastActiveAt: string }>;
  byModel: Array<{ model: string; sessions: number; tokens: number; estCostUSD: number }>;
  topUsers: UsageUser[];
  days: number;
  warning?: string;
}

function OverviewTab({ days }: { days: number }) {
  const { data, loading, error } = useApi<OverviewData>(`/api/admin/usage/overview?days=${days}`);
  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.events) ?? [1]));

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      <Warn msg={data?.warning} />
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Stat label="Active users" value={data.summary.activeUsers} />
            <Stat label="Active time" value={fmtMinutes(data.summary.totalActiveMinutes)} hint="estimated" />
            <Stat label="UI events" value={data.summary.totalEvents.toLocaleString()} />
            <Stat label="AI sessions" value={data.summary.aiSessions.toLocaleString()} />
            <Stat label="Tokens" value={fmtTokens(data.summary.totalTokens)} />
            <Stat label="Est. cost" value={fmtUSD(data.summary.estCostUSD)} hint="estimated" />
          </div>

          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Daily UI activity</div>
            <div className="flex items-end gap-0.5 h-24">
              {data.daily.length === 0 && <div className="text-xs text-muted-foreground">No activity.</div>}
              {data.daily.map((d) => (
                <div key={d.day} className="flex-1 group relative" title={`${d.day}: ${d.events} events, ${d.users} users`}>
                  <div className="bg-primary/70 rounded-t" style={{ height: `${Math.max(2, (d.events / maxDaily) * 96)}px` }} />
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Most active users</div>
              <div className="divide-y divide-border">
                {data.topUsers.length === 0 && <div className="text-xs text-muted-foreground">No usage data.</div>}
                {data.topUsers.map((u) => (
                  <div key={u.oid} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate">{u.displayName}</span>
                    <span className="w-16 text-right text-muted-foreground text-xs">{fmtMinutes(u.activeMinutes)}</span>
                    <span className="w-16 text-right text-muted-foreground text-xs">{u.events.toLocaleString()} ev</span>
                    <span className="w-16 text-right font-medium text-xs">{fmtUSD(u.estCostUSD)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Top projects (Claude)</div>
              <div className="divide-y divide-border">
                {data.topProjects.length === 0 && <div className="text-xs text-muted-foreground">No AI usage data.</div>}
                {data.topProjects.slice(0, 10).map((p) => (
                  <div key={p.project} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate font-mono text-xs">{p.project}</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{p.sessions} ses</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{fmtTokens(p.tokens)}</span>
                    <span className="w-16 text-right font-medium text-xs">{fmtUSD(p.estCostUSD)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: User Activity (the daily journal) ────────────────────────────

interface UsageUser {
  oid: string; displayName: string; email: string; lastLogin: string; loginCount: number;
  activeDays: number; events: number; activeMinutes: number; features: number;
  aiSessions: number; tokens: number; estCostUSD: number; lastActiveAt: string;
}

type TimelineStep =
  | { kind: 'login'; at: string }
  | { kind: 'visit'; at: string; route: string; durationSec: number; events: number }
  | { kind: 'idle'; at: string; durationSec: number }
  | { kind: 'ai'; at: string; project: string; model: string; tokens: number; estCostUSD: number; messages: number; durationSec: number };

interface TimelineData {
  oid: string; date: string; displayName: string; email: string;
  summary: { firstAt: string; lastAt: string; activeMinutes: number; pagesVisited: number; topRoute: string; aiSessions: number; tokens: number; estCostUSD: number };
  steps: TimelineStep[];
  warning?: string;
}

function ActivityTab({ days }: { days: number }) {
  const { data: usersResp } = useApi<{ users: UsageUser[]; warning?: string }>(`/api/admin/usage/users?days=${days}`);
  const users = useMemo(() => usersResp?.users ?? [], [usersResp]);
  const [oid, setOid] = useState('');
  const [date, setDate] = useState(todayLocal());

  // Default to the most active user once the list loads.
  useEffect(() => {
    if (!oid && users.length > 0) setOid(users[0].oid);
  }, [users, oid]);

  const enabled = Boolean(oid && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const { data: timeline, loading, error } = useApi<TimelineData>(`/api/admin/usage/timeline?oid=${encodeURIComponent(oid)}&date=${date}`, enabled);

  return (
    <div className="space-y-3">
      <Warn msg={usersResp?.warning} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={oid}
          onChange={(e) => setOid(e.target.value)}
          className="text-sm bg-background border border-border rounded px-2 py-1.5 min-w-[200px]"
        >
          {users.length === 0 && <option value="">No users with activity</option>}
          {users.map((u) => (
            <option key={u.oid} value={u.oid}>{u.displayName}</option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          max={todayLocal()}
          onChange={(e) => setDate(e.target.value)}
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
        />
      </div>

      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      <Warn msg={timeline?.warning} />

      {timeline && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Stat label="First seen" value={fmtTime(timeline.summary.firstAt) || '—'} />
            <Stat label="Last seen" value={fmtTime(timeline.summary.lastAt) || '—'} />
            <Stat label="Active time" value={fmtMinutes(timeline.summary.activeMinutes)} hint="estimated" />
            <Stat label="Pages" value={timeline.summary.pagesVisited} hint={timeline.summary.topRoute ? `top: ${routeLabel(timeline.summary.topRoute)}` : undefined} />
            <Stat label="AI sessions" value={timeline.summary.aiSessions} hint={fmtTokens(timeline.summary.tokens)} />
            <Stat label="Est. cost" value={fmtUSD(timeline.summary.estCostUSD)} hint="estimated" />
          </div>

          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-3">
              {timeline.displayName} — {new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            {timeline.steps.length === 0 && <div className="text-xs text-muted-foreground">No activity recorded this day.</div>}
            <div className="space-y-0">
              {timeline.steps.map((s, i) => <TimelineRow key={i} step={s} />)}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function TimelineRow({ step }: { step: TimelineStep }) {
  const time = fmtTime(step.at);
  let icon = <MousePointerClick className="w-3.5 h-3.5" />;
  let tone = 'text-muted-foreground';
  let body: React.ReactNode = null;

  switch (step.kind) {
    case 'login':
      icon = <LogIn className="w-3.5 h-3.5" />;
      tone = 'text-emerald-500';
      body = <span className="font-medium text-foreground">Logged in</span>;
      break;
    case 'visit':
      tone = 'text-sky-500';
      body = (
        <span>
          <span className="text-foreground font-medium">{routeLabel(step.route)}</span>
          <span className="text-muted-foreground"> — {fmtDuration(step.durationSec)}{step.events > 1 ? ` · ${step.events} actions` : ''}</span>
        </span>
      );
      break;
    case 'idle':
      icon = <Moon className="w-3.5 h-3.5" />;
      tone = 'text-muted-foreground/60';
      body = <span className="text-muted-foreground italic">Idle {fmtDuration(step.durationSec)}</span>;
      break;
    case 'ai':
      icon = <Sparkles className="w-3.5 h-3.5" />;
      tone = 'text-violet-500';
      body = (
        <span>
          <span className="text-foreground font-medium">Claude session</span>
          <span className="text-muted-foreground"> in </span>
          <span className="font-mono text-xs">{step.project}</span>
          <span className="text-muted-foreground"> — {fmtTokens(step.tokens)} tok · {fmtUSD(step.estCostUSD)}{step.messages ? ` · ${step.messages} msgs` : ''}</span>
        </span>
      );
      break;
  }

  return (
    <div className="flex items-start gap-2.5 py-1.5 border-l border-border pl-3 ml-1 relative">
      <span className={`absolute -left-[5px] top-2.5 w-2 h-2 rounded-full bg-current ${tone}`} />
      <span className="w-12 shrink-0 text-[11px] tabular-nums text-muted-foreground pt-0.5">{time}</span>
      <span className={`shrink-0 pt-0.5 ${tone}`}>{icon}</span>
      <span className="text-sm leading-relaxed">{body}</span>
    </div>
  );
}

// ── Tab: Projects & AI ────────────────────────────────────────────────

function ProjectsTab({ days }: { days: number }) {
  const { data, loading, error } = useApi<OverviewData>(`/api/admin/usage/overview?days=${days}`);
  const { data: usersResp } = useApi<{ users: UsageUser[]; warning?: string }>(`/api/admin/usage/users?days=${days}`);
  const aiUsers = useMemo(
    () => (usersResp?.users ?? []).filter((u) => u.aiSessions > 0).sort((a, b) => b.tokens - a.tokens),
    [usersResp],
  );

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      <Warn msg={data?.warning} />
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Clock className="w-3 h-3" /> Cost is <span className="font-medium">estimated</span> from token counts × model pricing.
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">By project</div>
            <div className="divide-y divide-border">
              {data.topProjects.length === 0 && <div className="text-xs text-muted-foreground">No AI usage data.</div>}
              {data.topProjects.map((p) => (
                <div key={p.project} className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="flex-1 truncate font-mono text-xs" title={p.project}>{p.project}</span>
                  <span className="w-12 text-right text-muted-foreground text-xs">{p.users}u</span>
                  <span className="w-14 text-right text-muted-foreground text-xs">{p.sessions} ses</span>
                  <span className="w-14 text-right text-muted-foreground text-xs">{fmtTokens(p.tokens)}</span>
                  <span className="w-16 text-right font-medium text-xs">{fmtUSD(p.estCostUSD)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-3">
            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">By user</div>
              <div className="divide-y divide-border">
                {aiUsers.length === 0 && <div className="text-xs text-muted-foreground">No AI usage data.</div>}
                {aiUsers.map((u) => (
                  <div key={u.oid} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate">{u.displayName}</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{u.aiSessions} ses</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{fmtTokens(u.tokens)}</span>
                    <span className="w-16 text-right font-medium text-xs">{fmtUSD(u.estCostUSD)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">By model</div>
              <div className="divide-y divide-border">
                {data.byModel.length === 0 && <div className="text-xs text-muted-foreground">No AI usage data.</div>}
                {data.byModel.map((m) => (
                  <div key={m.model} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate font-mono text-xs">{m.model}</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{m.sessions} ses</span>
                    <span className="w-14 text-right text-muted-foreground text-xs">{fmtTokens(m.tokens)}</span>
                    <span className="w-16 text-right font-medium text-xs">{fmtUSD(m.estCostUSD)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Feature Adoption (the original view) ─────────────────────────

interface Adoption {
  topFeatures: Array<{ name: string; category: string; total: number; users: number; lastAt: string }>;
  byCategory: Array<{ category: string; total: number; users: number }>;
  daily: Array<{ day: string; total: number; users: number }>;
  activeUsers: number;
  totalEvents: number;
  days: number;
  warning?: string;
}

function AdoptionTab({ days }: { days: number }) {
  const { data, loading, error } = useApi<Adoption>(`/api/admin/adoption?days=${days}`);
  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.total) ?? [1]));

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-destructive">Failed to load: {error}</div>}
      <Warn msg={data?.warning} />
      {loading && !data && <div className="text-sm text-muted-foreground">Loading…</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Active users" value={data.activeUsers} />
            <Stat label="Total events" value={data.totalEvents.toLocaleString()} />
            <Stat label="Distinct features" value={data.topFeatures.length} />
            <Stat label="Window" value={`${data.days} days`} />
          </div>

          <Card className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Daily events</div>
            <div className="flex items-end gap-0.5 h-24">
              {data.daily.length === 0 && <div className="text-xs text-muted-foreground">No activity.</div>}
              {data.daily.map((d) => (
                <div key={d.day} className="flex-1 group relative" title={`${d.day}: ${d.total} events, ${d.users} users`}>
                  <div className="bg-primary/70 rounded-t" style={{ height: `${Math.max(2, (d.total / maxDaily) * 96)}px` }} />
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-3 md:col-span-2">
              <div className="text-xs font-medium text-muted-foreground mb-2">Top features</div>
              <div className="divide-y divide-border">
                {data.topFeatures.length === 0 && <div className="text-xs text-muted-foreground">No usage data.</div>}
                {data.topFeatures.map((f) => (
                  <div key={`${f.category}:${f.name}`} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="flex-1 truncate font-mono text-xs">{f.name}</span>
                    <Badge variant="outline" className="text-[10px]">{f.category}</Badge>
                    <span className="w-16 text-right text-muted-foreground">{f.users} usr</span>
                    <span className="w-20 text-right font-medium">{f.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">By category</div>
              <div className="space-y-1.5">
                {data.byCategory.map((c) => (
                  <div key={c.category} className="flex items-center justify-between text-sm">
                    <Badge variant="outline" className="text-[10px]">{c.category}</Badge>
                    <span className="text-muted-foreground text-xs">{c.users} usr</span>
                    <span className="font-medium">{c.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

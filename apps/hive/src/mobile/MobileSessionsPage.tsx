import { lazy, Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Monitor, Search, X } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Chip, ChipRow, Compat, Segmented, EmptyState, RowGroup, SectionTitle, SessionRow } from './components';
import { compareSessions, isListedSession, needsAttention, usePendingSpawn } from './mobile-data';
import DeleteSessionButton from '@/components/sessions/DeleteSessionButton';
import { getSessionDisplayName } from '@/lib/utils';

const TemplatesTab = lazy(() => import('@/components/sessions/TemplatesTab'));
const PromptsTab = lazy(() => import('@/components/sessions/PromptsTab'));
const ReplayTab = lazy(() => import('@/components/sessions/ReplayTab'));
const HistoryPage = lazy(() => import('@/components/insights/HistoryPage'));

const TABS = [
  { value: 'list', label: 'Sessions' },
  { value: 'templates', label: 'Templates' },
  { value: 'prompts', label: 'Prompts' },
  { value: 'history', label: 'History' },
  { value: 'replay', label: 'Replay' },
] as const;

type StatusFilter = 'all' | 'attention' | 'working';
type TimeFilter = '1h' | '24h' | 'all';

const TIME_LABELS: Record<TimeFilter, string> = { '1h': 'Last hour', '24h': 'Last 24h', all: 'Any time' };
const TIME_MS: Record<TimeFilter, number> = { '1h': 3600_000, '24h': 86_400_000, all: Infinity };

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

function SessionList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions, sessionActivities, teams, sessionsTimeFilter, setSessionsTimeFilter } = useDashboardStore();
  const [query, setQuery] = useState('');
  const statusFilter = (searchParams.get('filter') as StatusFilter | null) ?? 'all';
  const projectFilter = searchParams.get('project');
  // A project filter wants the full history of that project.
  const timeFilter: TimeFilter = projectFilter ? 'all' : sessionsTimeFilter;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const teamMap = useMemo(() => {
    const map = new Map<string, { teamName: string; memberName: string }>();
    for (const team of teams) {
      if (team.leadSessionId) map.set(team.leadSessionId, { teamName: team.name, memberName: 'lead' });
      for (const m of team.members) if (m.agentId) map.set(m.agentId, { teamName: team.name, memberName: m.name });
    }
    return map;
  }, [teams]);

  const { rows, counts } = useMemo(() => {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    const proj = projectFilter ? normPath(projectFilter) : null;
    const subCounts = new Map<string, number>();
    for (const s of sessions) {
      if (s.isSubagent && s.parentSessionId && ['working', 'waiting-input', 'waiting-approval'].includes(s.status)) {
        subCounts.set(s.parentSessionId, (subCounts.get(s.parentSessionId) ?? 0) + 1);
      }
    }
    const base = sessions.filter((s) => {
      if (!isListedSession(s)) return false;
      if (now - new Date(s.lastActivity).getTime() > TIME_MS[timeFilter] && !needsAttention(s)) return false;
      if (proj) {
        const dirs = [s.cwd, s.projectDir, s.project].filter(Boolean).map((d) => normPath(d!));
        if (!dirs.some((d) => d === proj || d.startsWith(proj + '/'))) return false;
      }
      if (q) {
        const hay = [s.initialPrompt, s.latestPrompt, s.project, s.cwd, s.gitBranch, s.slug].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const counts = {
      all: base.length,
      attention: base.filter(needsAttention).length,
      working: base.filter((s) => s.status === 'working').length,
    };
    const filtered = base.filter((s) =>
      statusFilter === 'attention' ? needsAttention(s) : statusFilter === 'working' ? s.status === 'working' : true,
    );
    return { rows: filtered.sort(compareSessions).map((s) => ({ s, subs: subCounts.get(s.id) ?? 0 })), counts };
  }, [sessions, query, projectFilter, timeFilter, statusFilter]);

  // Group rows under simple headings so a long list stays scannable.
  const groups: { title: string; items: typeof rows }[] = [];
  for (const row of rows) {
    const title = needsAttention(row.s) ? 'Needs you' : row.s.status === 'working' ? 'Working' : 'Recent';
    const last = groups[groups.length - 1];
    if (last?.title === title) last.items.push(row);
    else groups.push({ title, items: [row] });
  }

  const filters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: `All ${counts.all}` },
    { value: 'attention', label: `Needs you ${counts.attention}` },
    { value: 'working', label: `Working ${counts.working}` },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions"
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
        </div>
        {!projectFilter && (
          <select
            value={timeFilter}
            onChange={(e) => setSessionsTimeFilter(e.target.value as TimeFilter)}
            className="h-10 shrink-0 rounded-full border border-border bg-card px-3 text-sm text-foreground"
            aria-label="Time range"
          >
            {(Object.keys(TIME_LABELS) as TimeFilter[]).map((t) => <option key={t} value={t}>{TIME_LABELS[t]}</option>)}
          </select>
        )}
      </div>

      {projectFilter && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Project</span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{projectFilter.split(/[\\/]/).pop()}</span>
          <button type="button" onClick={() => setParam('project', null)} aria-label="Clear project filter" className="p-1 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <ChipRow>
        {filters.map((f) => (
          <Chip key={f.value} active={statusFilter === f.value} onClick={() => setParam('filter', f.value === 'all' ? null : f.value)}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      {rows.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title={query ? `No sessions match "${query}"` : 'No sessions here'}
          hint={timeFilter !== 'all' ? 'Try a longer time range.' : undefined}
        />
      ) : (
        groups.map((g, i) => (
          <div key={`${g.title}-${i}`}>
            <SectionTitle>{g.title}</SectionTitle>
            <RowGroup>
              {g.items.map(({ s, subs }) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  activity={sessionActivities[s.id]}
                  teamInfo={teamMap.get(s.id)}
                  subCount={subs}
                  trailing={
                    <DeleteSessionButton
                      sessionId={s.id}
                      label={getSessionDisplayName(s, teamMap.get(s.id), 120)}
                      className="-mr-1 h-9 w-9 shrink-0 text-muted-foreground/60"
                    />
                  }
                />
              ))}
            </RowGroup>
          </div>
        ))
      )}
    </div>
  );
}

export default function MobileSessionsPage() {
  usePendingSpawn();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'list';

  return (
    <div className="space-y-3">
      <Segmented options={TABS} value={tab} onChange={(v) => setSearchParams(v === 'list' ? {} : { tab: v }, { replace: true })} />
      <Suspense fallback={null}>
        {tab === 'list' ? <SessionList /> : (
          <Compat>
            {tab === 'templates' ? <TemplatesTab /> : tab === 'prompts' ? <PromptsTab /> : tab === 'history' ? <HistoryPage /> : <ReplayTab />}
          </Compat>
        )}
      </Suspense>
    </div>
  );
}


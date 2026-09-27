import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, CheckCircle2, History, LayoutGrid, Monitor, Plus, Star, Users } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useAuth } from '@/auth/AuthProvider';
import { API_BASE } from '@/lib/api-config';
import { cn } from '@/lib/utils';
import QuickActions from '@/components/shared/QuickActions';
import { Compat, EmptyState, LinkRow, RowGroup, SectionTitle, SessionRow } from './components';
import { compareSessions, isListedSession, needsAttention } from './mobile-data';

const CalendarTab = lazy(() => import('@/components/dashboard/CalendarTab'));

interface Bookmark {
  sessionId: string;
  label: string;
}

const RECENT_LIMIT = 5;

function Stat({ value, label, tone, href }: { value: number; label: string; tone?: 'warn' | 'live'; href: string }) {
  return (
    <Link
      to={href}
      className={cn(
        'flex flex-1 flex-col rounded-xl border bg-card px-3 py-2 active:bg-accent',
        tone === 'warn' && value > 0 ? 'border-status-yellow/50' : 'border-border',
      )}
    >
      <span className={cn('text-xl font-bold leading-tight', tone === 'warn' && value > 0 ? 'text-status-yellow' : tone === 'live' && value > 0 ? 'text-status-green' : 'text-foreground')}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </Link>
  );
}

export default function MobileHomePage() {
  const [searchParams] = useSearchParams();
  const { sessions, sessionActivities, teams, tasksByTeam } = useDashboardStore();
  const { hasAccess } = useAuth();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/bookmarks`)
      .then((r) => r.json())
      .then((data: Bookmark[]) => setBookmarks(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const { attention, working, recent, today } = useMemo(() => {
    const listed = sessions.filter(isListedSession).sort(compareSessions);
    const dayStart = new Date().setHours(0, 0, 0, 0);
    return {
      today: listed.filter((s) => new Date(s.lastActivity).getTime() >= dayStart).length,
      attention: listed.filter(needsAttention),
      working: listed.filter((s) => s.status === 'working'),
      recent: listed.filter((s) => !needsAttention(s) && s.status !== 'working').slice(0, RECENT_LIMIT),
    };
  }, [sessions]);

  const activeTeams = teams.filter((t) => !t.stale);

  if (searchParams.get('tab') === 'calendar') {
    return (
      <Suspense fallback={null}>
        <Compat>
          <CalendarTab />
        </Compat>
      </Suspense>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <Stat value={attention.length} label="Need you" tone="warn" href="/sessions?filter=attention" />
        <Stat value={working.length} label="Working" tone="live" href="/sessions?filter=working" />
        <Stat value={today} label="Today" href="/sessions" />
      </div>

      <SectionTitle>Needs you</SectionTitle>
      {attention.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-status-green/30 bg-card px-3 py-3 text-sm text-status-green">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> All clear — nothing is waiting on you
        </div>
      ) : (
        <RowGroup className="border-status-yellow/40">
          {attention.map((s) => (
            <div key={s.id}>
              <SessionRow session={s} activity={sessionActivities[s.id]} />
              {s.paneId && (
                <div className="px-3 pb-2 pl-[2.1rem]">
                  <QuickActions paneId={s.paneId} sessionStatus={s.status} terminalApp={s.terminalApp} />
                </div>
              )}
            </div>
          ))}
        </RowGroup>
      )}

      {working.length > 0 && (
        <>
          <SectionTitle>Working now</SectionTitle>
          <RowGroup>
            {working.map((s) => <SessionRow key={s.id} session={s} activity={sessionActivities[s.id]} />)}
          </RowGroup>
        </>
      )}

      {bookmarks.length > 0 && (
        <>
          <SectionTitle>Pinned</SectionTitle>
          <RowGroup>
            {bookmarks.map((bm) => {
              const s = sessions.find((x) => x.id === bm.sessionId);
              return (
                <LinkRow
                  key={bm.sessionId}
                  to={`/sessions/${bm.sessionId}`}
                  icon={Star}
                  label={bm.label || bm.sessionId.slice(0, 8)}
                  detail={s?.status}
                />
              );
            })}
          </RowGroup>
        </>
      )}

      <SectionTitle action={<Link to="/sessions" className="text-xs text-primary">All sessions</Link>}>Recent</SectionTitle>
      {recent.length === 0 && working.length === 0 && attention.length === 0 ? (
        <EmptyState
          icon={Monitor}
          title="No sessions yet"
          hint="Start one from a project to get going."
          action={
            <Link to="/new" className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Plus className="h-4 w-4" /> New session
            </Link>
          }
        />
      ) : recent.length > 0 ? (
        <RowGroup>
          {recent.map((s) => <SessionRow key={s.id} session={s} activity={sessionActivities[s.id]} />)}
        </RowGroup>
      ) : null}

      {teams.length > 0 && (
        <div id="teams">
          <SectionTitle>Teams</SectionTitle>
          <RowGroup>
            {[...activeTeams, ...teams.filter((t) => t.stale)].slice(0, 8).map((team) => {
              const tasks = tasksByTeam[team.name] ?? [];
              const done = tasks.filter((t) => t.status === 'completed').length;
              return (
                <LinkRow
                  key={team.name}
                  to={`/teams/${encodeURIComponent(team.name)}`}
                  icon={Users}
                  label={team.name}
                  detail={`${team.members.length} member${team.members.length === 1 ? '' : 's'}${tasks.length ? ` · ${done}/${tasks.length} tasks` : ''}${team.stale ? ' · finished' : ''}`}
                />
              );
            })}
          </RowGroup>
        </div>
      )}

      <SectionTitle>Shortcuts</SectionTitle>
      <RowGroup>
        <LinkRow to="/dashboard?tab=calendar" icon={CalendarDays} label="Calendar" />
        {hasAccess('sessions') && <LinkRow to="/sessions?tab=history" icon={History} label="Session history" />}
        <LinkRow to="/more" icon={LayoutGrid} label="Everything else" detail="All pages and settings" />
      </RowGroup>
    </div>
  );
}

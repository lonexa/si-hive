import { useLocation, useSearchParams, Link } from 'react-router-dom';
import { BellOff, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardStore } from '@/stores/dashboard-store';
import { timeAgo } from '@/lib/utils';
import NotificationPanel from '@/components/shared/NotificationPanel';
import { NAV_SECTIONS } from './nav-config';

interface Crumb {
  label: string;
  to?: string;
}

/** Title-case a tab slug, e.g. "db-health" -> "Db Health". */
function prettyTab(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Build breadcrumbs from the nav config + current route/tab. */
function useCrumbs(pathname: string, tab: string | null): Crumb[] {
  // Dynamic routes that aren't in the nav config.
  if (pathname.startsWith('/teams/')) {
    return [{ label: 'Team', to: '/team' }, { label: decodeURIComponent(pathname.split('/teams/')[1]) }];
  }
  if (pathname.startsWith('/projects/') && pathname.endsWith('/claude-md')) {
    return [{ label: 'Projects', to: '/projects' }, { label: 'Instructions Editor' }];
  }
  if (pathname.startsWith('/sessions/') && pathname !== '/sessions') {
    return [{ label: 'Sessions', to: '/sessions' }, { label: 'Session Detail' }];
  }

  // Longest-prefix match against nav items.
  let match: { section: string; label: string; to: string } | null = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const isMatch = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(item.to + '/');
      if (isMatch && (!match || item.to.length > match.to.length)) {
        match = { section: section.label ?? 'Home', label: item.label, to: item.to };
      }
    }
  }
  if (!match) return [];

  const crumbs: Crumb[] = [{ label: match.section }, { label: match.label, to: match.to }];
  if (tab) crumbs.push({ label: prettyTab(tab) });
  return crumbs;
}

export default function Header() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { connected, lastUpdated } = useDashboardStore();
  const notificationsGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';

  const crumbs = useCrumbs(location.pathname, searchParams.get('tab'));

  const handleNotificationToggle = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-border">
      <div className="flex items-center gap-3 min-w-0">
        <nav className="flex items-center gap-1.5 min-w-0" aria-label="Breadcrumb">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                {c.to && !isLast ? (
                  <Link to={c.to} className="text-sm text-muted-foreground hover:text-foreground truncate">
                    {c.label}
                  </Link>
                ) : (
                  <span className={isLast ? 'text-lg font-semibold text-foreground truncate' : 'text-sm text-muted-foreground truncate'}>
                    {c.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-status-green' : 'bg-status-red'}`} />
          <span className="text-xs text-muted-foreground">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Updated {timeAgo(lastUpdated)}
          </span>
        )}
        <NotificationPanel />
        {!notificationsGranted && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleNotificationToggle}
            title="Enable notifications"
          >
            <BellOff className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}

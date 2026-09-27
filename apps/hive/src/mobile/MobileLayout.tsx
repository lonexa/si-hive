import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderOpen, Home, LayoutGrid, Monitor, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api-config';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useAuth } from '@/auth/AuthProvider';
import { useActivityTracker } from '@/hooks/useActivityTracker';
import { useNowPublisher } from '@/hooks/useNowPublisher';
import NotificationPanel from '@/components/shared/NotificationPanel';
import MessagesWidget from '@/components/messages/MessagesWidget';
import IncomingBanner from '@/components/messages/IncomingBanner';
import { mobileTitle, isTabRoot, parentRoute } from './mobile-nav';
import { useAttentionCount } from './mobile-data';

const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;

/** Same periodic update check the desktop sidebar runs (drives the Updates dot). */
function useUpdateCheck() {
  const setUpdatesAvailable = useDashboardStore((s) => s.setUpdatesAvailable);
  useEffect(() => {
    const check = () => {
      fetch(`${API_BASE}/api/updates/check`)
        .then((r) => r.json())
        .then((d: { upToDate: boolean }) => setUpdatesAvailable(!d.upToDate))
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [setUpdatesAvailable]);
}

export interface MobileRouteHandle {
  /** Page manages its own height/scrolling (chat): no padding, no outer scroll. */
  fullBleed?: boolean;
}

function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const connected = useDashboardStore((s) => s.connected);
  const tab = new URLSearchParams(location.search).get('tab');
  const showBack = !isTabRoot(location.pathname);
  const title = mobileTitle(location.pathname, tab);

  const goBack = () => {
    // Prefer real history (keeps scroll/filters); fall back when opened directly.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(parentRoute(location.pathname, tab), { replace: true });
  };

  return (
    <header className="shrink-0 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center gap-1 px-1.5">
        {showBack ? (
          <button type="button" onClick={goBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-foreground active:bg-accent">
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{title}</h1>
        <span
          className={cn('mx-1 h-2 w-2 shrink-0 rounded-full', connected ? 'bg-status-green' : 'bg-status-red animate-pulse')}
          title={connected ? 'Live' : 'Offline'}
        />
        <NotificationPanel />
      </div>
    </header>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  const { hasAccess } = useAuth();
  const attention = useAttentionCount();
  const updatesAvailable = useDashboardStore((s) => s.updatesAvailable);

  const items = [
    { to: '/', label: 'Home', icon: Home, active: pathname === '/' || pathname === '/dashboard', badge: attention },
    { to: '/sessions', label: 'Sessions', icon: Monitor, active: pathname.startsWith('/sessions'), feature: 'sessions' },
    { to: '/new', label: 'New', icon: Plus, active: pathname === '/new', primary: true, feature: 'sessions' },
    { to: '/projects', label: 'Projects', icon: FolderOpen, active: pathname.startsWith('/projects'), feature: 'projects' },
    { to: '/more', label: 'More', icon: LayoutGrid, active: false, dot: updatesAvailable },
  ].filter((i) => !i.feature || hasAccess(i.feature));
  const anyActive = items.some((i) => i.active);
  const more = items[items.length - 1];
  if (!anyActive) more.active = true;

  return (
    <nav className="shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14 items-stretch">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              item.active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {item.primary ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                <item.icon className="h-5 w-5" />
              </span>
            ) : (
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {'dot' in item && item.dot && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />}
                {!!item.badge && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-yellow px-1 text-[10px] font-bold text-black">
                    {item.badge}
                  </span>
                )}
              </span>
            )}
            {!item.primary && item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export default function MobileLayout() {
  useActivityTracker();
  useUpdateCheck();
  const { isAuthenticated, hasAccess } = useAuth();
  useNowPublisher(isAuthenticated && hasAccess('team-dashboard'));
  const location = useLocation();
  const matches = useMatches();
  const fullBleed = matches.some((m) => (m.handle as MobileRouteHandle | undefined)?.fullBleed);
  const mainRef = useRef<HTMLElement>(null);

  // The page scrolls inside <main>, so the browser won't reset it on navigation.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname, location.search]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <TopBar />
      <main
        ref={mainRef}
        className={cn('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden overscroll-contain')}
      >
        {fullBleed ? (
          <div className="hive-mobile-page h-full">
            <Outlet />
          </div>
        ) : (
          <div className="hive-mobile-page px-3 pb-6 pt-3">
            <Outlet />
          </div>
        )}
      </main>
      <TabBar />
      <IncomingBanner />
      <div className="mobile-lift">
        <MessagesWidget />
      </div>
    </div>
  );
}

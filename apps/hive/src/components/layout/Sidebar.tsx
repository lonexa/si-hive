import { isTouchDevice } from '@/lib/device';
import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Settings, PanelLeftClose, PanelLeft, Sun, Moon, Plus, Star, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useNavStore } from '@/stores/nav-store';
import { toggleTheme } from '@/hooks/useTheme';
import { API_BASE } from '@/lib/api-config';
import { useAuth } from '@/auth/AuthProvider';
import { NAV_SECTIONS, findNavItem, applyOrder, type NavItem } from './nav-config';

const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function Sidebar() {
  // Start collapsed on phones and narrow screens so the page gets the width.
  const [collapsed, setCollapsed] = useState(() => isTouchDevice() || window.matchMedia('(max-width: 768px)').matches);
  const connected = useDashboardStore((s) => s.connected);
  const sessions = useDashboardStore((s) => s.sessions);
  const theme = useDashboardStore((s) => s.theme);
  const updatesAvailable = useDashboardStore((s) => s.updatesAvailable);
  const setUpdatesAvailable = useDashboardStore((s) => s.setUpdatesAvailable);
  const location = useLocation();
  const { user, hasAccess, logout, authConfigured, setRoleOverride } = useAuth();
  const actualRole = (user as any)?.actualRole as string | undefined;
  const isRealAdmin = user && (actualRole === 'admin' || (!actualRole && user.role === 'admin'));
  const activeOverride = (user as any)?.roleOverride as string | undefined;

  // Navigation preferences (persona / order / hidden / favorites / collapse)
  const load = useNavStore((s) => s.load);
  const hidden = useNavStore((s) => s.hidden);
  const favorites = useNavStore((s) => s.favorites);
  const sectionOrder = useNavStore((s) => s.sectionOrder);
  const itemOrder = useNavStore((s) => s.itemOrder);
  const collapsedSections = useNavStore((s) => s.collapsedSections);
  const toggleSection = useNavStore((s) => s.toggleSection);

  useEffect(() => {
    void load();
  }, [load]);

  const attentionCount = sessions.filter(
    (s) => s.status === 'waiting-input' || s.status === 'waiting-approval' || s.status === 'error'
  ).length;

  const itemVisible = useCallback(
    (item: NavItem) => (!item.feature || hasAccess(item.feature)) && !hidden.includes(item.to),
    [hasAccess, hidden],
  );

  // Apply user ordering, then access + hidden filters.
  const visibleSections = applyOrder(NAV_SECTIONS, sectionOrder, (s) => s.id)
    .map((sec) => ({
      ...sec,
      items: applyOrder(sec.items, itemOrder[sec.id], (i) => i.to).filter(itemVisible),
    }))
    .filter((sec) => sec.items.length > 0);

  const favItems = favorites
    .map((r) => findNavItem(r))
    .filter((i): i is NavItem => !!i && itemVisible(i));

  const checkForUpdates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/updates/check`);
      const data = await res.json() as { upToDate: boolean };
      setUpdatesAvailable(!data.upToDate);
    } catch {
      // silently fail
    }
  }, [setUpdatesAvailable]);

  useEffect(() => {
    void checkForUpdates();
    const interval = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  const renderItem = (item: NavItem) => {
    const isActive = item.end
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to);

    return (
      <Tooltip key={item.to}>
        <TooltipTrigger asChild>
          <Link
            to={item.to}
            data-track={`sidebar.${item.feature}`}
            data-track-category="nav"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              collapsed && 'justify-center px-2'
            )}
          >
            <span className="w-5 flex items-center justify-center shrink-0 relative">
              <item.icon className="h-4 w-4" />
              {item.to === '/dashboard' && attentionCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 flex items-center justify-center rounded-full bg-status-yellow text-[9px] font-bold text-black px-0.5">
                  {attentionCount}
                </span>
              )}
              {item.to === '/updates' && updatesAvailable && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </span>
            {!collapsed && <span>{item.label}</span>}
          </Link>
        </TooltipTrigger>
        {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-sidebar h-dvh transition-all duration-200',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Header */}
        <div className={cn('flex items-center h-14 px-4', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground tracking-tight">SI Hive</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/projects?new=true">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">New Project</TooltipContent>
              </Tooltip>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <Separator />

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 overflow-y-auto">
          {collapsed ? (
            // Icon-only mode: flat list of every visible item, no section headers.
            visibleSections.flatMap((sec) => sec.items).map(renderItem)
          ) : (
            <>
              {/* Favorites (only when the user has pinned something) */}
              {favItems.length > 0 && (
                <div className="mb-1">
                  <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    <Star className="h-3 w-3" /> Favorites
                  </div>
                  <div className="flex flex-col gap-0.5">{favItems.map(renderItem)}</div>
                </div>
              )}

              {visibleSections.map((sec) => {
                // Headerless section (Home) is always shown and never collapses.
                if (sec.label === null) {
                  return (
                    <div key={sec.id} className="flex flex-col gap-0.5 mb-1">
                      {sec.items.map(renderItem)}
                    </div>
                  );
                }
                const isCollapsed = collapsedSections.includes(sec.id);
                return (
                  <div key={sec.id} className="mb-0.5">
                    <button
                      onClick={() => toggleSection(sec.id)}
                      className="w-full flex items-center gap-1 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors"
                    >
                      {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span>{sec.label}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-0.5">{sec.items.map(renderItem)}</div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3">
          <Separator className="mb-3" />
          {/* User info */}
          {authConfigured && user && !collapsed && (
            <div className="mb-2 px-1">
              <div className="text-xs font-medium text-foreground truncate">{user.displayName}</div>
              <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
              {/* Role switcher (admin only) */}
              {isRealAdmin && (
                <div className="mt-1.5">
                  <select
                    value={activeOverride || 'admin'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRoleOverride(val === 'admin' ? null : val as any);
                    }}
                    className="w-full text-[10px] bg-muted border border-border rounded px-1.5 py-0.5 text-foreground"
                  >
                    <option value="admin">View as: Admin</option>
                    <option value="full">View as: Full</option>
                  </select>
                  {activeOverride && (
                    <div className="text-[10px] text-amber-400 mt-0.5">Previewing {activeOverride} role</div>
                  )}
                </div>
              )}
              <button
                onClick={logout}
                data-track="sidebar.sign_out"
                data-track-category="action"
                className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
              >
                Sign out
              </button>
            </div>
          )}
          <div className={cn('flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between')}>
            <div className={cn('flex items-center gap-2', collapsed ? 'justify-center' : '')}>
              <div
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  connected ? 'bg-status-green animate-pulse' : 'bg-status-red'
                )}
              />
              {!collapsed && (
                <span className="text-xs text-muted-foreground">
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              )}
            </div>
            {!collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link to="/settings?tab=navigation">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Customize navigation</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-track="sidebar.toggle_theme"
                  data-track-category="action"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}

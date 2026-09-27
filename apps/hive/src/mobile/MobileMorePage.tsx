import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Monitor, Moon, Star, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { useNavStore } from '@/stores/nav-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { toggleTheme } from '@/hooks/useTheme';
import { switchViewMode } from '@/lib/device';
import { NAV_SECTIONS, applyOrder, findNavItem, type NavItem } from '@/components/layout/nav-config';
import { RowGroup, SectionTitle } from './components';

/** Items the bottom tab bar already covers. */
const IN_TAB_BAR = new Set(['/dashboard', '/sessions', '/projects']);

function Tile({ item, badge }: { item: NavItem; badge?: boolean }) {
  return (
    <Link
      to={item.to}
      className="relative flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-1 py-3 text-center active:bg-accent"
    >
      <item.icon className="h-5 w-5 text-foreground" />
      <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{item.label}</span>
      {badge && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" />}
    </Link>
  );
}

export default function MobileMorePage() {
  const { user, hasAccess, logout, authConfigured } = useAuth();
  const load = useNavStore((s) => s.load);
  const hidden = useNavStore((s) => s.hidden);
  const favorites = useNavStore((s) => s.favorites);
  const sectionOrder = useNavStore((s) => s.sectionOrder);
  const itemOrder = useNavStore((s) => s.itemOrder);
  const theme = useDashboardStore((s) => s.theme);
  const connected = useDashboardStore((s) => s.connected);
  const updatesAvailable = useDashboardStore((s) => s.updatesAvailable);

  useEffect(() => { void load(); }, [load]);

  const visible = (item: NavItem) => (!item.feature || hasAccess(item.feature)) && !hidden.includes(item.to);
  const favItems = favorites.map((r) => findNavItem(r)).filter((i): i is NavItem => !!i && visible(i));
  const sections = applyOrder(NAV_SECTIONS, sectionOrder, (s) => s.id)
    .map((sec) => ({
      ...sec,
      items: applyOrder(sec.items, itemOrder[sec.id], (i) => i.to).filter((i) => visible(i) && !IN_TAB_BAR.has(i.to)),
    }))
    .filter((sec) => sec.items.length > 0);

  return (
    <div>
      {favItems.length > 0 && (
        <>
          <SectionTitle><span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> Favorites</span></SectionTitle>
          <div className="grid grid-cols-4 gap-2">
            {favItems.map((item) => <Tile key={item.to} item={item} />)}
          </div>
        </>
      )}

      {sections.map((sec) => (
        <div key={sec.id}>
          <SectionTitle>{sec.label ?? 'General'}</SectionTitle>
          <div className="grid grid-cols-4 gap-2">
            {sec.items.map((item) => <Tile key={item.to} item={item} badge={item.to === '/updates' && updatesAvailable} />)}
          </div>
        </div>
      ))}

      <SectionTitle>This device</SectionTitle>
      <RowGroup>
        <button type="button" onClick={toggleTheme} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm text-foreground active:bg-accent">
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px] text-muted-foreground" /> : <Moon className="h-[18px] w-[18px] text-muted-foreground" />}
          <span className="flex-1">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <button type="button" onClick={() => switchViewMode('desktop')} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm text-foreground active:bg-accent">
          <Monitor className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="flex-1">Use desktop layout</span>
        </button>
        {authConfigured && user && (
          <button type="button" onClick={logout} className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm text-foreground active:bg-accent">
            <LogOut className="h-[18px] w-[18px] text-muted-foreground" />
            <span className="min-w-0 flex-1">
              Sign out
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </button>
        )}
      </RowGroup>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-status-green' : 'bg-status-red')} />
        {connected ? 'Connected' : 'Disconnected'}
      </p>
    </div>
  );
}

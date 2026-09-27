import { NAV_SECTIONS } from '@/components/layout/nav-config';

/** Routes reached from the bottom tab bar: no back button. */
const TAB_ROOTS = new Set(['/', '/dashboard', '/sessions', '/projects', '/more', '/new']);

/** Pages whose `?tab=` opens a section from a list (back returns to the list). */
export const SECTION_LIST_PAGES = new Set(['/settings', '/ai-studio']);

export function isTabRoot(pathname: string): boolean {
  return TAB_ROOTS.has(pathname);
}

function navLabel(pathname: string): string | null {
  let best: { label: string; len: number } | null = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const hit = pathname === item.to || pathname.startsWith(item.to + '/');
      if (hit && (!best || item.to.length > best.len)) best = { label: item.label, len: item.to.length };
    }
  }
  return best?.label ?? null;
}

function prettyTab(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function mobileTitle(pathname: string, tab: string | null): string {
  if (pathname === '/' || pathname === '/dashboard') return tab === 'calendar' ? 'Calendar' : 'SI Hive';
  if (pathname === '/more') return 'Menu';
  if (pathname === '/new') return 'New session';
  if (pathname.startsWith('/teams/')) return decodeURIComponent(pathname.slice('/teams/'.length));
  if (pathname.endsWith('/claude-md')) return 'Instructions';
  const label = navLabel(pathname) ?? 'SI Hive';
  if (tab && SECTION_LIST_PAGES.has(pathname)) return prettyTab(tab);
  return label;
}

/** Where "back" goes when there is no in-app history (page opened directly). */
export function parentRoute(pathname: string, tab: string | null): string {
  if (tab && SECTION_LIST_PAGES.has(pathname)) return pathname;
  if (pathname.startsWith('/teams/')) return '/';
  if (pathname.startsWith('/projects/')) return '/projects';
  if (pathname.startsWith('/sessions/')) return '/sessions';
  return '/more';
}

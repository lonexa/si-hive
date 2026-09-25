import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { API_BASE } from '@/lib/api-config';
import { trackEvent } from '@/lib/track';

/** Maps route path prefixes to feature keys (same keys used in FEATURE_ROLES) */
const ROUTE_TO_FEATURE: Record<string, string> = {
  '/': 'dashboard',
  '/sessions': 'sessions',
  '/projects': 'projects',
  '/personas': 'personas',
  '/ai-studio': 'ai-studio',
  '/pipelines': 'pipelines',
  '/devops': 'devops',
  '/data': 'data',
  '/analytics': 'analytics',
  '/knowledge': 'knowledge',
  '/gmail': 'gmail',
  '/todo': 'todo',
  '/workflows': 'workflows',
  '/team': 'team-dashboard',
  '/admin/users': 'user-management',
  '/settings': 'settings',
  '/updates': 'updates',
};

function resolveFeature(pathname: string): string | null {
  // Exact match first (for '/')
  if (ROUTE_TO_FEATURE[pathname]) return ROUTE_TO_FEATURE[pathname];
  // Prefix match (longest first)
  for (const [path, feature] of Object.entries(ROUTE_TO_FEATURE)) {
    if (path !== '/' && pathname.startsWith(path)) return feature;
  }
  return null;
}

/**
 * Tracks page/feature visits by reporting to the server.
 * Must be used inside a Router context (needs useLocation).
 */
export function useActivityTracker() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const lastTracked = useRef<{ feature: string; time: number }>({ feature: '', time: 0 });

  useEffect(() => {
    if (!isAuthenticated) return;

    const feature = resolveFeature(location.pathname);
    if (!feature) return;

    // Always log a granular nav.* event — the user_events table is meant for
    // every navigation, even repeat visits.
    trackEvent(`nav.${feature}`, { pathname: location.pathname }, 'nav');

    // Coarse activity rollup is still useful for "Feature Usage (90 days)";
    // keep the 60s client debounce to match the table's 5min server debounce.
    const now = Date.now();
    if (lastTracked.current.feature === feature && now - lastTracked.current.time < 60_000) return;
    lastTracked.current = { feature, time: now };

    fetch(`${API_BASE}/api/activity/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ feature }),
    }).catch(() => {}); // silently ignore failures
  }, [location.pathname, isAuthenticated]);
}

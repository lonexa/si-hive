import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api-config';
import { getPrimaryProviderId, getProviderStatus, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';
import type { ProjectInfo } from '@/components/projects/ProjectsPage';

export type { ProjectInfo };

/** Most recently active first; projects never used go last, by name. */
export function byRecent(a: ProjectInfo, b: ProjectInfo): number {
  if (a.lastActivity && b.lastActivity) return b.lastActivity.localeCompare(a.lastActivity);
  if (a.lastActivity) return -1;
  if (b.lastActivity) return 1;
  return a.name.localeCompare(b.name);
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/api/projects`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ProjectInfo[]) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);
  return { projects, loading, refresh };
}

/** Providers that can launch a session here, plus the user's primary one. */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [primary, setPrimary] = useState<ProviderId>('claude');
  useEffect(() => {
    void Promise.all([getPrimaryProviderId(), getProviderStatus()]).then(([p, statuses]) => {
      setPrimary(p);
      setProviders(statuses.filter((s) => s.enabled && s.installed));
    });
  }, []);
  return { providers, primary };
}

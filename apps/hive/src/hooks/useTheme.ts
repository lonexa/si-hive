import { useEffect } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { API_BASE } from '@/lib/api-config';

export function useTheme() {
  const theme = useDashboardStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('hive-theme', theme);
  }, [theme]);

  return theme;
}

export function toggleTheme() {
  const store = useDashboardStore.getState();
  const next = store.theme === 'dark' ? 'light' : 'dark';
  store.updateAppConfig({ theme: next });

  // Persist to server
  fetch(`${API_BASE}/api/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: next }),
  }).catch(() => {});
}

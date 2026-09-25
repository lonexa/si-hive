import { useEffect, useState } from 'react';
import type { StatsCache, DeveloperInsights } from '@/stores/types';
import UsageStats from './UsageStats';

import { API_BASE } from '@/lib/api-config';

export default function InsightsPage() {
  const [stats, setStats] = useState<StatsCache | null>(null);
  const [devInsights, setDevInsights] = useState<DeveloperInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/insights/stats`).then((r) => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/insights/developer-stats`).then((r) => r.json()).catch(() => null),
    ])
      .then(([statsData, devData]) => {
        setStats(statsData);
        setDevInsights(devData);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading insights...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <UsageStats stats={stats} devInsights={devInsights} />
    </div>
  );
}

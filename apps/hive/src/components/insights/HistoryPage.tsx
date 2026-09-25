import { useEffect, useState } from 'react';
import type { PromptEntry } from '@/stores/types';
import PromptHistory from './PromptHistory';

import { API_BASE } from '@/lib/api-config';

export default function HistoryPage() {
  const [entries, setEntries] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/insights/history`)
      .then((r) => r.json())
      .then(setEntries)
      .catch((err) => { setError(err.message ?? 'Failed to load history'); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-sm text-status-red">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            fetch(`${API_BASE}/api/insights/history`)
              .then((r) => r.json())
              .then(setEntries)
              .catch((err) => setError(err.message ?? 'Failed to load history'))
              .finally(() => setLoading(false));
          }}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">No history entries found</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PromptHistory entries={entries} />
    </div>
  );
}

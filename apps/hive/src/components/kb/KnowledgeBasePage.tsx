import { useState, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import KBEntryList from './KBEntryList';

import { API_BASE } from '@/lib/api-config';

export default function KnowledgeBasePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/kb/config`)
      .then((r) => r.json())
      .then((data: { configured?: boolean }) => {
        setConfigured(data.configured === true);
      })
      .catch(() => setConfigured(false));
  }, []);

  if (configured === null) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <BookOpen className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm mb-1">Knowledge Base not configured</p>
        <p className="text-xs">
          Copy <code className="text-[11px] bg-secondary px-1 rounded">.env.example</code> to <code className="text-[11px] bg-secondary px-1 rounded">.env</code> and set your SQL Server connection details.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">Shared knowledge across all AI sessions</p>
      </div>
      <KBEntryList />
    </div>
  );
}

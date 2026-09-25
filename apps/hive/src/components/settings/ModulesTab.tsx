import { useEffect, useState } from 'react';
import { Blocks, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { API_BASE } from '@/lib/api-config';

interface ModuleStatus {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  active: boolean;
  missing: string[];
}

/**
 * Settings → Modules: turn optional feature areas on or off. Core Hive
 * (sessions, terminals, projects, AI Studio, chat, schedules) is always on.
 */
export default function ModulesTab() {
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/modules`).then((r) => r.json()).then(setModules).catch(() => {});
  }, []);

  async function toggle(id: string, enabled: boolean) {
    const res = await fetch(`${API_BASE}/api/modules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) {
      setModules(await res.json());
      setDirty(true);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Modules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Turn feature areas on or off. Hidden modules disappear from the sidebar and their APIs stop answering.
        </p>
        {dirty && (
          <button className="mt-2 text-sm text-primary hover:underline" onClick={() => window.location.reload()}>
            Reload to update the sidebar
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Blocks className="h-4 w-4" />Optional modules</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {modules.map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{m.name}</span>
                  {m.enabled && m.active && <Badge variant="secondary" className="text-[10px]">Active</Badge>}
                  {m.enabled && !m.active && <Badge variant="destructive" className="text-[10px]">Needs setup</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
                {m.enabled && m.missing.map((req) => (
                  <p key={req} className="flex items-center gap-1 text-xs text-amber-500"><AlertTriangle className="h-3 w-3" />Requires: {req}</p>
                ))}
              </div>
              <Switch checked={m.enabled} onCheckedChange={(v) => void toggle(m.id, v)} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

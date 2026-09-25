import { useState } from 'react';
import { Loader2, CheckCircle2, HardDrive, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { API_BASE } from '@/lib/api-config';

// Keep in sync with the same union in TeamItemsSection.tsx.
type SharedItemType = 'skill' | 'agent' | 'plugin_config' | 'settings_template' | 'plan' | 'hook';

interface SharedItem {
  id: number;
  name: string;
  item_type: SharedItemType;
  description: string;
  scope: 'shared' | 'user';
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: SharedItem[];
}

export default function ExportDriveDialog({ open, onClose, items }: Props) {
  const [drivePath, setDrivePath] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Load saved drive path from config on open
  useState(() => {
    if (!open) return;
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then((data: Record<string, unknown>) => {
        if (data.sharingDrivePath) setDrivePath(data.sharingDrivePath as string);
      })
      .catch(() => {});
  });

  function toggleItem(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  }

  async function handleExport() {
    if (!drivePath.trim() || selected.size === 0) return;
    setStatus('exporting');
    setErrorMsg('');
    try {
      // Save drive path to config
      await fetch(`${API_BASE}/api/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharingDrivePath: drivePath.trim() }),
      });

      const res = await fetch(`${API_BASE}/api/sharing/export-drive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: [...selected], drivePath: drivePath.trim() }),
      });
      if (res.ok) {
        setStatus('done');
        setTimeout(() => {
          setStatus('idle');
          onClose();
        }, 1500);
      } else {
        const data = await res.json() as { error?: string };
        setErrorMsg(data.error ?? 'Export failed');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Network error');
      setStatus('error');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-lg mx-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" />
            Export to Google Drive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Drive Sync Folder Path</label>
            <input
              type="text"
              value={drivePath}
              onChange={e => setDrivePath(e.target.value)}
              placeholder="G:\My Drive\team-skills"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">Local path where Google Drive syncs files</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">Select items to export</label>
              <Button size="sm" variant="ghost" className="text-xs h-6" onClick={selectAll}>
                {selected.size === items.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-border p-2">
              {items.map(item => (
                <label key={item.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-secondary/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    className="rounded border-border"
                  />
                  <span className="text-sm text-foreground truncate flex-1">{item.name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{item.scope}</Badge>
                </label>
              ))}
              {items.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No items to export</p>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="h-3 w-3" />
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => void handleExport()}
              disabled={status === 'exporting' || !drivePath.trim() || selected.size === 0}
              className="gap-1.5"
            >
              {status === 'exporting' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : status === 'done' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <HardDrive className="h-3.5 w-3.5" />
              )}
              {status === 'done' ? 'Exported!' : `Export ${selected.size} item${selected.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

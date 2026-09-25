import { useEffect, useState, useMemo, useCallback } from 'react';
import { Loader2, Download, Trash2, Search, CheckCircle2, Globe, User, HardDrive, Wand2, Sparkles, Puzzle, Settings, Eye, X, FileText, RefreshCw, ClipboardList, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ExportDriveDialog from './ExportDriveDialog';

import { API_BASE } from '@/lib/api-config';

// Define types inline to avoid cross-project imports
type SharedItemType = 'skill' | 'agent' | 'plugin_config' | 'settings_template' | 'plan' | 'hook';

interface SharedItem {
  id: number;
  name: string;
  item_type: SharedItemType;
  description: string;
  tags: string;
  version: number;
  scope: 'shared' | 'user';
  scope_owner: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SharedItemFile {
  id: number;
  item_id: number;
  file_path: string;
  content: string;
  is_primary: boolean;
}

interface SharedItemWithFiles extends SharedItem {
  files: SharedItemFile[];
}

const TYPE_ICONS: Record<SharedItemType, typeof Wand2> = {
  skill: Wand2,
  agent: Sparkles,
  plugin_config: Puzzle,
  settings_template: Settings,
  plan: ClipboardList,
  hook: Webhook,
};

const TYPE_LABELS: Record<SharedItemType, string> = {
  skill: 'Skills',
  agent: 'Agents',
  plugin_config: 'Plugin Configs',
  settings_template: 'Settings Templates',
  plan: 'Plans',
  hook: 'Hooks',
};

interface Props {
  itemType: SharedItemType;
  onInstall?: () => void;
}

export default function TeamItemsSection({ itemType, onInstall }: Props) {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'shared' | 'user'>('all');
  const [installing, setInstalling] = useState<number | null>(null);
  const [installed, setInstalled] = useState<Set<number>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [viewing, setViewing] = useState<SharedItemWithFiles | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [syncingFromTeam, setSyncingFromTeam] = useState(false);
  const [syncFromTeamResult, setSyncFromTeamResult] = useState<{ total: number; succeeded: number } | null>(null);

  async function handleSyncFromTeam() {
    setSyncingFromTeam(true);
    setSyncFromTeamResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/sync-from-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: itemType }),
      });
      if (res.ok) {
        const data = await res.json() as { results: Array<{ ok: boolean }>; total: number };
        const succeeded = data.results.filter(r => r.ok).length;
        setSyncFromTeamResult({ total: data.total, succeeded });
        onInstall?.();
        setTimeout(() => setSyncFromTeamResult(null), 5000);
      }
    } catch { /* ignore */ } finally {
      setSyncingFromTeam(false);
    }
  }

  async function handleView(id: number) {
    setViewLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/items/${id}`);
      if (res.ok) {
        const data = await res.json() as SharedItemWithFiles;
        setViewing(data);
      }
    } catch { /* ignore */ } finally {
      setViewLoading(false);
    }
  }

  const fetchItems = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: itemType });
    if (search) params.set('q', search);
    fetch(`${API_BASE}/api/sharing/items?${params}`)
      .then(r => r.json())
      .then((data: SharedItem[] | unknown) => setItems(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [itemType, search]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Cross-reference team items with locally installed items to show correct installed status
  useEffect(() => {
    const localEndpoint = itemType === 'skill' ? '/api/skills'
      : itemType === 'agent' ? '/api/agents'
      : itemType === 'plan' ? '/api/insights/plans'
      : null;
    if (!localEndpoint || items.length === 0) return;

    fetch(`${API_BASE}${localEndpoint}`)
      .then(r => r.ok ? r.json() : [])
      .then((localItems: Array<{ name?: string; slug?: string }>) => {
        // Plans expose `slug` (filename) which equals the shared item's `name`.
        const localNames = new Set(localItems.map(i => i.name ?? i.slug ?? ''));
        const alreadyInstalled = new Set<number>();
        for (const item of items) {
          if (localNames.has(item.name)) {
            alreadyInstalled.add(item.id);
          }
        }
        if (alreadyInstalled.size > 0) {
          setInstalled(prev => {
            const next = new Set(prev);
            for (const id of alreadyInstalled) next.add(id);
            return next;
          });
        }
      })
      .catch(() => {/* ignore */});
  }, [items, itemType]);

  const filtered = useMemo(() => {
    if (scopeFilter === 'all') return items;
    return items.filter(i => i.scope === scopeFilter);
  }, [items, scopeFilter]);

  async function handleInstall(id: number) {
    setInstalling(id);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/items/${id}/install`, { method: 'POST' });
      if (res.ok) {
        setInstalled(prev => new Set(prev).add(id));
        onInstall?.();
      }
    } catch { /* ignore */ } finally {
      setInstalling(null);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Delete shared item "${name}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/sharing/items/${id}`, { method: 'DELETE' });
      fetchItems();
    } catch { /* ignore */ }
  }

  const Icon = TYPE_ICONS[itemType];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Team {TYPE_LABELS[itemType]}</h2>
          <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {syncFromTeamResult && (
            <span className="text-xs text-green-500">
              {syncFromTeamResult.succeeded}/{syncFromTeamResult.total} updated
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs h-7"
            onClick={() => void handleSyncFromTeam()}
            disabled={syncingFromTeam}
            title="Pull latest versions for all locally-installed items"
          >
            <RefreshCw className={`h-3 w-3 ${syncingFromTeam ? 'animate-spin' : ''}`} />
            {syncingFromTeam ? 'Syncing...' : 'Sync from Team'}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => setExportOpen(true)}>
            <HardDrive className="h-3 w-3" />
            Export to Drive
          </Button>
        </div>
      </div>

      {/* Search + Scope filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={`Search team ${TYPE_LABELS[itemType].toLowerCase()}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={scopeFilter}
          onChange={e => setScopeFilter(e.target.value as 'all' | 'shared' | 'user')}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All</option>
          <option value="shared">Shared</option>
          <option value="user">My Items</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">No team {TYPE_LABELS[itemType].toLowerCase()} found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(item => {
            const isInstalled = installed.has(item.id);
            const isInstalling = installing === item.id;
            const tags = item.tags ? item.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            return (
              <Card key={item.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.scope === 'shared' ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                          <Globe className="h-2.5 w-2.5" /> shared
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                          <User className="h-2.5 w-2.5" /> personal
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px] px-1 py-0">v{item.version}</Badge>
                    </div>
                  </div>

                  {item.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                  )}

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                      ))}
                    </div>
                  )}

                  {item.created_by && (
                    <p className="text-[10px] text-muted-foreground">by {item.created_by}</p>
                  )}

                  <div className="flex items-center gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1"
                      disabled={viewLoading}
                      onClick={() => void handleView(item.id)}
                    >
                      {viewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant={isInstalled ? 'outline' : 'default'}
                      className={cn('text-xs h-7 gap-1', isInstalled && 'text-green-400')}
                      disabled={isInstalled || isInstalling}
                      onClick={() => void handleInstall(item.id)}
                    >
                      {isInstalling ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isInstalled ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      {isInstalled ? 'Installed' : 'Install'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1 text-red-400 hover:text-red-300"
                      onClick={() => void handleDelete(item.id, item.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Item Viewer Drawer */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setViewing(null)} />
          <div className="relative ml-auto w-full max-w-3xl bg-background border-l border-border flex flex-col h-full animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <h2 className="text-lg font-semibold text-foreground truncate">{viewing.name}</h2>
                  <Badge variant="secondary" className="text-[10px] shrink-0">v{viewing.version}</Badge>
                  {viewing.scope === 'shared' ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
                      <Globe className="h-2.5 w-2.5" /> shared
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 shrink-0">
                      <User className="h-2.5 w-2.5" /> personal
                    </Badge>
                  )}
                </div>
                {viewing.description && (
                  <p className="text-xs text-muted-foreground mt-1">{viewing.description}</p>
                )}
                {viewing.created_by && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">by {viewing.created_by}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={installed.has(viewing.id)}
                  onClick={() => void handleInstall(viewing.id)}
                >
                  {installed.has(viewing.id) ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  ) : installing === viewing.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {installed.has(viewing.id) ? 'Installed' : 'Install'}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setViewing(null)} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Files */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {viewing.files.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No files</p>
              ) : (
                viewing.files.map(file => (
                  <div key={file.id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground">{file.file_path}</span>
                      {file.is_primary && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">primary</Badge>
                      )}
                    </div>
                    <pre className="rounded-md border border-border bg-secondary/50 p-4 text-xs font-mono text-foreground overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap break-words">
                      {file.content}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ExportDriveDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        items={items}
      />
    </div>
  );
}

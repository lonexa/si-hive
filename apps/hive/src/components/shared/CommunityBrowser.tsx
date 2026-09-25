import { useEffect, useState, useMemo } from 'react';
import { X, Loader2, Download, ExternalLink, Search, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { API_BASE } from '@/lib/api-config';

interface CommunityItem {
  name: string;
  description: string;
  source: string;
  sourceUrl: string;
  downloadUrl?: string;
  author?: string;
  category?: string;
}

interface Props {
  type: 'agents' | 'skills' | 'plugins' | 'hooks';
  open: boolean;
  onClose: () => void;
  onInstall?: () => void;
}

export default function CommunityBrowser({ type, open, onClose, onInstall }: Props) {
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');

    // Fetch community items and locally-installed items in parallel
    const installedEndpoint = type === 'agents' ? '/api/agents' : type === 'skills' ? '/api/skills' : null;
    const fetchInstalled = installedEndpoint
      ? fetch(`${API_BASE}${installedEndpoint}`)
          .then((r) => (r.ok ? r.json() : []))
          .then((data: Array<{ name: string }>) => {
            setInstalled(new Set(data.map((d) => d.name)));
          })
          .catch(() => {/* ignore */})
      : Promise.resolve();

    Promise.all([
      fetch(`${API_BASE}/api/community/${type}`)
        .then((r) => {
          if (!r.ok) throw new Error('Failed to fetch');
          return r.json();
        })
        .then((data: CommunityItem[]) => setItems(data)),
      fetchInstalled,
    ])
      .catch(() => setError(`Failed to load community ${type}`))
      .finally(() => setLoading(false));
  }, [open, type]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [items, search]);

  async function handleInstall(item: CommunityItem) {
    if (!item.downloadUrl && !item.sourceUrl) return;
    setInstalling(item.name);
    try {
      const endpoint = type === 'agents' ? '/api/agents/install'
        : type === 'skills' ? '/api/skills/install'
        : null;
      if (!endpoint) return;

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, url: item.downloadUrl ?? item.sourceUrl }),
      });
      if (res.ok) {
        setInstalled((prev) => new Set(prev).add(item.name));
        onInstall?.();
      }
    } catch {
      // silently fail
    } finally {
      setInstalling(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className="relative ml-auto w-full max-w-3xl bg-background border-l border-border flex flex-col h-full animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-foreground capitalize">
              Community {type}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {items.length} items available
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={`Search ${type}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setLoading(true);
                  setError('');
                  fetch(`${API_BASE}/api/community/${type}`)
                    .then((r) => r.json())
                    .then((data: CommunityItem[]) => setItems(data))
                    .catch(() => setError(`Failed to load community ${type}`))
                    .finally(() => setLoading(false));
                }}
              >
                Retry
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-sm">No {type} found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filtered.map((item) => {
                const isInstalled = installed.has(item.name);
                const isInstalling = installing === item.name;
                return (
                  <Card key={`${item.source}-${item.name}`} className="hover:border-primary/30 transition-colors">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium text-foreground truncate">{item.name}</h3>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {item.source.split('/')[0]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        {type !== 'hooks' && (item.downloadUrl || type !== 'plugins') ? (
                          <Button
                            size="sm"
                            variant={isInstalled ? 'outline' : 'default'}
                            className={cn('text-xs h-7 gap-1', isInstalled && 'text-green-400')}
                            disabled={isInstalled || isInstalling}
                            onClick={() => void handleInstall(item)}
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
                        ) : null}
                        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline" className="text-xs h-7 gap-1">
                            <ExternalLink className="h-3 w-3" />
                            View
                          </Button>
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

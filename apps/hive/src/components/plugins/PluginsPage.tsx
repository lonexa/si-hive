import { useState, useEffect, useCallback } from 'react';
import { Puzzle, Globe, Loader2, Share2, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import CommunityBrowser from '@/components/shared/CommunityBrowser';
import TeamItemsSection from '@/components/shared/TeamItemsSection';
import { getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

interface PluginInfo {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  installedAt: string;
  description: string;
  path: string;
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [enabledPlugins, setEnabledPlugins] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    Promise.all([getPrimaryProviderId(), getProviderStatus()]).then(([primaryId, statuses]) => {
      setSelectedProvider(primaryId);
      setEnabledProviders(statuses.filter(s => s.enabled && s.installed));
    });
  }, []);

  const fetchPlugins = useCallback(async (provider?: ProviderId) => {
    const pid = provider ?? selectedProvider;
    try {
      const res = await fetch(`${API_BASE}/api/plugins?provider=${pid}`);
      const data = (await res.json()) as { plugins: PluginInfo[]; enabledPlugins: Record<string, boolean> };
      setPlugins(data.plugins);
      setEnabledPlugins(data.enabledPlugins);
    } catch {
      // Network error
    } finally {
      setLoading(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  function toggleSelect(pluginId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pluginId)) next.delete(pluginId);
      else next.add(pluginId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === plugins.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(plugins.map((p) => p.id)));
    }
  }

  async function handleShareConfig() {
    const selectedPlugins = selected.size > 0
      ? plugins.filter((p) => selected.has(p.id))
      : plugins;
    const selectedEnabled: Record<string, boolean> = {};
    for (const p of selectedPlugins) {
      selectedEnabled[p.id] = enabledPlugins[p.id] ?? false;
    }

    const name = prompt('Name for this plugin configuration:');
    if (!name) return;
    setSharing(true);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          item_type: 'plugin_config',
          description: `Plugin configuration with ${selectedPlugins.length} plugin(s)`,
          files: [{
            file_path: 'config.json',
            content: JSON.stringify({
              enabledPlugins: selectedEnabled,
              plugins: selectedPlugins.map(p => ({ id: p.id, name: p.name })),
            }, null, 2),
            is_primary: true,
          }],
        }),
      });
      if (res.ok) {
        alert(`Plugin config "${name}" shared with ${selectedPlugins.length} plugin(s)!`);
        setSelected(new Set());
      }
    } catch { /* ignore */ } finally {
      setSharing(false);
    }
  }

  async function handleToggle(pluginId: string) {
    // Optimistically toggle
    setEnabledPlugins((prev) => ({
      ...prev,
      [pluginId]: !prev[pluginId],
    }));

    try {
      await fetch(`${API_BASE}/api/plugins/${encodeURIComponent(pluginId)}/toggle`, { method: 'PATCH' });
    } catch {
      // Revert on error
      void fetchPlugins();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allSelected = plugins.length > 0 && selected.size === plugins.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{selectedProvider === 'gemini' ? 'Extensions' : 'Plugins'}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage installed {selectedProvider === 'gemini' ? 'extensions' : 'plugins'} for {enabledProviders.find(p => p.id === selectedProvider)?.displayName ?? selectedProvider}
            </p>
          </div>
          {enabledProviders.length > 1 && (
            <div className="flex items-center gap-1 ml-2">
              {enabledProviders.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSelectedProvider(p.id); setSelected(new Set()); }}
                  className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                    selectedProvider === p.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                  title={p.displayName}
                >
                  {PROVIDER_SHORT_NAMES[p.id]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void handleShareConfig()}
            disabled={sharing}
          >
            {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
            {selected.size > 0 ? `Share ${selected.size} Selected` : 'Share All Config'}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBrowsing(true)}>
            <Globe className="h-3.5 w-3.5" />
            Browse Marketplace
          </Button>
        </div>
      </div>

      {plugins.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No plugins installed</p>
          <p className="text-xs mt-1">Browse the marketplace to discover and install plugins</p>
        </div>
      ) : (
        <>
          {/* Selection toolbar */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7"
              onClick={toggleSelectAll}
            >
              {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">{selected.size} of {plugins.length} selected</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plugins.map((plugin) => {
              const isEnabled = enabledPlugins[plugin.id] ?? false;
              const isSelected = selected.has(plugin.id);
              return (
                <Card
                  key={plugin.id}
                  className={`cursor-pointer transition-colors ${isSelected ? 'border-primary/50 bg-primary/5' : ''}`}
                  onClick={() => toggleSelect(plugin.id)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(plugin.id); }}>
                            {isSelected
                              ? <CheckSquare className="h-4 w-4 text-primary" />
                              : <Square className="h-4 w-4 text-muted-foreground" />
                            }
                          </div>
                          <div className="text-sm font-medium text-foreground truncate">{plugin.name}</div>
                        </div>
                        <div className="flex items-center gap-2 mt-1 ml-6">
                          <Badge variant="secondary" className="text-[10px]">
                            {plugin.marketplace}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">v{plugin.version}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isEnabled ? 'default' : 'outline'}
                        className={cn('text-xs h-7', isEnabled && 'bg-green-600 hover:bg-green-700')}
                        onClick={(e) => { e.stopPropagation(); void handleToggle(plugin.id); }}
                      >
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>
                    {plugin.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <CommunityBrowser
        type="plugins"
        open={browsing}
        onClose={() => setBrowsing(false)}
        onInstall={() => void fetchPlugins()}
      />

      {/* Team Plugin Configs */}
      <div className="border-t border-border pt-6">
        <TeamItemsSection itemType="plugin_config" onInstall={() => void fetchPlugins()} />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Bot, Plus, Loader2, Pencil, Trash2, Sparkles, Globe, Share2, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import AgentEditor from './AgentEditor';
import CommunityBrowser from '@/components/shared/CommunityBrowser';
import TeamItemsSection from '@/components/shared/TeamItemsSection';
import AISessionButton from '@/components/shared/AISessionButton';
import { agentEdit } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';
import { getPrimaryProviderId, getProviderStatus, PROVIDER_SHORT_NAMES, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

interface AgentInfo {
  filename: string;
  name: string;
  description: string;
  lastModified: string;
  content: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AgentInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [projectDir, setProjectDir] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
    Promise.all([getPrimaryProviderId(), getProviderStatus()]).then(([primaryId, statuses]) => {
      setSelectedProvider(primaryId);
      setEnabledProviders(statuses.filter(s => s.enabled && s.installed));
    });
  }, []);

  function fetchAgents(provider?: ProviderId) {
    const pid = provider ?? selectedProvider;
    fetch(`${API_BASE}/api/agents?provider=${pid}`)
      .then((r) => r.json())
      .then((data: AgentInfo[]) => setAgents(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchAgents(selectedProvider);
  }, [selectedProvider]);

  async function handleDelete(filename: string) {
    if (!confirm(`Delete agent "${filename}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/agents/${encodeURIComponent(filename)}?provider=${selectedProvider}`, { method: 'DELETE' });
      fetchAgents();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleShare(filename: string) {
    const name = filename.replace(/\.md$/, '');
    try {
      const res = await fetch(`${API_BASE}/api/sharing/publish-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent', name }),
      });
      if (res.ok) {
        alert(`Agent "${name}" shared with team!`);
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? 'Failed to share');
      }
    } catch {
      alert('Network error');
    }
  }

  function toggleSelect(filename: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === agents.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(agents.map((a) => a.filename)));
    }
  }

  async function handleShareSelected() {
    if (selected.size === 0) return;
    setSharing(true);
    try {
      const items = Array.from(selected).map((filename) => ({
        type: 'agent' as const,
        name: filename.replace(/\.md$/, ''),
      }));
      const res = await fetch(`${API_BASE}/api/sharing/publish-local-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json() as { results: Array<{ name: string; ok: boolean; error?: string }> };
        const succeeded = data.results.filter((r) => r.ok).length;
        const failed = data.results.filter((r) => !r.ok);
        let msg = `${succeeded} agent(s) shared with team!`;
        if (failed.length > 0) {
          msg += `\n${failed.length} failed: ${failed.map((f) => `${f.name}: ${f.error}`).join(', ')}`;
        }
        alert(msg);
        setSelected(new Set());
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? 'Failed to share');
      }
    } catch {
      alert('Network error');
    } finally {
      setSharing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (editing || creating) {
    return (
      <AgentEditor
        agent={editing ?? undefined}
        onClose={() => { setEditing(null); setCreating(false); }}
        onSaved={() => { setEditing(null); setCreating(false); fetchAgents(); }}
      />
    );
  }

  const allSelected = agents.length > 0 && selected.size === agents.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Agents</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage custom agents for {enabledProviders.find(p => p.id === selectedProvider)?.displayName ?? selectedProvider}
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
          <Button size="sm" variant="outline" onClick={() => setBrowsing(true)} className="gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            Browse Community
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Agent
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Bot className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No agents found</p>
          <p className="text-xs mt-1">No agents found for {enabledProviders.find(p => p.id === selectedProvider)?.displayName ?? selectedProvider}</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create Agent
          </Button>
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
              <Button
                size="sm"
                className="gap-1.5 text-xs h-7"
                onClick={() => void handleShareSelected()}
                disabled={sharing}
              >
                {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                Share {selected.size} Selected
              </Button>
            )}
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">{selected.size} of {agents.length} selected</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => {
              const isSelected = selected.has(agent.filename);
              return (
                <Card
                  key={agent.filename}
                  className={`hover:border-primary/30 transition-colors cursor-pointer ${isSelected ? 'border-primary/50 bg-primary/5' : ''}`}
                  onClick={() => toggleSelect(agent.filename)}
                >
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="shrink-0" onClick={(e) => { e.stopPropagation(); toggleSelect(agent.filename); }}>
                          {isSelected
                            ? <CheckSquare className="h-4 w-4 text-primary" />
                            : <Square className="h-4 w-4 text-muted-foreground" />
                          }
                        </div>
                        <Sparkles className="h-4 w-4 text-primary shrink-0" />
                        <h3 className="text-sm font-medium text-foreground truncate">{agent.name}</h3>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">.md</Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {agent.description || 'No description'}
                    </p>

                    <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      <AISessionButton
                        cwd={projectDir}
                        prompt={agentEdit(agent.name, agent.description, 'agent')}
                        variant="icon-only"
                        size="icon"
                        tooltip="Edit Agent in AI"
                      />
                      <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setEditing(agent)}>
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1 text-red-400 hover:text-red-300"
                        onClick={() => void handleDelete(agent.filename)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 gap-1"
                        onClick={() => void handleShare(agent.filename)}
                      >
                        <Share2 className="h-3 w-3" />
                        Share
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <CommunityBrowser
        type="agents"
        open={browsing}
        onClose={() => setBrowsing(false)}
        onInstall={() => fetchAgents()}
      />

      {/* Team Agents */}
      <div className="border-t border-border pt-6">
        <TeamItemsSection itemType="agent" onInstall={fetchAgents} />
      </div>
    </div>
  );
}

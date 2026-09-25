import { useEffect, useState, useCallback } from 'react';
import { Webhook, Plus, Loader2, Pencil, Trash2, Globe, Share2, User, FolderGit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CommunityBrowser from '@/components/shared/CommunityBrowser';
import TeamItemsSection from '@/components/shared/TeamItemsSection';
import HookEditor from '@/components/hooks/HookEditor';
import { getAvailableDirs } from '@/lib/project-mappings';
import { API_BASE } from '@/lib/api-config';

export type HookScope = 'user' | 'project';

export interface HookEntry {
  id: string;
  event: string;
  matcher: string;
  type: string;
  command: string;
  url: string;
  timeout?: number;
  statusMessage?: string;
  raw: Record<string, unknown>;
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}

export default function HooksPage() {
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HookEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [scope, setScope] = useState<HookScope>('user');
  const [projectDir, setProjectDir] = useState('');
  const [projectDirs, setProjectDirs] = useState<string[]>([]);

  useEffect(() => {
    getAvailableDirs().then((dirs) => {
      setProjectDirs(dirs);
      if (dirs.length > 0) setProjectDir((cur) => cur || dirs[0]);
    });
  }, []);

  const fetchHooks = useCallback(() => {
    if (scope === 'project' && !projectDir) {
      setHooks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ scope });
    if (scope === 'project') params.set('projectDir', projectDir);
    fetch(`${API_BASE}/api/hooks?${params}`)
      .then((r) => r.json())
      .then((data: HookEntry[] | { error?: string }) => setHooks(Array.isArray(data) ? data : []))
      .catch(() => setHooks([]))
      .finally(() => setLoading(false));
  }, [scope, projectDir]);

  useEffect(() => {
    fetchHooks();
  }, [fetchHooks]);

  async function handleDelete(h: HookEntry) {
    if (!confirm(`Delete this ${h.event} hook?`)) return;
    const params = new URLSearchParams({ scope });
    if (scope === 'project') params.set('projectDir', projectDir);
    try {
      await fetch(`${API_BASE}/api/hooks/${h.id}?${params}`, { method: 'DELETE' });
      fetchHooks();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleShare(h: HookEntry) {
    const name = prompt('Name this hook for the team:', `${h.event}${h.matcher ? ` (${h.matcher})` : ''}`);
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/sharing/publish-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'hook',
          name,
          hook: { event: h.event, matcher: h.matcher, hook: h.raw },
        }),
      });
      if (res.ok) {
        alert(`Hook "${name}" shared with team!`);
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? 'Failed to share');
      }
    } catch {
      alert('Network error');
    }
  }

  if (editing || creating) {
    return (
      <HookEditor
        hook={editing ?? undefined}
        scope={scope}
        projectDir={projectDir}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={() => {
          setEditing(null);
          setCreating(false);
          fetchHooks();
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Hooks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Claude Code hooks in{' '}
            <code className="bg-secondary px-1 rounded">
              {scope === 'user' ? '~/.claude/settings.json' : `${basename(projectDir) || '<project>'}/.claude/settings.json`}
            </code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setBrowsing(true)} className="gap-1.5">
            <Globe className="h-3.5 w-3.5" />
            Browse Community
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Hook
          </Button>
        </div>
      </div>

      {/* Scope selector — user-level vs a project's .claude/settings.json */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setScope('user')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
              scope === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <User className="h-3.5 w-3.5" /> User (global)
          </button>
          <button
            type="button"
            onClick={() => setScope('project')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
              scope === 'project' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <FolderGit2 className="h-3.5 w-3.5" /> Project
          </button>
        </div>
        {scope === 'project' && (
          <select
            value={projectDir}
            onChange={(e) => setProjectDir(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring max-w-md"
          >
            {projectDirs.length === 0 && <option value="">No projects found</option>}
            {projectDirs.map((d) => (
              <option key={d} value={d}>{basename(d)}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hooks.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Webhook className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hooks in this settings.json</p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Create Hook
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {hooks.map((h) => (
            <Card key={h.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Webhook className="h-4 w-4 text-primary shrink-0" />
                    <h3 className="text-sm font-medium text-foreground truncate">{h.event}</h3>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{h.type}</Badge>
                </div>

                {h.matcher && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="opacity-70">matcher:</span>
                    <code className="bg-secondary px-1 rounded font-mono">{h.matcher}</code>
                  </div>
                )}

                <p className="text-xs text-muted-foreground line-clamp-2 font-mono break-all">
                  {h.type === 'command' ? h.command : h.url || 'No command'}
                </p>

                {h.timeout != null && (
                  <Badge variant="secondary" className="text-[10px]">timeout {h.timeout}s</Badge>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setEditing(h)}>
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1 text-red-400 hover:text-red-300"
                    onClick={() => void handleDelete(h)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => void handleShare(h)}>
                    <Share2 className="h-3 w-3" />
                    Share
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CommunityBrowser type="hooks" open={browsing} onClose={() => setBrowsing(false)} />

      {/* Team Hooks (installs into ~/.claude/settings.json) */}
      <div className="border-t border-border pt-6">
        <TeamItemsSection itemType="hook" onInstall={fetchHooks} />
      </div>
    </div>
  );
}

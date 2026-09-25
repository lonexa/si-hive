import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { getProviderStatus } from '@/lib/launch-flags';
import type { ProviderStatus } from '@/lib/launch-flags';

import { API_BASE } from '@/lib/api-config';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type Mode = 'new' | 'existing';

export default function NewProjectDialog({ open, onOpenChange, onCreated }: Props) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('new');
  const [name, setName] = useState('');
  const [existingPath, setExistingPath] = useState('');
  const [initGit, setInitGit] = useState(true);
  const [createClaudeMd, setCreateClaudeMd] = useState(true);
  const [claudeMdContent, setClaudeMdContent] = useState('# Project Instructions\n\n');
  const [createGeminiMd, setCreateGeminiMd] = useState(false);
  const [createAgentsMd, setCreateAgentsMd] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<ProviderStatus[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      getProviderStatus().then((ps) => {
        setEnabledProviders(ps.filter((p) => p.enabled));
      });
    }
  }, [open]);

  const hasGemini = enabledProviders.some((p) => p.id === 'gemini');
  const hasCodex = enabledProviders.some((p) => p.id === 'codex');

  if (!open) return null;

  async function handleCreate() {
    setError('');

    if (mode === 'new') {
      if (!name.trim()) {
        setError('Project name is required');
        return;
      }
      if (/[<>:"/\\|?*]/.test(name)) {
        setError('Name contains invalid characters');
        return;
      }
    } else {
      if (!existingPath.trim()) {
        setError('Folder path is required');
        return;
      }
    }

    setLoading(true);
    try {
      const body = mode === 'new'
        ? {
            name: name.trim(),
            initGit,
            claudeMdContent: createClaudeMd ? claudeMdContent : undefined,
            createGeminiMd: hasGemini && createGeminiMd,
            createAgentsMd: hasCodex && createAgentsMd,
          }
        : {
            existingPath: existingPath.trim(),
            initGit,
            claudeMdContent: createClaudeMd ? claudeMdContent : undefined,
            createGeminiMd: hasGemini && createGeminiMd,
            createAgentsMd: hasCodex && createAgentsMd,
          };

      const res = await fetch(`${API_BASE}/api/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; path?: string; error?: string };
      if (data.ok) {
        onCreated();
        setName('');
        setExistingPath('');
        setError('');
        navigate('/projects');
      } else {
        setError(data.error ?? 'Failed to add project');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  const tabClass = (active: boolean) =>
    `flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => onOpenChange(false)}>
      <div className="bg-card border border-border rounded-lg w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-semibold text-foreground">Add Project</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'new' ? 'Create a new project directory' : 'Point to an existing folder'}
          </p>
        </div>

        <div className="flex gap-1 rounded-md border border-border bg-muted/40 p-1">
          <button type="button" className={tabClass(mode === 'new')} onClick={() => setMode('new')}>
            Create new
          </button>
          <button type="button" className={tabClass(mode === 'existing')} onClick={() => setMode('existing')}>
            Use existing folder
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'new' ? (
            <div>
              <label className="text-sm font-medium text-foreground">Project name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-project"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium text-foreground">Folder path</label>
              <input
                type="text"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                placeholder="C:\Users\me\code\my-project"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Absolute path to the folder on this machine.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={initGit} onChange={(e) => setInitGit(e.target.checked)} className="rounded" />
            {mode === 'new' ? 'Initialize git repository' : 'Initialize git repository (if not already a repo)'}
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={createClaudeMd} onChange={(e) => setCreateClaudeMd(e.target.checked)} className="rounded" />
            {mode === 'new' ? 'Create instruction file (CLAUDE.md)' : 'Create CLAUDE.md (only if missing)'}
          </label>

          {hasGemini && (
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={createGeminiMd} onChange={(e) => setCreateGeminiMd(e.target.checked)} className="rounded" />
              Create instruction file (GEMINI.md)
            </label>
          )}

          {hasCodex && (
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={createAgentsMd} onChange={(e) => setCreateAgentsMd(e.target.checked)} className="rounded" />
              Create instruction file (AGENTS.md)
            </label>
          )}

          {createClaudeMd && (
            <textarea
              value={claudeMdContent}
              onChange={(e) => setClaudeMdContent(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void handleCreate()} disabled={loading} className="gap-1.5">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === 'new' ? 'Create' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  );
}

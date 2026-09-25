import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  Rocket,
  FolderOpen,
  Search,
  Tag,
  Clock,
  Loader2,
  X,
  FileText,
} from 'lucide-react';
import { buildProviderArgs, getPrimaryProviderId, getProviderStatus, type ProviderId, type ProviderStatus } from '@/lib/launch-flags';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { SessionTemplate } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

const CATEGORIES = ['General', 'Development', 'DevOps', 'Data', 'Testing', 'Documentation', 'Review'] as const;

const PERMISSION_MODES = [
  { value: 'default', label: 'Default' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'autoMode', label: 'Auto Mode' },
  { value: 'bypassPermissions', label: 'Skip Permissions' },
] as const;

const EMPTY_FORM: TemplateForm = {
  name: '',
  description: '',
  projectPath: '',
  initialPrompt: '',
  permissionMode: 'default',
  model: '',
  provider: '',
  tags: '',
  category: 'General',
  contextPaths: [],
  newContextPath: '',
};

interface TemplateForm {
  name: string;
  description: string;
  projectPath: string;
  initialPrompt: string;
  permissionMode: string;
  model: string;
  provider: string;
  tags: string;
  category: string;
  contextPaths: string[];
  newContextPath: string;
}

export default function TemplatesTab() {
  const navigate = useNavigate();
  const projectsRoot = useDashboardStore((s) => s.projectsRoot);

  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    getProviderStatus().then(setProviderStatuses);
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/templates`);
      const data = await res.json();
      setTemplates(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filtered = templates.filter((t) => {
    if (filterCategory && t.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        t.initialPrompt.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const categoryCounts = templates.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + 1;
    return acc;
  }, {});

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, projectPath: projectsRoot ? `${projectsRoot}/` : '' });
    setDialogOpen(true);
  };

  const openEdit = (t: SessionTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description,
      projectPath: t.projectPath,
      initialPrompt: t.initialPrompt,
      permissionMode: t.permissionMode,
      model: t.model ?? '',
      provider: t.provider ?? '',
      tags: t.tags.join(', '),
      category: t.category,
      contextPaths: [...t.contextPaths],
      newContextPath: '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        projectPath: form.projectPath.trim(),
        initialPrompt: form.initialPrompt.trim(),
        permissionMode: form.permissionMode,
        model: form.model.trim() || undefined,
        provider: form.provider || undefined,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        category: form.category,
        contextPaths: form.contextPaths.filter(Boolean),
      };

      if (editingId) {
        await fetch(`${API_BASE}/api/templates/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`${API_BASE}/api/templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      setDialogOpen(false);
      fetchTemplates();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE}/api/templates/${id}`, { method: 'DELETE' });
    setDeleteConfirmId(null);
    fetchTemplates();
  };

  const handleLaunch = async (t: SessionTemplate) => {
    // Increment usage count on the server
    await fetch(`${API_BASE}/api/templates/${t.id}/launch`, { method: 'POST' });

    // Build args from the template prompt with context preloader paths using template's provider or primary
    const providerId = (t.provider as ProviderId) || await getPrimaryProviderId();
    const { command, args } = t.initialPrompt
      ? await buildProviderArgs(providerId, t.initialPrompt, {
          contextPaths: t.contextPaths,
          model: t.model,
          permissionMode: t.permissionMode,
        })
      : { command: providerId, args: [] as string[] };

    // Store spawn data in sessionStorage for the terminal grid to consume
    const spawnData = {
      cwd: t.projectPath || undefined,
      command,
      args: args.length > 0 ? args : undefined,
      provider: providerId,
    };
    sessionStorage.setItem('hive-terminal-spawn', JSON.stringify(spawnData));

    // Navigate to the sessions board which will consume the spawn data
    navigate('/sessions');
    fetchTemplates();
  };

  const permissionLabel = (mode: string) =>
    PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1">
          <Button
            variant={filterCategory === '' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterCategory('')}
          >
            All ({templates.length})
          </Button>
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <Button
              key={cat}
              variant={filterCategory === cat ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
            >
              {cat} ({count})
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Template
        </Button>
      </div>

      {/* Template Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <Rocket className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium text-foreground mb-1">
            {templates.length === 0 ? 'No templates yet' : 'No matching templates'}
          </p>
          <p className="text-xs text-center max-w-md">
            {templates.length === 0
              ? 'Create a template to quickly launch pre-configured AI sessions with your favorite prompts and project paths.'
              : 'Try adjusting your search or filter.'}
          </p>
          {templates.length === 0 && (
            <Button size="sm" className="mt-3" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Create First Template
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="group hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => handleLaunch(t)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm font-medium leading-tight">
                    {t.name}
                  </CardTitle>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(t);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(t.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {t.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {t.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {t.projectPath && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate">{t.projectPath}</span>
                  </div>
                )}
                {t.initialPrompt && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 line-clamp-2 font-mono">
                    {t.initialPrompt}
                  </p>
                )}
                {t.contextPaths.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span>{t.contextPaths.length} context path{t.contextPaths.length !== 1 ? 's' : ''}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {t.category}
                  </Badge>
                  {t.provider && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                      {t.provider === 'claude' ? 'CC' : t.provider === 'gemini' ? 'G' : 'CX'}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {permissionLabel(t.permissionMode)}
                  </Badge>
                  {t.model && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t.model}
                    </Badge>
                  )}
                  {t.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                      <Tag className="h-2 w-2 mr-0.5" />
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
                  <span className="flex items-center gap-1">
                    <Play className="h-2.5 w-2.5" />
                    {t.usageCount} launches
                  </span>
                  {t.lastUsedAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(t.lastUsedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bug Fix Workflow"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short description of what this template does"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Project Path</label>
              <Input
                value={form.projectPath}
                onChange={(e) => setForm({ ...form, projectPath: e.target.value })}
                placeholder="e.g. C:\Users\you\project"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Initial Prompt</label>
              <Textarea
                value={form.initialPrompt}
                onChange={(e) => setForm({ ...form, initialPrompt: e.target.value })}
                placeholder="The prompt to send when launching this template..."
                rows={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Category</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Permission Mode</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.permissionMode}
                  onChange={(e) => setForm({ ...form, permissionMode: e.target.value })}
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">AI Provider</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                >
                  <option value="">Primary (default)</option>
                  {providerStatuses.filter(p => p.enabled).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}{p.isPrimary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Model (optional)</label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="e.g. opus, sonnet"
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Tags (comma-separated)</label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g. bug-fix, frontend"
                />
              </div>
            </div>
            {/* Context Preloader */}
            <div>
              <label className="text-xs font-medium mb-1 block">
                Context Paths
                <span className="text-muted-foreground font-normal ml-1">(directories added via --add-dir)</span>
              </label>
              <div className="space-y-1.5">
                {form.contextPaths.map((cp, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground flex-1 truncate">{cp}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() =>
                        setForm({
                          ...form,
                          contextPaths: form.contextPaths.filter((_, i) => i !== idx),
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <Input
                    value={form.newContextPath}
                    onChange={(e) => setForm({ ...form, newContextPath: e.target.value })}
                    placeholder="e.g. C:\Users\you\project\src"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && form.newContextPath.trim()) {
                        e.preventDefault();
                        setForm({
                          ...form,
                          contextPaths: [...form.contextPaths, form.newContextPath.trim()],
                          newContextPath: '',
                        });
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2"
                    disabled={!form.newContextPath.trim()}
                    onClick={() => {
                      if (form.newContextPath.trim()) {
                        setForm({
                          ...form,
                          contextPaths: [...form.contextPaths, form.newContextPath.trim()],
                          newContextPath: '',
                        });
                      }
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId ? 'Save Changes' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this template? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
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
  Copy,
  CheckCircle2,
  Pencil,
  Trash2,
  Search,
  Tag,
  Star,
  Clock,
  BookOpen,
  Loader2,
  Play,
} from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { promptRun } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';
import type { SavedPrompt } from '@/stores/types';

import { API_BASE } from '@/lib/api-config';

const CATEGORIES = ['General', 'Development', 'Bug Fix', 'Refactor', 'Testing', 'Review', 'Documentation', 'DevOps'] as const;

const EMPTY_FORM = {
  title: '',
  content: '',
  description: '',
  tags: '',
  category: 'General',
  isFavorite: false,
};

export default function PromptsTab() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [defaultCwd, setDefaultCwd] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setDefaultCwd);
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/prompts`);
      const data = await res.json();
      setPrompts(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const filtered = prompts.filter((p) => {
    if (showFavoritesOnly && !p.isFavorite) return false;
    if (filterCategory && p.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const categoryCounts = prompts.reduce<Record<string, number>>((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {});

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  };

  const openEdit = (p: SavedPrompt) => {
    setEditingId(p.id);
    setForm({
      title: p.title,
      content: p.content,
      description: p.description,
      tags: p.tags.join(', '),
      category: p.category,
      isFavorite: p.isFavorite,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        description: form.description.trim(),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        category: form.category,
        isFavorite: form.isFavorite,
      };

      if (editingId) {
        await fetch(`${API_BASE}/api/prompts/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch(`${API_BASE}/api/prompts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      setDialogOpen(false);
      fetchPrompts();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE}/api/prompts/${id}`, { method: 'DELETE' });
    setDeleteConfirmId(null);
    fetchPrompts();
  };

  const handleCopy = async (p: SavedPrompt) => {
    await navigator.clipboard.writeText(p.content);
    setCopiedId(p.id);
    // Track usage
    await fetch(`${API_BASE}/api/prompts/${p.id}/use`, { method: 'POST' });
    setTimeout(() => setCopiedId(null), 2000);
    fetchPrompts();
  };

  const handleToggleFavorite = async (p: SavedPrompt) => {
    await fetch(`${API_BASE}/api/prompts/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: !p.isFavorite }),
    });
    fetchPrompts();
  };

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
            placeholder="Search prompts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1">
          <Button
            variant={!showFavoritesOnly && filterCategory === '' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setFilterCategory('');
              setShowFavoritesOnly(false);
            }}
          >
            All ({prompts.length})
          </Button>
          <Button
            variant={showFavoritesOnly ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setShowFavoritesOnly(!showFavoritesOnly);
              setFilterCategory('');
            }}
          >
            <Star className="h-3 w-3 mr-1" />
            Favorites
          </Button>
          {Object.entries(categoryCounts).map(([cat, count]) => (
            <Button
              key={cat}
              variant={filterCategory === cat ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setFilterCategory(filterCategory === cat ? '' : cat);
                setShowFavoritesOnly(false);
              }}
            >
              {cat} ({count})
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Prompt
        </Button>
      </div>

      {/* Prompt List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
          <BookOpen className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm font-medium text-foreground mb-1">
            {prompts.length === 0 ? 'No saved prompts' : 'No matching prompts'}
          </p>
          <p className="text-xs text-center max-w-md">
            {prompts.length === 0
              ? 'Save prompts you use frequently to quickly copy and reuse them across sessions.'
              : 'Try adjusting your search or filter.'}
          </p>
          {prompts.length === 0 && (
            <Button size="sm" className="mt-3" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Save First Prompt
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Card key={p.id} className="group hover:border-primary/30 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      className="shrink-0"
                      onClick={() => handleToggleFavorite(p)}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          p.isFavorite
                            ? 'fill-yellow-500 text-yellow-500'
                            : 'text-muted-foreground hover:text-yellow-500'
                        }`}
                      />
                    </button>
                    <CardTitle className="text-sm font-medium">{p.title}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handleCopy(p)}
                    >
                      {copiedId === p.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1 text-xs">
                        {copiedId === p.id ? 'Copied' : 'Copy'}
                      </span>
                    </Button>
                    <AISessionButton
                      cwd={defaultCwd}
                      prompt={promptRun(p.title, p.content, p.category)}
                      variant="icon-only"
                      size="icon"
                      tooltip="Launch with Prompt"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteConfirmId(p.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {p.description && (
                  <p className="text-xs text-muted-foreground ml-6">{p.description}</p>
                )}
              </CardHeader>
              <CardContent className="pt-0 ml-6 space-y-2">
                <pre className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 whitespace-pre-wrap max-h-32 overflow-auto font-mono">
                  {p.content}
                </pre>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {p.category}
                    </Badge>
                    {p.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                        <Tag className="h-2 w-2 mr-0.5" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Play className="h-2.5 w-2.5" />
                      {p.usageCount} uses
                    </span>
                    {p.lastUsedAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(p.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
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
            <DialogTitle>{editingId ? 'Edit Prompt' : 'New Prompt'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Title *</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Fix TypeScript Errors"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Prompt Content *</label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="The prompt text..."
                rows={6}
                className="font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description (optional)</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="When to use this prompt"
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
                <label className="text-xs font-medium mb-1 block">Tags (comma-separated)</label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g. typescript, fix"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isFavorite}
                onChange={(e) => setForm({ ...form, isFavorite: e.target.checked })}
                className="rounded"
              />
              <Star className="h-3.5 w-3.5 text-yellow-500" />
              Mark as favorite
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!form.title.trim() || !form.content.trim() || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId ? 'Save Changes' : 'Save Prompt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Prompt</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this prompt? This cannot be undone.
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

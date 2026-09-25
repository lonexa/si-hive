import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Search, Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  Globe, User, Copy, CheckCircle2, Code2, Loader2, Save, Share2,
} from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { snippet as snippetPrompt } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

const LANGUAGE_CATEGORIES = [
  { value: '', label: 'All Languages' },
  { value: 'sql', label: 'SQL' },
  { value: 'api', label: 'API Patterns' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'debug', label: 'Debug Commands' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'bash', label: 'Bash' },
  { value: 'other', label: 'Other' },
];

interface SharedItem {
  id: number;
  name: string;
  item_type: string;
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
  created_at: string;
  updated_at: string;
}

interface SharedItemWithFiles extends SharedItem {
  files: SharedItemFile[];
}

interface SnippetFormData {
  name: string;
  description: string;
  tags: string;
  language: string;
  content: string;
  scope: 'shared' | 'user';
  scope_owner: string;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function languageBadgeColor(lang: string): string {
  switch (lang.toLowerCase()) {
    case 'sql': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'api': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'powershell': return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'debug': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'typescript': return 'bg-blue-600/20 text-blue-300 border-blue-600/30';
    case 'javascript': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'bash': return 'bg-green-500/20 text-green-400 border-green-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function getLanguageFromFilePath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'sql': return 'sql';
    case 'ps1': case 'psm1': return 'powershell';
    case 'ts': case 'tsx': return 'typescript';
    case 'js': case 'jsx': return 'javascript';
    case 'sh': case 'bash': return 'bash';
    default: return 'other';
  }
}

function getFileExtension(language: string): string {
  switch (language) {
    case 'sql': return '.sql';
    case 'powershell': return '.ps1';
    case 'typescript': return '.ts';
    case 'javascript': return '.js';
    case 'bash': return '.sh';
    case 'api': return '.ts';
    case 'debug': return '.txt';
    default: return '.txt';
  }
}

// ---- Snippet Dialog ----

function SnippetDialog({ open, onOpenChange, snippet, onSaved, defaultScopeOwner }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippet?: SharedItemWithFiles;
  onSaved: () => void;
  defaultScopeOwner: string;
}) {
  const [form, setForm] = useState<SnippetFormData>({
    name: '', description: '', tags: '', language: 'sql',
    content: '', scope: 'shared', scope_owner: '',
  });
  const [saving, setSaving] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      if (snippet) {
        const primaryFile = snippet.files.find((f) => f.is_primary) || snippet.files[0];
        const lang = primaryFile ? getLanguageFromFilePath(primaryFile.file_path) : 'other';
        setForm({
          name: snippet.name,
          description: snippet.description,
          tags: snippet.tags,
          language: lang,
          content: primaryFile?.content || '',
          scope: snippet.scope || 'shared',
          scope_owner: snippet.scope_owner || '',
        });
      } else {
        setForm({
          name: '', description: '', tags: '', language: 'sql',
          content: '', scope: 'shared', scope_owner: defaultScopeOwner || '',
        });
      }
      fetch(`${API_BASE}/api/sharing/tags?type=snippet`)
        .then((r) => r.json())
        .then((data: string[]) => { if (Array.isArray(data)) setAvailableTags(data); })
        .catch(() => {});
    }
  }, [open, snippet, defaultScopeOwner]);

  async function handleSave() {
    if (!form.name.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const ext = getFileExtension(form.language);
      const fileName = `${form.name.replace(/[^a-zA-Z0-9_-]/g, '_')}${ext}`;
      const files = [{
        file_path: fileName,
        content: form.content,
        is_primary: true,
      }];

      if (snippet) {
        // Update
        const res = await fetch(`${API_BASE}/api/sharing/items/${snippet.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            tags: form.tags,
            scope: form.scope,
            scope_owner: form.scope === 'user' ? (form.scope_owner || defaultScopeOwner) : '',
            files,
          }),
        });
        if (res.ok) { onSaved(); onOpenChange(false); }
      } else {
        // Create
        const res = await fetch(`${API_BASE}/api/sharing/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            item_type: 'snippet',
            description: form.description,
            tags: form.tags,
            scope: form.scope,
            scope_owner: form.scope === 'user' ? (form.scope_owner || defaultScopeOwner) : '',
            created_by: defaultScopeOwner || '',
            files,
          }),
        });
        if (res.ok) { onSaved(); onOpenChange(false); }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{snippet ? 'Edit Snippet' : 'New Snippet'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Get Active Users Query"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Language</label>
              <select
                value={form.language}
                onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {LANGUAGE_CATEGORIES.filter((c) => c.value).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Description</label>
            <Input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Brief description of what this snippet does"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Code *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
              placeholder="Paste your code snippet here..."
              rows={10}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Tags</label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                placeholder="comma, separated, tags"
                list="snippet-tags"
              />
              <datalist id="snippet-tags">
                {availableTags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value as 'shared' | 'user' }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="shared">Shared (visible to everyone)</option>
                <option value="user">User (only me)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim() || !form.content.trim()}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {snippet ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main SnippetsTab ----

export default function SnippetsTab() {
  const [items, setItems] = useState<SharedItem[]>([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedItem, setExpandedItem] = useState<SharedItemWithFiles | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editSnippet, setEditSnippet] = useState<SharedItemWithFiles | undefined>(undefined);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [scopeOwner, setScopeOwner] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projectDir, setProjectDir] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
  }, []);

  const fetchItems = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ type: 'snippet' });
    if (search) params.set('q', search);
    if (tagFilter) params.set('tag', tagFilter);
    fetch(`${API_BASE}/api/sharing/items?${params.toString()}`)
      .then((r) => r.json())
      .then((data: SharedItem[] | { error: string }) => {
        if (Array.isArray(data)) {
          setItems(data);
          setConfigured(true);
        } else {
          setItems([]);
          if ('error' in data && typeof data.error === 'string' && data.error.includes('not configured')) {
            setConfigured(false);
          }
        }
      })
      .catch(() => { setItems([]); setConfigured(false); })
      .finally(() => setLoading(false));
  }, [search, tagFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  useEffect(() => {
    fetch(`${API_BASE}/api/sharing/tags?type=snippet`)
      .then((r) => r.json())
      .then((data: string[]) => { if (Array.isArray(data)) setTags(data); })
      .catch(() => {});
    fetch(`${API_BASE}/api/kb/config`)
      .then((r) => r.json())
      .then((data: { scopeOwner?: string }) => {
        if (data.scopeOwner) setScopeOwner(data.scopeOwner);
      })
      .catch(() => {});
  }, []);

  async function handleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedItem(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/items/${id}`);
      if (res.ok) {
        const data = await res.json() as SharedItemWithFiles;
        setExpandedItem(data);
      }
    } catch {
      setExpandedItem(null);
    }
  }

  async function handleCopy(content: string, id: number) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleAdd() {
    setEditSnippet(undefined);
    setDialogOpen(true);
  }

  async function handleEdit(id: number) {
    try {
      const res = await fetch(`${API_BASE}/api/sharing/items/${id}`);
      if (res.ok) {
        const data = await res.json() as SharedItemWithFiles;
        setEditSnippet(data);
        setDialogOpen(true);
      }
    } catch { /* ignore */ }
  }

  async function handleShare(id: number) {
    await fetch(`${API_BASE}/api/sharing/items/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'shared', scope_owner: '' }),
    });
    fetchItems();
  }

  async function handleDelete(id: number) {
    await fetch(`${API_BASE}/api/sharing/items/${id}`, { method: 'DELETE' });
    if (expandedId === id) { setExpandedId(null); setExpandedItem(null); }
    fetchItems();
  }

  if (configured === false) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Code2 className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm mb-1">Sharing not configured</p>
        <p className="text-xs">
          Set up SQL Server connection in <code className="text-[11px] bg-secondary px-1 rounded">Settings → Storage</code> to enable shared snippets.
        </p>
      </div>
    );
  }

  // Filter by language locally (description field often contains language info)
  const filteredItems = languageFilter
    ? items.filter((item) => {
        const desc = item.description.toLowerCase();
        const name = item.name.toLowerCase();
        const itemTags = item.tags.toLowerCase();
        return desc.includes(languageFilter) || name.includes(languageFilter) || itemTags.includes(languageFilter);
      })
    : items;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">Shared Snippets</h1>
        <p className="text-sm text-muted-foreground mt-1">Team-shared code snippets with search, tags, and version history</p>
      </div>

      {/* Search and filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets..."
            className="pl-9"
          />
        </div>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {LANGUAGE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {tags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <Button size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Snippet
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-foreground">{items.length}</div>
            <div className="text-xs text-muted-foreground">Total Snippets</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-foreground">{items.filter((i) => i.scope === 'shared').length}</div>
            <div className="text-xs text-muted-foreground">Shared</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-foreground">{tags.length}</div>
            <div className="text-xs text-muted-foreground">Tags</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-foreground">
              {items.reduce((max, i) => Math.max(max, i.version), 0)}
            </div>
            <div className="text-xs text-muted-foreground">Max Version</div>
          </CardContent>
        </Card>
      </div>

      {/* Snippet list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading snippets...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          {search || tagFilter || languageFilter
            ? 'No snippets match your filters.'
            : 'No snippets yet. Click "New Snippet" to create one.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => {
            const expanded = expandedId === item.id;
            const itemTags = item.tags ? item.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
            return (
              <Card key={item.id} className="cursor-pointer" onClick={() => void handleExpand(item.id)}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Code2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm text-foreground">{item.name}</span>
                        {item.scope === 'user' ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <User className="h-2.5 w-2.5" />{item.scope_owner || 'user'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 text-muted-foreground">
                            <Globe className="h-2.5 w-2.5" />shared
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">v{item.version}</Badge>
                      </div>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      )}
                      {!expanded && itemTags.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {itemTags.map((t) => (
                            <Badge key={t} variant="outline" className={`text-[10px] px-1.5 py-0 ${languageBadgeColor(t)}`}>{t}</Badge>
                          ))}
                        </div>
                      )}
                      {expanded && expandedItem && expandedItem.id === item.id && (
                        <div className="mt-3 space-y-2">
                          {expandedItem.files.map((file) => (
                            <div key={file.id} className="relative">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-muted-foreground font-mono">{file.file_path}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[10px] gap-1"
                                  onClick={(e) => { e.stopPropagation(); void handleCopy(file.content, item.id); }}
                                >
                                  {copiedId === item.id ? (
                                    <><CheckCircle2 className="h-3 w-3 text-green-400" /> Copied</>
                                  ) : (
                                    <><Copy className="h-3 w-3" /> Copy</>
                                  )}
                                </Button>
                              </div>
                              <pre className="text-xs text-foreground whitespace-pre-wrap bg-secondary/50 rounded p-3 font-mono overflow-x-auto">{file.content}</pre>
                            </div>
                          ))}
                          {itemTags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {itemTags.map((t) => (
                                <Badge key={t} variant="outline" className={`text-[10px] px-1.5 py-0 ${languageBadgeColor(t)}`}>{t}</Badge>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                            {item.created_by && <span>By: {item.created_by}</span>}
                            <span>Version: {item.version}</span>
                            <span>Created: {formatDate(item.created_at)}</span>
                            <span>Updated: {formatDate(item.updated_at)}</span>
                          </div>
                        </div>
                      )}
                      {expanded && (!expandedItem || expandedItem.id !== item.id) && (
                        <div className="mt-3 py-4 text-center">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <AISessionButton
                        cwd={projectDir}
                        prompt={snippetPrompt(
                          item.name,
                          itemTags[0] || 'code',
                          expandedItem && expandedItem.id === item.id
                            ? (expandedItem.files[0]?.content || item.description)
                            : item.description
                        )}
                        variant="icon-only"
                        size="icon"
                        tooltip="Improve Code"
                      />
                      {item.scope === 'user' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-blue-400"
                          title="Share with team"
                          onClick={(e) => { e.stopPropagation(); void handleShare(item.id); }}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); void handleEdit(item.id); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={(e) => { e.stopPropagation(); void handleDelete(item.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SnippetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        snippet={editSnippet}
        onSaved={fetchItems}
        defaultScopeOwner={scopeOwner}
      />
    </div>
  );
}

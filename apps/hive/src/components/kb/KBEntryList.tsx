import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Globe, User, Share2 } from 'lucide-react';
import KBEntryDialog from './KBEntryDialog';
import AISessionButton from '@/components/shared/AISessionButton';
import { kbEntry } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

interface KBEntry {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  scope: 'shared' | 'user';
  scope_owner: string;
  source: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function KBEntryList() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<KBEntry | undefined>(undefined);
  const [scopeFilter, setScopeFilter] = useState<'' | 'shared' | 'user'>('');
  const [scopeOwner, setScopeOwner] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectDir, setProjectDir] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
  }, []);

  const fetchEntries = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (categoryFilter) params.set('category', categoryFilter);
    const qs = params.toString();
    fetch(`${API_BASE}/api/kb/entries${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((data: KBEntry[] | { error: string }) => {
        if (Array.isArray(data)) setEntries(data);
        else setEntries([]);
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [search, categoryFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetch(`${API_BASE}/api/kb/categories`)
      .then((r) => r.json())
      .then((data: string[]) => { if (Array.isArray(data)) setCategories(data); })
      .catch(() => {});
    fetch(`${API_BASE}/api/kb/config`)
      .then((r) => r.json())
      .then((data: { scopeOwner?: string }) => {
        if (data.scopeOwner) setScopeOwner(data.scopeOwner);
      })
      .catch(() => {});
  }, []);

  function handleAdd() {
    setEditEntry(undefined);
    setDialogOpen(true);
  }

  function handleEdit(entry: KBEntry) {
    setEditEntry(entry);
    setDialogOpen(true);
  }

  async function handleShare(id: number) {
    await fetch(`${API_BASE}/api/kb/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'shared', scope_owner: '' }),
    });
    fetchEntries();
  }

  async function handleDelete(id: number) {
    await fetch(`${API_BASE}/api/kb/entries/${id}`, { method: 'DELETE' });
    fetchEntries();
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search knowledge base..."
            className="pl-9"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as '' | 'shared' | 'user')}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All entries</option>
          <option value="shared">Shared only</option>
          <option value="user">My entries</option>
        </select>
        <Button size="sm" onClick={handleAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Entry
        </Button>
      </div>

      {/* Entry list */}
      {loading ? (
        <div className="text-center text-muted-foreground text-sm py-8">Loading...</div>
      ) : (() => {
        const filtered = scopeFilter
          ? entries.filter((e) => e.scope === scopeFilter)
          : entries;
        return filtered.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          {search || categoryFilter || scopeFilter ? 'No entries match your filters.' : 'No entries yet. Click "Add Entry" to create one.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const expanded = expandedId === entry.id;
            const tags = entry.tags ? entry.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
            return (
              <Card key={entry.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : entry.id)}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-foreground">{entry.title}</span>
                        {entry.scope === 'user' ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <User className="h-2.5 w-2.5" />{entry.scope_owner || 'user'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 text-muted-foreground">
                            <Globe className="h-2.5 w-2.5" />shared
                          </Badge>
                        )}
                        {entry.category && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.category}</Badge>
                        )}
                      </div>
                      {!expanded && (
                        <p className="text-xs text-muted-foreground truncate">{entry.content}</p>
                      )}
                      {expanded && (
                        <div className="mt-2 space-y-2">
                          <pre className="text-xs text-foreground whitespace-pre-wrap bg-secondary/50 rounded p-3">{entry.content}</pre>
                          {tags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {tags.map((t) => (
                                <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                            {entry.source && <span>Source: {entry.source}</span>}
                            {entry.created_by && <span>By: {entry.created_by}</span>}
                            <span>Created: {formatDate(entry.created_at)}</span>
                            <span>Updated: {formatDate(entry.updated_at)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <AISessionButton
                        cwd={projectDir}
                        prompt={kbEntry(entry.title, entry.content, entry.tags)}
                        variant="icon-only"
                        size="icon"
                        tooltip="Research Further"
                      />
                      {entry.scope === 'user' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-blue-400"
                          title="Share with team"
                          onClick={(e) => { e.stopPropagation(); void handleShare(entry.id); }}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={(e) => { e.stopPropagation(); void handleDelete(entry.id); }}
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
      );
      })()}

      <KBEntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editEntry}
        onSaved={fetchEntries}
        defaultScopeOwner={scopeOwner}
      />
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Search, Plus, Pencil, Trash2, ChevronDown, ChevronUp,
  Globe, User, Loader2, Save, Share2, FileText, Calendar,
  Link as LinkIcon, RefreshCw,
} from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { decisionRecord } from '@/lib/prompt-templates';
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

// ADR content uses a structured markdown format stored in the KB content field.
// Format:
// ## Status\n<status>\n## Context\n<context>\n## Decision\n<decision>\n## Consequences\n<consequences>\n## Participants\n<participants>\n## Links\n<links>

interface ADRFields {
  status: string;
  context: string;
  decision: string;
  consequences: string;
  participants: string;
  links: string;
}

const ADR_STATUSES = ['Proposed', 'Accepted', 'Deprecated', 'Superseded'];

function parseADR(content: string): ADRFields {
  const fields: ADRFields = {
    status: 'Proposed', context: '', decision: '', consequences: '', participants: '', links: '',
  };

  const sections = content.split(/^## /m).filter(Boolean);
  for (const section of sections) {
    const lines = section.trim().split('\n');
    const header = lines[0]?.trim().toLowerCase();
    const body = lines.slice(1).join('\n').trim();

    if (header === 'status') fields.status = body || 'Proposed';
    else if (header === 'context') fields.context = body;
    else if (header === 'decision') fields.decision = body;
    else if (header === 'consequences') fields.consequences = body;
    else if (header === 'participants') fields.participants = body;
    else if (header === 'links') fields.links = body;
  }

  // If content doesn't follow ADR format, treat it all as context
  if (!fields.context && !fields.decision && content.trim()) {
    fields.context = content;
  }

  return fields;
}

function formatADR(fields: ADRFields): string {
  const parts: string[] = [];
  parts.push(`## Status\n${fields.status}`);
  parts.push(`## Context\n${fields.context}`);
  parts.push(`## Decision\n${fields.decision}`);
  if (fields.consequences) parts.push(`## Consequences\n${fields.consequences}`);
  if (fields.participants) parts.push(`## Participants\n${fields.participants}`);
  if (fields.links) parts.push(`## Links\n${fields.links}`);
  return parts.join('\n\n');
}

function statusBadgeColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'accepted': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'proposed': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'deprecated': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'superseded': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- Decision Dialog ----

function DecisionDialog({ open, onOpenChange, entry, onSaved, defaultScopeOwner }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: KBEntry;
  onSaved: () => void;
  defaultScopeOwner: string;
}) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<'shared' | 'user'>('shared');
  const [scopeOwner, setScopeOwner] = useState('');
  const [adr, setAdr] = useState<ADRFields>({
    status: 'Proposed', context: '', decision: '', consequences: '', participants: '', links: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (entry) {
        setTitle(entry.title);
        setTags(entry.tags);
        setSource(entry.source);
        setScope(entry.scope || 'shared');
        setScopeOwner(entry.scope_owner || '');
        setAdr(parseADR(entry.content));
      } else {
        setTitle('');
        setTags('');
        setSource('');
        setScope('shared');
        setScopeOwner(defaultScopeOwner || '');
        setAdr({ status: 'Proposed', context: '', decision: '', consequences: '', participants: '', links: '' });
      }
    }
  }, [open, entry, defaultScopeOwner]);

  async function handleSave() {
    if (!title.trim() || !adr.context.trim() || !adr.decision.trim()) return;
    setSaving(true);
    try {
      const content = formatADR(adr);
      const payload = {
        title,
        content,
        category: 'decision',
        tags,
        scope,
        scope_owner: scope === 'user' ? (scopeOwner || defaultScopeOwner) : '',
        source,
        created_by: defaultScopeOwner || '',
      };

      const url = entry ? `${API_BASE}/api/kb/entries/${entry.id}` : `${API_BASE}/api/kb/entries`;
      const method = entry ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) { onSaved(); onOpenChange(false); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Decision' : 'New Decision Record'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Use SQL Server for SI Hive data"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Status</label>
              <select
                value={adr.status}
                onChange={(e) => setAdr((p) => ({ ...p, status: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {ADR_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Context *</label>
            <textarea
              value={adr.context}
              onChange={(e) => setAdr((p) => ({ ...p, context: e.target.value }))}
              placeholder="What is the issue or question that we're addressing?"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Decision *</label>
            <textarea
              value={adr.decision}
              onChange={(e) => setAdr((p) => ({ ...p, decision: e.target.value }))}
              placeholder="What is the change that we're proposing or have agreed upon?"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Consequences</label>
            <textarea
              value={adr.consequences}
              onChange={(e) => setAdr((p) => ({ ...p, consequences: e.target.value }))}
              placeholder="What are the positive and negative outcomes of this decision?"
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Participants</label>
              <Input
                value={adr.participants}
                onChange={(e) => setAdr((p) => ({ ...p, participants: e.target.value }))}
                placeholder="Who was involved in this decision?"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Links</label>
              <Input
                value={adr.links}
                onChange={(e) => setAdr((p) => ({ ...p, links: e.target.value }))}
                placeholder="Ticket IDs, session IDs, URLs"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Tags</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Source</label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Meeting, PR review, etc."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'shared' | 'user')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="shared">Shared</option>
                <option value="user">User</option>
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
              disabled={saving || !title.trim() || !adr.context.trim() || !adr.decision.trim()}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {entry ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Main DecisionsTab ----

export default function DecisionsTab() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<KBEntry | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [scopeOwner, setScopeOwner] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projectDir, setProjectDir] = useState('');

  useEffect(() => {
    resolveDefaultProjectDir().then(setProjectDir);
  }, []);

  const fetchEntries = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ category: 'decision' });
    if (search) params.set('q', search);
    if (tagFilter) params.set('tag', tagFilter);
    fetch(`${API_BASE}/api/kb/entries?${params.toString()}`)
      .then((r) => r.json())
      .then((data: KBEntry[] | { error: string }) => {
        if (Array.isArray(data)) {
          setEntries(data);
          setConfigured(true);
        } else {
          setEntries([]);
          if ('error' in data && typeof data.error === 'string' && data.error.includes('not configured')) {
            setConfigured(false);
          }
        }
      })
      .catch(() => { setEntries([]); setConfigured(false); })
      .finally(() => setLoading(false));
  }, [search, tagFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  useEffect(() => {
    fetch(`${API_BASE}/api/kb/tags`)
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
    if (expandedId === id) setExpandedId(null);
    fetchEntries();
  }

  if (configured === false) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <FileText className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm mb-1">Knowledge Base not configured</p>
        <p className="text-xs">
          Set up SQL Server connection in <code className="text-[11px] bg-secondary px-1 rounded">Settings → Storage</code> to enable the decision log.
        </p>
      </div>
    );
  }

  // Apply status filter locally by parsing content
  const filteredEntries = statusFilter
    ? entries.filter((e) => {
        const adr = parseADR(e.content);
        return adr.status.toLowerCase() === statusFilter.toLowerCase();
      })
    : entries;

  // Compute status counts for summary
  const statusCounts = entries.reduce<Record<string, number>>((acc, e) => {
    const adr = parseADR(e.content);
    const s = adr.status || 'Unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Decision Log</h1>
          <p className="text-sm text-muted-foreground mt-1">Architecture Decision Records (ADRs) linked to tickets and sessions</p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchEntries} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-foreground">{entries.length}</div>
            <div className="text-xs text-muted-foreground">Total Decisions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-green-400">{statusCounts['Accepted'] || 0}</div>
            <div className="text-xs text-muted-foreground">Accepted</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-yellow-400">{statusCounts['Proposed'] || 0}</div>
            <div className="text-xs text-muted-foreground">Proposed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-2xl font-bold text-red-400">{(statusCounts['Deprecated'] || 0) + (statusCounts['Superseded'] || 0)}</div>
            <div className="text-xs text-muted-foreground">Deprecated / Superseded</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search decisions... "why did we do it this way?"'
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All statuses</option>
          {ADR_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
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
          New Decision
        </Button>
      </div>

      {/* Decision list */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading decisions...</span>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">
          {search || statusFilter || tagFilter
            ? 'No decisions match your filters.'
            : 'No decisions yet. Click "New Decision" to create your first ADR.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map((entry) => {
            const expanded = expandedId === entry.id;
            const adr = parseADR(entry.content);
            const entryTags = entry.tags ? entry.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
            return (
              <Card key={entry.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : entry.id)}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm text-foreground">{entry.title}</span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusBadgeColor(adr.status)}`}>
                          {adr.status}
                        </Badge>
                        {entry.scope === 'user' ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                            <User className="h-2.5 w-2.5" />{entry.scope_owner || 'user'}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5 text-muted-foreground">
                            <Globe className="h-2.5 w-2.5" />shared
                          </Badge>
                        )}
                      </div>
                      {!expanded && (
                        <p className="text-xs text-muted-foreground truncate">
                          {adr.context || entry.content}
                        </p>
                      )}
                      {!expanded && (
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" />{formatDateShort(entry.created_at)}
                          </span>
                          {adr.participants && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <User className="h-2.5 w-2.5" />{adr.participants}
                            </span>
                          )}
                          {adr.links && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <LinkIcon className="h-2.5 w-2.5" />linked
                            </span>
                          )}
                        </div>
                      )}
                      {expanded && (
                        <div className="mt-3 space-y-3">
                          {/* Context */}
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Context</h4>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{adr.context}</p>
                          </div>
                          {/* Decision */}
                          <div>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Decision</h4>
                            <p className="text-sm text-foreground whitespace-pre-wrap bg-secondary/30 rounded p-3">{adr.decision}</p>
                          </div>
                          {/* Consequences */}
                          {adr.consequences && (
                            <div>
                              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Consequences</h4>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{adr.consequences}</p>
                            </div>
                          )}
                          {/* Participants */}
                          {adr.participants && (
                            <div>
                              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Participants</h4>
                              <p className="text-sm text-foreground">{adr.participants}</p>
                            </div>
                          )}
                          {/* Links */}
                          {adr.links && (
                            <div>
                              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Links</h4>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{adr.links}</p>
                            </div>
                          )}
                          {/* Tags */}
                          {entryTags.length > 0 && (
                            <div className="flex gap-1 flex-wrap">
                              {entryTags.map((t) => (
                                <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                              ))}
                            </div>
                          )}
                          {/* Metadata */}
                          <div className="flex items-center gap-4 text-[10px] text-muted-foreground border-t border-border pt-2">
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
                        prompt={decisionRecord(entry.title, adr.status, adr.context, adr.decision, adr.consequences)}
                        variant="icon-only"
                        size="icon"
                        tooltip="Analyze Decision"
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
      )}

      <DecisionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editEntry}
        onSaved={fetchEntries}
        defaultScopeOwner={scopeOwner}
      />
    </div>
  );
}

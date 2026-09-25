import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ClipboardList, Plus, RefreshCw, ExternalLink, UserPlus, Play, Loader2, MessageSquare, Search,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import ProjectPathPicker from '@/components/shared/ProjectPathPicker';
import { getAvailableDirs } from '@/lib/project-mappings';
import { useAISession } from '@/hooks/useAISession';
import { timeAgo, cn } from '@/lib/utils';
import {
  api, issuePath, readLocal, writeLocal,
  type Issue, type IssueComment, type Iteration, type StateCategory, type WorkStatus,
} from './delivery-api';
import { EmptyState, ErrorBanner, IssueStateBadge, LoadingRow, Markdown, PersonName } from './DeliveryShared';

const LAST_PROJECT_KEY = 'hive-work-last-project';

type Can = (capability: string) => boolean;

export default function WorkPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<WorkStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [showNew, setShowNew] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try { setStatus(await api<WorkStatus>('/api/work/status')); } catch (e) { setStatusError((e as Error).message); }
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const caps = useMemo(() => new Set(status?.tracker.capabilities ?? []), [status]);
  // Unknown capability list → don't hide anything.
  const can: Can = useCallback((c) => caps.size === 0 || caps.has(c), [caps]);
  const hasSprint = caps.has('iterations');

  const requestedTab = searchParams.get('tab') || 'mine';
  const tab = requestedTab === 'sprint' && !hasSprint ? 'mine' : requestedTab;
  const openKey = searchParams.get('issue');

  const updateParams = useCallback((fn: (p: URLSearchParams) => void) => {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace: true });
  }, [setSearchParams]);
  const openIssue = useCallback((key: string) => updateParams((p) => p.set('issue', key)), [updateParams]);
  const closeIssue = useCallback(() => updateParams((p) => p.delete('issue')), [updateParams]);
  const bump = useCallback(() => setReload((n) => n + 1), []);

  if (!status && !statusError) return <LoadingRow />;

  if (statusError) {
    return (
      <div className="space-y-4 max-w-5xl">
        <PageHeader />
        <ErrorBanner error={statusError} />
      </div>
    );
  }

  if (!status?.tracker.connected) {
    return (
      <div className="space-y-4 max-w-5xl">
        <PageHeader />
        <EmptyState icon={ClipboardList} title="No ticket tracker connected" showSettingsLink>
          Connect a tracker in integration settings to see your tickets, update them, and start AI sessions from them.
        </EmptyState>
      </div>
    );
  }

  const trackerLabel = [status.tracker.label, status.tracker.provider].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader subtitle={trackerLabel ? `Tickets from ${trackerLabel}` : undefined}>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={bump}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        {can('create') && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowNew(true)}><Plus className="h-3.5 w-3.5" /> New ticket</Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => updateParams((p) => p.set('tab', v))}>
        <TabsList>
          <TabsTrigger value="mine">My tickets</TabsTrigger>
          <TabsTrigger value="open">All open</TabsTrigger>
          {hasSprint && <TabsTrigger value="sprint">Sprint</TabsTrigger>}
          <TabsTrigger value="search">Search</TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          <IssueList path="/api/work/issues?mine=1&state=open" reload={reload} onOpen={openIssue} emptyText="Nothing open is assigned to you." />
        </TabsContent>
        <TabsContent value="open" className="mt-4">
          <IssueList path="/api/work/issues?state=open&limit=100" reload={reload} onOpen={openIssue} emptyText="No open tickets." />
        </TabsContent>
        {hasSprint && (
          <TabsContent value="sprint" className="mt-4">
            <SprintTab reload={reload} onOpen={openIssue} />
          </TabsContent>
        )}
        <TabsContent value="search" className="mt-4">
          <SearchTab reload={reload} onOpen={openIssue} />
        </TabsContent>
      </Tabs>

      <Sheet open={!!openKey} onOpenChange={(o) => { if (!o) closeIssue(); }}>
        <SheetContent className="sm:max-w-2xl">
          {openKey && <IssueDetail key={openKey} issueKey={openKey} can={can} onChanged={bump} />}
        </SheetContent>
      </Sheet>

      <NewTicketDialog
        open={showNew}
        onOpenChange={setShowNew}
        can={can}
        onCreated={(issue) => { setShowNew(false); bump(); openIssue(issue.key); }}
      />
    </div>
  );
}

function PageHeader({ subtitle, children }: { subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Work</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle ?? 'Your tickets, in one place — and one click to start an AI session on any of them.'}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function useIssues(path: string | null, reload: number) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) { setIssues([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<{ connected: boolean; issues: Issue[] }>(path)
      .then((d) => { if (!cancelled) setIssues(d.issues ?? []); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, reload]);

  return { issues, loading, error };
}

function IssueList({ path, reload, onOpen, emptyText, filter }: {
  path: string | null;
  reload: number;
  onOpen: (key: string) => void;
  emptyText: string;
  filter?: (i: Issue) => boolean;
}) {
  const { issues, loading, error } = useIssues(path, reload);
  const shown = filter ? issues.filter(filter) : issues;
  return <IssueTable issues={shown} loading={loading} error={error} onOpen={onOpen} emptyText={emptyText} />;
}

function IssueTable({ issues, loading, error, onOpen, emptyText }: {
  issues: Issue[];
  loading: boolean;
  error: string | null;
  onOpen: (key: string) => void;
  emptyText: string;
}) {
  if (error) return <ErrorBanner error={error} />;
  if (loading && issues.length === 0) return <LoadingRow />;
  if (issues.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">{emptyText}</div>;
  return (
    <Card className="p-0 overflow-hidden">
      {issues.map((i) => <IssueRow key={i.key} issue={i} onOpen={onOpen} />)}
    </Card>
  );
}

function IssueRow({ issue, onOpen }: { issue: Issue; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(issue.key)}
      className="w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
    >
      <span className="font-mono text-[11px] text-muted-foreground w-24 shrink-0 truncate" title={issue.key}>{issue.key}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{issue.title}</div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground min-w-0">
          {issue.type && <span className="shrink-0">{issue.type}</span>}
          {issue.type && <span className="shrink-0">·</span>}
          <span className="shrink-0 truncate max-w-[10rem]"><PersonName person={issue.assignee} /></span>
          {issue.labels.slice(0, 3).map((l) => (
            <Badge key={l} variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground shrink-0">{l}</Badge>
          ))}
          {issue.labels.length > 3 && <span className="shrink-0">+{issue.labels.length - 3}</span>}
        </div>
      </div>
      <IssueStateBadge state={issue.state} category={issue.stateCategory} />
      <span className="text-[11px] text-muted-foreground w-16 text-right shrink-0">{issue.updatedAt ? timeAgo(issue.updatedAt) : ''}</span>
    </button>
  );
}

function SearchTab({ reload, onOpen }: { reload: number; onOpen: (key: string) => void }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'open' | 'done' | 'all'>('open');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const path = submitted === null ? null : `/api/work/issues?q=${encodeURIComponent(submitted)}&state=${state}&limit=100`;
  const { issues, loading, error } = useIssues(path, reload);

  return (
    <div className="space-y-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSubmitted(text.trim()); }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search tickets by title or description…" className="pl-8 h-9" />
        </div>
        <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}</Button>
      </form>
      {submitted === null
        ? <div className="text-sm text-muted-foreground py-8 text-center">Search across every ticket in the connected tracker.</div>
        : <IssueTable issues={issues} loading={loading} error={error} onOpen={onOpen} emptyText="No tickets match." />}
    </div>
  );
}

/** Iteration names on issues may be full paths (`Project\Sprint 4`) while the iteration list has leaf names. */
function inIteration(issue: Issue, it: Iteration): boolean {
  const v = issue.iteration;
  if (!v) return false;
  return v === it.name || v === it.id || v.endsWith(`\\${it.name}`) || v.endsWith(`/${it.name}`);
}

function SprintTab({ reload, onOpen }: { reload: number; onOpen: (key: string) => void }) {
  const [iterations, setIterations] = useState<Iteration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    api<Iteration[]>('/api/work/iterations')
      .then((its) => {
        setIterations(its);
        const current = its.find((i) => i.current) ?? its[its.length - 1];
        if (current) setSelectedId(current.id);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const selected = iterations?.find((i) => i.id === selectedId);
  const filter = useCallback((i: Issue) => (selected ? inIteration(i, selected) : false), [selected]);

  if (error) return <ErrorBanner error={error} />;
  if (!iterations) return <LoadingRow />;
  if (iterations.length === 0) return <div className="text-sm text-muted-foreground py-8 text-center">The tracker reports no iterations.</div>;

  const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Pick an iteration" /></SelectTrigger>
          <SelectContent>
            {iterations.map((it) => (
              <SelectItem key={it.id} value={it.id}>{it.name}{it.current ? ' (current)' : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (selected.startDate || selected.endDate) && (
          <span className="text-xs text-muted-foreground">{fmt(selected.startDate)} – {fmt(selected.endDate)}</span>
        )}
      </div>
      <IssueList
        path={selected ? `/api/work/issues?state=all&limit=100&iteration=${encodeURIComponent(selected.id)}` : null}
        reload={reload}
        onOpen={onOpen}
        filter={filter}
        emptyText="No tickets found in this iteration."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const STATE_ACTIONS: { category: StateCategory; label: string }[] = [
  { category: 'todo', label: 'To do' },
  { category: 'in_progress', label: 'In progress' },
  { category: 'done', label: 'Done' },
];

function IssueDetail({ issueKey, can, onChanged }: { issueKey: string; can: Can; onChanged: () => void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [showSession, setShowSession] = useState(false);

  useEffect(() => {
    api<{ issue: Issue; comments: IssueComment[] }>(issuePath(issueKey))
      .then((d) => { setIssue(d.issue); setComments(d.comments ?? []); })
      .catch((e) => setError((e as Error).message));
  }, [issueKey]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const patch = (label: string, body: { stateCategory?: StateCategory; assignee?: string }) => run(label, async () => {
    const updated = await api<Issue>(issuePath(issueKey), { method: 'PATCH', body });
    setIssue(updated);
    onChanged();
  });

  const postComment = () => run('comment', async () => {
    const created = await api<IssueComment>(issuePath(issueKey, '/comments'), { method: 'POST', body: { body: comment.trim() } });
    setComments((c) => [...c, created]);
    setComment('');
  });

  if (!issue) {
    return (
      <>
        <SheetHeader><SheetTitle className="font-mono text-sm">{issueKey}</SheetTitle></SheetHeader>
        <div className="px-6 py-4">{error ? <ErrorBanner error={error} /> : <LoadingRow />}</div>
      </>
    );
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetDescription className="flex items-center gap-2 text-xs">
          <span className="font-mono">{issue.key}</span>
          {issue.type && <span>· {issue.type}</span>}
          <IssueStateBadge state={issue.state} category={issue.stateCategory} />
        </SheetDescription>
        <SheetTitle className="text-base leading-snug">{issue.title}</SheetTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
          <span>Assignee: <PersonName person={issue.assignee} /></span>
          {issue.priority && <span>· Priority {issue.priority}</span>}
          {issue.iteration && <span>· {issue.iteration}</span>}
          {issue.updatedAt && <span>· updated {timeAgo(issue.updatedAt)}</span>}
          {issue.labels.map((l) => (
            <Badge key={l} variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground">{l}</Badge>
          ))}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {can('transition') && (
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {STATE_ACTIONS.map((a) => (
                <button
                  key={a.category}
                  type="button"
                  disabled={!!busy || issue.stateCategory === a.category}
                  onClick={() => void patch(`state-${a.category}`, { stateCategory: a.category })}
                  className={cn(
                    'text-xs px-2.5 py-1.5 border-r border-border last:border-r-0 transition-colors disabled:cursor-default',
                    issue.stateCategory === a.category ? 'bg-foreground/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
                  )}
                >
                  {busy === `state-${a.category}` ? <Loader2 className="h-3 w-3 animate-spin inline" /> : a.label}
                </button>
              ))}
            </div>
          )}
          {can('assign') && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={!!busy} onClick={() => void patch('assign', { assignee: 'me' })}>
              {busy === 'assign' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Assign to me
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowSession((s) => !s)}>
            <Play className="h-3.5 w-3.5" /> Start session
          </Button>
          {issue.url && (
            <Button asChild size="sm" variant="ghost" className="h-8 text-xs gap-1 ml-auto">
              <a href={issue.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open in tracker</a>
            </Button>
          )}
        </div>

        <ErrorBanner error={error} />

        {showSession && <StartSessionPanel issueKey={issue.key} />}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
          {issue.description?.trim()
            ? <Markdown text={issue.description} />
            : <div className="text-sm text-muted-foreground italic">No description.</div>}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments ({comments.length})</h3>
          {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
          {comments.map((c) => (
            <div key={c.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> <PersonName person={c.author} fallback="Unknown" /> · {timeAgo(c.createdAt)}
              </div>
              <Markdown text={c.body} className="pl-4" />
            </div>
          ))}
          {can('comment') && (
            <div className="space-y-2 pt-1">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comment.trim()) { e.preventDefault(); void postComment(); } }}
                placeholder="Add a comment… (markdown supported, Ctrl+Enter to post)"
                rows={3}
                className="resize-none"
              />
              <div className="flex justify-end">
                <Button size="sm" variant="outline" disabled={!!busy || !comment.trim()} onClick={() => void postComment()}>
                  {busy === 'comment' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Comment'}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function StartSessionPanel({ issueKey }: { issueKey: string }) {
  const { launchSession } = useAISession();
  const [dirs, setDirs] = useState<string[]>([]);
  const [projectPath, setProjectPath] = useState(() => readLocal(LAST_PROJECT_KEY) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAvailableDirs().then((d) => {
      setDirs(d);
      setProjectPath((p) => p || d[0] || '');
    });
  }, []);

  const start = async () => {
    if (!projectPath) return;
    setBusy(true);
    setError(null);
    try {
      const { prompt } = await api<{ prompt: string }>(issuePath(issueKey, '/prepare'), { method: 'POST', body: { projectPath } });
      writeLocal(LAST_PROJECT_KEY, projectPath);
      await launchSession({ cwd: projectPath, prompt });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="p-3 space-y-3 border-primary/30">
      <div className="text-xs text-muted-foreground">
        SI Hive writes the ticket's details into the project and opens an AI session primed to work on it.
      </div>
      <ProjectPathPicker value={projectPath} onChange={setProjectPath} availableDirs={dirs} />
      <ErrorBanner error={error} />
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" disabled={busy || !projectPath} onClick={() => void start()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Launch session
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// New ticket
// ---------------------------------------------------------------------------

function NewTicketDialog({ open, onOpenChange, can, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  can: Can;
  onCreated: (issue: Issue) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [labels, setLabels] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setTitle(''); setDescription(''); setLabels(''); setError(null); }
  }, [open]);

  const submit = async () => {
    if (!title.trim()) { setError('Enter a title.'); return; }
    setBusy(true);
    setError(null);
    try {
      const issue = await api<Issue>('/api/work/issues', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          labels: labels.split(',').map((s) => s.trim()).filter(Boolean),
          assignToMe: can('assign') && assignToMe,
        },
      });
      onCreated(issue);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="text-base">New ticket</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <ErrorBanner error={error} />
          <label className="block text-xs text-muted-foreground">Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 h-9" placeholder="What needs doing?" autoFocus />
          </label>
          <label className="block text-xs text-muted-foreground">Description
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 resize-none" placeholder="Markdown supported" />
          </label>
          {can('labels') && (
            <label className="block text-xs text-muted-foreground">Labels (comma-separated)
              <Input value={labels} onChange={(e) => setLabels(e.target.value)} className="mt-1 h-9" placeholder="bug, backend" />
            </label>
          )}
          {can('assign') && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={assignToMe} onCheckedChange={setAssignToMe} /> Assign to me
            </label>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || !title.trim()} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

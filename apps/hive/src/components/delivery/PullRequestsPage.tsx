import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  GitPullRequest, RefreshCw, ExternalLink, Loader2, MessageSquare, Check, GitMerge, Sparkles, ChevronRight, ArrowRight, Send,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { timeAgo, cn } from '@/lib/utils';
import {
  api, readLocal, writeLocal,
  type LocalRepoInfo, type PrComment, type PrDetail, type PullRequest, type WorkStatus,
} from './delivery-api';
import { EmptyState, ErrorBanner, LoadingRow, Markdown, PersonName, PrStateBadge } from './DeliveryShared';

const REPO_KEY = 'hive-pulls-repo';
type PrStateFilter = 'open' | 'closed' | 'all';

const repoId = (r: Pick<LocalRepoInfo, 'connectionId' | 'repo'>) => `${r.connectionId}::${r.repo}`;

export default function PullRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [repos, setRepos] = useState<LocalRepoInfo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(() => readLocal(REPO_KEY) ?? '');
  const [stateFilter, setStateFilter] = useState<PrStateFilter>('open');
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [aiAvailable, setAiAvailable] = useState(false);

  const loadRepos = useCallback(async (fresh = false) => {
    setReposError(null);
    try {
      const list = await api<LocalRepoInfo[]>(`/api/pulls/repos${fresh ? '?fresh=1' : ''}`);
      // One entry per host repo even when it's checked out in several places.
      const unique = [...new Map(list.map((r) => [repoId(r), r])).values()];
      setRepos(unique);
      setSelected((cur) => (unique.some((r) => repoId(r) === cur) ? cur : unique[0] ? repoId(unique[0]) : ''));
    } catch (e) { setReposError((e as Error).message); setRepos([]); }
  }, []);

  useEffect(() => { void loadRepos(); }, [loadRepos]);
  useEffect(() => {
    api<WorkStatus>('/api/work/status').then((s) => setAiAvailable(s.ai)).catch(() => {});
  }, []);

  const repo = useMemo(() => repos?.find((r) => repoId(r) === selected), [repos, selected]);

  useEffect(() => {
    if (!repo) { setPrs([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<PullRequest[]>(`/api/pulls?connectionId=${encodeURIComponent(repo.connectionId)}&repo=${encodeURIComponent(repo.repo)}&state=${stateFilter}`)
      .then((list) => { if (!cancelled) setPrs(list); })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setPrs([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo, stateFilter, reload]);

  const pickRepo = (id: string) => {
    setSelected(id);
    writeLocal(REPO_KEY, id);
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('pr'); return next; }, { replace: true });
  };

  const openNumber = Number(searchParams.get('pr')) || null;
  const setOpenNumber = (n: number | null) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev);
    if (n) next.set('pr', String(n)); else next.delete('pr');
    return next;
  }, { replace: true });

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Pull Requests</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Review, discuss, and merge pull requests for the repos you have checked out.</p>
      </div>
      {repos && repos.length > 0 && (
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { void loadRepos(true); setReload((n) => n + 1); }}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      )}
    </div>
  );

  if (!repos) return <div className="space-y-4 max-w-5xl">{header}<LoadingRow /></div>;

  if (repos.length === 0) {
    return (
      <div className="space-y-4 max-w-5xl">
        {header}
        <ErrorBanner error={reposError} />
        <EmptyState icon={GitPullRequest} title="No repositories found" showSettingsLink>
          Pull requests appear for local checkouts of repositories hosted on a connected git host.
          Connect your git host in integration settings, then open or clone a project from it.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={pickRepo}>
          <SelectTrigger className="w-80"><SelectValue placeholder="Pick a repository" /></SelectTrigger>
          <SelectContent>
            {repos.map((r) => (
              <SelectItem key={repoId(r)} value={repoId(r)}>
                {r.repo}{r.connectionLabel ? ` · ${r.connectionLabel}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStateFilter(s)}
              className={cn(
                'text-xs px-3 py-1.5 rounded border capitalize',
                stateFilter === s ? 'border-foreground/60 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner error={error} />
      {loading && prs.length === 0 && <LoadingRow />}
      {!loading && !error && prs.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">No {stateFilter === 'all' ? '' : `${stateFilter} `}pull requests.</div>
      )}
      {prs.length > 0 && (
        <Card className="p-0 overflow-hidden">
          {prs.map((pr) => <PrRow key={pr.id || pr.number} pr={pr} onOpen={() => setOpenNumber(pr.number)} />)}
        </Card>
      )}

      <Sheet open={!!openNumber && !!repo} onOpenChange={(o) => { if (!o) setOpenNumber(null); }}>
        <SheetContent className="sm:max-w-4xl">
          {openNumber && repo && (
            <PrDetailView
              key={`${repoId(repo)}#${openNumber}`}
              repo={repo}
              number={openNumber}
              aiAvailable={aiAvailable}
              onChanged={() => setReload((n) => n + 1)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PrRow({ pr, onOpen }: { pr: PullRequest; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
    >
      <span className="font-mono text-[11px] text-muted-foreground w-12 shrink-0">#{pr.number}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{pr.title}</div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground min-w-0">
          <PersonName person={pr.author} fallback="Unknown" />
          <span>·</span>
          <span className="font-mono truncate">{pr.sourceBranch}</span>
          <ArrowRight className="h-3 w-3 shrink-0" />
          <span className="font-mono truncate">{pr.targetBranch}</span>
        </div>
      </div>
      <PrStateBadge state={pr.state} />
      <span className="text-[11px] text-muted-foreground w-16 text-right shrink-0">{timeAgo(pr.updatedAt || pr.createdAt)}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function PrDetailView({ repo, number, aiAvailable, onChanged }: {
  repo: LocalRepoInfo;
  number: number;
  aiAvailable: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [review, setReview] = useState<{ text: string; posted: boolean } | null>(null);
  const [tab, setTab] = useState('conversation');
  const [notice, setNotice] = useState<string | null>(null);

  const ref = { connectionId: repo.connectionId, repo: repo.repo, number };

  const load = useCallback(async () => {
    try {
      setDetail(await api<PrDetail>(`/api/pulls/detail?connectionId=${encodeURIComponent(repo.connectionId)}&repo=${encodeURIComponent(repo.repo)}&number=${number}`));
    } catch (e) { setError((e as Error).message); }
  }, [repo.connectionId, repo.repo, number]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const postComment = (body: string) => api<PrComment>('/api/pulls/comment', { method: 'POST', body: { ...ref, body } });

  const submitComment = () => run('comment', async () => {
    const created = await postComment(comment.trim());
    setDetail((d) => (d ? { ...d, comments: [...d.comments, created] } : d));
    setComment('');
  });

  const approve = () => run('approve', async () => {
    await api('/api/pulls/approve', { method: 'POST', body: ref });
    setNotice('Approved.');
    await load();
  });

  const merge = () => run('merge', async () => {
    await api('/api/pulls/merge', { method: 'POST', body: ref });
    setNotice('Merged.');
    await load();
    onChanged();
  });

  const aiReview = () => run('ai-review', async () => {
    setTab('ai');
    const r = await api<{ review: string; posted: boolean }>('/api/pulls/ai-review', { method: 'POST', body: { ...ref, post: false } });
    setReview({ text: r.review, posted: false });
  });

  const postReview = () => run('post-review', async () => {
    if (!review) return;
    await api('/api/pulls/ai-review', { method: 'POST', body: { ...ref, body: review.text, post: true } });
    setReview({ ...review, posted: true });
    await load();
  });

  if (!detail) {
    return (
      <>
        <SheetHeader><SheetTitle className="font-mono text-sm">#{number}</SheetTitle></SheetHeader>
        <div className="px-6 py-4">{error ? <ErrorBanner error={error} /> : <LoadingRow />}</div>
      </>
    );
  }

  const { pr, comments, diff, capabilities } = detail;
  const isOpen = pr.state === 'open' || pr.state === 'draft';
  const canReview = capabilities.includes('reviews');
  const canMerge = capabilities.includes('merge');

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetDescription className="flex items-center gap-2 text-xs">
          <span className="font-mono">{pr.repo} #{pr.number}</span>
          <PrStateBadge state={pr.state} />
        </SheetDescription>
        <SheetTitle className="text-base leading-snug">{pr.title}</SheetTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
          <PersonName person={pr.author} fallback="Unknown" />
          <span>wants to merge</span>
          <span className="font-mono text-foreground/80">{pr.sourceBranch}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-mono text-foreground/80">{pr.targetBranch}</span>
          <span>· opened {timeAgo(pr.createdAt)}</span>
          {pr.reviewers && pr.reviewers.length > 0 && <span>· reviewers: {pr.reviewers.map((r) => r.name).join(', ')}</span>}
          {pr.labels?.map((l) => (
            <Badge key={l} variant="outline" className="text-[9px] px-1 py-0 font-normal text-muted-foreground">{l}</Badge>
          ))}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {isOpen && canReview && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-status-green border-status-green/40" disabled={!!busy} onClick={() => void approve()}>
              {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
            </Button>
          )}
          {isOpen && canMerge && (
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 text-purple-400 border-purple-400/40" disabled={!!busy} onClick={() => setConfirmMerge(true)}>
              {busy === 'merge' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />} Merge
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            disabled={!!busy || !aiAvailable}
            title={aiAvailable ? 'Ask the AI backend to review this diff' : 'Configure an AI backend in Settings to enable AI review'}
            onClick={() => void aiReview()}
          >
            {busy === 'ai-review' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} AI review
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 text-xs gap-1 ml-auto">
            <a href={pr.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Open on host</a>
          </Button>
        </div>

        <ErrorBanner error={error} />
        {notice && <div className="text-xs text-status-green">{notice}</div>}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9">
            <TabsTrigger value="conversation" className="text-xs">Conversation ({comments.length})</TabsTrigger>
            <TabsTrigger value="files" className="text-xs">Files ({countFiles(diff)})</TabsTrigger>
            {(review || busy === 'ai-review') && <TabsTrigger value="ai" className="text-xs">AI review</TabsTrigger>}
          </TabsList>

          <TabsContent value="conversation" className="mt-4 space-y-4">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h3>
              {pr.description?.trim()
                ? <Markdown text={pr.description} />
                : <div className="text-sm text-muted-foreground italic">No description.</div>}
            </section>
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comments</h3>
              {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
              {comments.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <MessageSquare className="h-3 w-3" /> <PersonName person={c.author} fallback="Unknown" /> · {timeAgo(c.createdAt)}
                    {c.path && <span className="font-mono">· {c.path}{c.line ? `:${c.line}` : ''}</span>}
                  </div>
                  <Markdown text={c.body} className="pl-4" />
                </div>
              ))}
              <div className="space-y-2 pt-1">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comment.trim()) { e.preventDefault(); void submitComment(); } }}
                  placeholder="Leave a comment… (markdown supported, Ctrl+Enter to post)"
                  rows={3}
                  className="resize-none"
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" disabled={!!busy || !comment.trim()} onClick={() => void submitComment()}>
                    {busy === 'comment' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Comment'}
                  </Button>
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="files" className="mt-4">
            <DiffViewer diff={diff} />
          </TabsContent>

          <TabsContent value="ai" className="mt-4 space-y-3">
            {busy === 'ai-review' && !review && <LoadingRow label="Reviewing the diff — this can take a minute or two…" />}
            {review && (
              <Card className="p-4 space-y-3">
                <Markdown text={review.text} />
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                  {review.posted
                    ? <span className="text-xs text-status-green">Posted as a comment.</span>
                    : (
                      <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => void postReview()}>
                        {busy === 'post-review' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Post as comment
                      </Button>
                    )}
                </div>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={confirmMerge} onOpenChange={setConfirmMerge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge pull request #{pr.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This merges <span className="font-mono">{pr.sourceBranch}</span> into <span className="font-mono">{pr.targetBranch}</span> using the host's default merge method.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void merge()}>Merge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Diff viewer
// ---------------------------------------------------------------------------

interface DiffFile {
  name: string;
  lines: string[];
  additions: number;
  deletions: number;
}

const BIG_FILE_LINES = 600;

function countFiles(diff: string): number {
  const n = (diff.match(/^diff --git /gm) ?? []).length;
  // Hosts that don't return git-format diffs still render as a single block.
  return n || (diff.trim() ? 1 : 0);
}

function parseDiff(diff: string): DiffFile[] {
  const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.trim());
  return chunks.map((chunk) => {
    const lines = chunk.replace(/\n$/, '').split('\n');
    const head = lines[0] ?? '';
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(head);
    const name = m ? (m[1] === m[2] ? m[2] : `${m[1]} → ${m[2]}`) : head.startsWith('diff --git') ? head.slice(11) : 'Changes';
    let additions = 0;
    let deletions = 0;
    for (const l of lines) {
      if (l.startsWith('+') && !l.startsWith('+++')) additions++;
      else if (l.startsWith('-') && !l.startsWith('---')) deletions++;
    }
    return { name, lines, additions, deletions };
  });
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground';
  if (line.startsWith('+')) return 'bg-status-green/10 text-status-green';
  if (line.startsWith('-')) return 'bg-status-red/10 text-status-red';
  if (line.startsWith('@@')) return 'bg-status-blue/10 text-status-blue';
  if (/^(diff --git|index |new file|deleted file|similarity|rename |old mode|new mode|Binary files)/.test(line)) return 'text-muted-foreground';
  return 'text-foreground/80';
}

function DiffViewer({ diff }: { diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!diff.trim()) return <div className="text-sm text-muted-foreground py-8 text-center">No changes.</div>;
  const expandAll = files.length <= 8;
  return (
    <div className="space-y-2">
      {files.map((f, i) => <DiffFileBlock key={`${f.name}-${i}`} file={f} defaultOpen={expandAll && f.lines.length <= BIG_FILE_LINES} />)}
    </div>
  );
}

function DiffFileBlock({ file, defaultOpen }: { file: DiffFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/40 hover:bg-muted/70 text-left"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="font-mono text-xs text-foreground truncate flex-1">{file.name}</span>
        <span className="text-[11px] font-mono text-status-green">+{file.additions}</span>
        <span className="text-[11px] font-mono text-status-red">-{file.deletions}</span>
      </button>
      {open && (
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto bg-background">
          <pre className="font-mono text-[11px] leading-[1.45] min-w-max">
            {file.lines.map((l, i) => (
              <div key={i} className={cn('px-3 whitespace-pre', lineClass(l))}>{l || ' '}</div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

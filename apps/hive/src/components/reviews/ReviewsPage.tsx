import { useCallback, useEffect, useState } from 'react';
import { Card } from '@hive/shared/components/ui/card';
import { Badge } from '@hive/shared/components/ui/badge';
import { Button } from '@hive/shared/components/ui/button';
import { Loader2, Plus, Check, AlertTriangle, X, MessageSquare } from 'lucide-react';
import { API_BASE } from '@/lib/api-config';
import { useAuth } from '@/auth/AuthProvider';
import { timeAgo } from '@/lib/utils';

type ReviewKind = 'session' | 'commit' | 'note';
type ReviewStatus = 'requested' | 'approved' | 'changes' | 'closed';

interface PeerReview {
  id: number;
  requesterOid: string; requesterName: string;
  reviewerOid: string; reviewerName: string;
  title: string; kind: ReviewKind; refId: string | null; repo: string | null; context: string | null;
  status: ReviewStatus; createdAt: string; updatedAt: string; respondedAt: string | null;
}
interface ReviewComment { id: number; reviewId: number; authorOid: string; authorName: string; body: string; createdAt: string }
interface Teammate { oid: string; displayName: string }

const STATUS_META: Record<ReviewStatus, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'text-status-yellow border-status-yellow/40' },
  changes: { label: 'Changes requested', cls: 'text-status-red border-status-red/40' },
  approved: { label: 'Approved', cls: 'text-status-green border-status-green/40' },
  closed: { label: 'Closed', cls: 'text-muted-foreground border-border' },
};

export default function ReviewsPage() {
  const { user } = useAuth();
  const myOid = user?.oid;
  const [box, setBox] = useState<'incoming' | 'outgoing'>('incoming');
  const [reviews, setReviews] = useState<PeerReview[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reviews?box=${box}`, { credentials: 'include' });
      const data = await res.json();
      setReviews(data.reviews || []);
      setWarning(data.warning || null);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [box]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Peer Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Lightweight review without a PR — ask a teammate to look at a session, commit, or change.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}><Plus className="h-3.5 w-3.5" /> Request review</Button>
      </div>

      <div className="flex items-center gap-1">
        {(['incoming', 'outgoing'] as const).map((b) => (
          <button key={b} onClick={() => { setBox(b); setSelected(null); }}
            className={`text-xs px-3 py-1.5 rounded border ${box === b ? 'border-foreground/60 bg-foreground/5 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {b === 'incoming' ? 'For me to review' : 'My requests'}
          </button>
        ))}
      </div>

      {warning && <Card className="p-3 text-sm text-amber-500 border-amber-500/40">{warning}</Card>}
      {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-2">
          {!loading && reviews.length === 0 && !warning && (
            <div className="text-sm text-muted-foreground py-8 text-center">Nothing here yet.</div>
          )}
          {reviews.map((r) => (
            <Card key={r.id} onClick={() => setSelected(r.id)}
              className={`p-3 cursor-pointer hover:bg-accent/20 transition-colors ${selected === r.id ? 'border-foreground/40' : ''}`}>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] px-1 py-0">{r.kind}</Badge>
                <span className="text-sm font-medium text-foreground truncate flex-1">{r.title}</span>
                <Badge variant="outline" className={`text-[10px] ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {box === 'incoming' ? `from ${r.requesterName}` : `to ${r.reviewerName}`} · {timeAgo(r.updatedAt)}
                {r.repo ? ` · ${r.repo}` : ''}
              </div>
            </Card>
          ))}
        </div>

        {selected != null && (
          <ReviewDetail id={selected} myOid={myOid} onChanged={load} onClose={() => setSelected(null)} />
        )}
      </div>

      {showForm && <RequestDialog onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); setBox('outgoing'); void load(); }} />}
    </div>
  );
}

function ReviewDetail({ id, myOid, onChanged, onClose }: { id: number; myOid?: string; onChanged: () => void; onClose: () => void }) {
  const [data, setData] = useState<{ review: PeerReview; comments: ReviewComment[] } | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/reviews/${id}`, { credentials: 'include' });
    if (res.ok) setData(await res.json());
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const postComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/reviews/${id}/comments`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      });
      setComment('');
      await load();
    } finally { setBusy(false); }
  };

  const setStatus = async (status: ReviewStatus) => {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/api/reviews/${id}/status`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await load();
      onChanged();
    } finally { setBusy(false); }
  };

  if (!data) return <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>;
  const { review, comments } = data;
  const isReviewer = myOid && review.reviewerOid === myOid;
  const isParty = myOid && (review.reviewerOid === myOid || review.requesterOid === myOid);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-foreground">{review.title}</h2>
          <div className="text-[11px] text-muted-foreground">{review.requesterName} → {review.reviewerName} · {review.kind}{review.refId ? ` · ${review.refId}` : ''}</div>
        </div>
        <Badge variant="outline" className={`text-[10px] ${STATUS_META[review.status].cls}`}>{STATUS_META[review.status].label}</Badge>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>

      {review.context && <p className="text-xs text-foreground/80 whitespace-pre-wrap border-l-2 border-border pl-2">{review.context}</p>}

      <div className="space-y-2">
        {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
        {comments.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" /> {c.authorName} · {timeAgo(c.createdAt)}
            </div>
            <div className="whitespace-pre-wrap pl-1">{c.body}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment(); } }}
          placeholder="Add a comment…"
          className="flex-1 h-8 px-2 text-sm rounded border border-border bg-transparent focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
        <Button size="sm" variant="outline" className="h-8" disabled={busy || !comment.trim()} onClick={() => void postComment()}>Comment</Button>
      </div>

      {review.status !== 'closed' && isParty && (
        <div className="flex items-center gap-2 pt-1 border-t border-border">
          {isReviewer && (
            <>
              <Button size="sm" className="h-7 text-xs gap-1 bg-status-green/20 text-status-green hover:bg-status-green/30" disabled={busy} onClick={() => void setStatus('approved')}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-status-yellow border-status-yellow/40" disabled={busy} onClick={() => void setStatus('changes')}>
                <AlertTriangle className="h-3.5 w-3.5" /> Request changes
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto" disabled={busy} onClick={() => void setStatus('closed')}>Close</Button>
        </div>
      )}
    </Card>
  );
}

function RequestDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [reviewerOid, setReviewerOid] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ReviewKind>('note');
  const [refId, setRefId] = useState('');
  const [repo, setRepo] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/now/board`, { credentials: 'include' });
        const data = await res.json() as { board?: Teammate[] };
        const list = (data.board || []).filter((t) => t.oid && t.displayName);
        setTeammates(list);
        if (list[0]) setReviewerOid(list[0].oid);
      } catch { /* ignore */ }
    })();
  }, []);

  const submit = async () => {
    if (!reviewerOid || !title.trim()) { setError('Pick a reviewer and enter a title.'); return; }
    setBusy(true); setError(null);
    try {
      const reviewer = teammates.find((t) => t.oid === reviewerOid);
      const res = await fetch(`${API_BASE}/api/reviews`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerOid, reviewerName: reviewer?.displayName, title: title.trim(), kind, refId: refId.trim() || undefined, repo: repo.trim() || undefined, context: context.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      onCreated();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <Card className="p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">Request a review</h2>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <label className="block text-xs text-muted-foreground">Reviewer
          <select value={reviewerOid} onChange={(e) => setReviewerOid(e.target.value)} className="mt-1 w-full h-8 px-2 text-sm rounded border border-border bg-background">
            {teammates.length === 0 && <option value="">No teammates found</option>}
            {teammates.map((t) => <option key={t.oid} value={t.oid}>{t.displayName}</option>)}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full h-8 px-2 text-sm rounded border border-border bg-transparent" placeholder="What should they look at?" />
        </label>
        <div className="flex gap-2">
          <label className="block text-xs text-muted-foreground flex-1">Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as ReviewKind)} className="mt-1 w-full h-8 px-2 text-sm rounded border border-border bg-background">
              <option value="note">Note</option>
              <option value="session">Session</option>
              <option value="commit">Commit</option>
            </select>
          </label>
          <label className="block text-xs text-muted-foreground flex-1">{kind === 'session' ? 'Session id' : kind === 'commit' ? 'Commit id' : 'Reference'}
            <input value={refId} onChange={(e) => setRefId(e.target.value)} className="mt-1 w-full h-8 px-2 text-sm rounded border border-border bg-transparent" />
          </label>
        </div>
        <label className="block text-xs text-muted-foreground">Repo (optional)
          <input value={repo} onChange={(e) => setRepo(e.target.value)} className="mt-1 w-full h-8 px-2 text-sm rounded border border-border bg-transparent" />
        </label>
        <label className="block text-xs text-muted-foreground">Context / what to focus on
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} className="mt-1 w-full px-2 py-1 text-sm rounded border border-border bg-transparent resize-none" />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={() => void submit()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send request'}</Button>
        </div>
      </Card>
    </div>
  );
}

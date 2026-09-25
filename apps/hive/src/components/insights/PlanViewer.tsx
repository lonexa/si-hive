import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Share2, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanEntry } from '@/stores/types';
import { useDashboardStore } from '@/stores/dashboard-store';
import { API_BASE } from '@/lib/api-config';

interface PlanViewerProps {
  plans: PlanEntry[];
  onShared?: () => void;
}

function timeAgoShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function renderMarkdown(md: string): string {
  return md
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-muted rounded p-3 my-2 text-xs overflow-x-auto"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-muted rounded px-1 py-0.5 text-xs">$1</code>')
    // H1
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-4 mb-2">$1</h1>')
    // H2
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-3 mb-1.5">$1</h2>')
    // H3
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-2 mb-1">$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm">$1</li>')
    // Tables (basic)
    .replace(/\|(.+)\|/g, (match) => {
      if (match.match(/^\|[\s-|]+\|$/)) return ''; // separator row
      const cells = match.split('|').filter(Boolean).map((c) => c.trim());
      return `<div class="flex gap-4 text-xs py-0.5">${cells.map((c) => `<span class="flex-1">${c}</span>`).join('')}</div>`;
    })
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="text-sm leading-relaxed mb-2">')
    // Single newlines
    .replace(/\n/g, '<br/>');
}

// ---- Share Plan Dialog ----

function SharePlanDialog({ open, onOpenChange, plan, defaultScopeOwner, onShared }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanEntry | null;
  defaultScopeOwner: string;
  onShared?: () => void;
}) {
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [scope, setScope] = useState<'shared' | 'user'>('shared');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && plan) {
      setDescription(plan.title.replace(/^Plan:\s*/i, ''));
      setTags('');
      setScope('shared');
      setError(null);
    }
  }, [open, plan]);

  async function handleShare() {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/sharing/publish-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'plan',
          name: plan.slug,
          description,
          tags,
          scope,
          scope_owner: scope === 'user' ? defaultScopeOwner : '',
        }),
      });
      if (res.ok) {
        onShared?.();
        onOpenChange(false);
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error || 'Failed to share plan');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share Plan with Team</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Plan</label>
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
              {plan?.slug}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of what this plan covers"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Tags</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated, tags"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'shared' | 'user')}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="shared">Shared (visible to everyone)</option>
                <option value="user">User (only me)</option>
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleShare()}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
              Share
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PlanViewer({ plans, onShared }: PlanViewerProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(plans[0]?.slug ?? null);
  const [shareOpen, setShareOpen] = useState(false);
  const [scopeOwner, setScopeOwner] = useState('');
  const [sharedSlug, setSharedSlug] = useState<string | null>(null);
  const sessions = useDashboardStore((s) => s.sessions);

  useEffect(() => {
    fetch(`${API_BASE}/api/kb/config`)
      .then((r) => r.json())
      .then((data: { scopeOwner?: string }) => {
        if (data.scopeOwner) setScopeOwner(data.scopeOwner);
      })
      .catch(() => {});
  }, []);

  const runningSlugs = new Set(
    sessions
      .filter((s) => s.slug && ['working', 'waiting-approval', 'waiting-input'].includes(s.status))
      .map((s) => s.slug!)
  );
  const doneSlugs = new Set(
    sessions
      .filter((s) => s.slug && !['working', 'waiting-approval', 'waiting-input'].includes(s.status))
      .map((s) => s.slug!)
  );

  const selectedPlan = plans.find((p) => p.slug === selectedSlug) ?? null;

  if (plans.length === 0) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        No plans found in ~/.claude/plans/
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Left sidebar — plan list */}
      <div className="w-64 shrink-0 overflow-auto border border-border rounded-md">
        {plans.map((plan) => (
          <button
            key={plan.slug}
            onClick={() => setSelectedSlug(plan.slug)}
            className={cn(
              'w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors',
              'hover:bg-accent/50',
              selectedSlug === plan.slug && 'bg-accent text-accent-foreground'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium leading-tight line-clamp-2">
                {plan.title.replace(/^Plan:\s*/i, '')}
              </span>
              {runningSlugs.has(plan.slug) && (
                <Badge variant="default" className="text-[9px] px-1 py-0 shrink-0 bg-status-green">
                  running
                </Badge>
              )}
              {!runningSlugs.has(plan.slug) && doneSlugs.has(plan.slug) && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                  done
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">{timeAgoShort(plan.modifiedAt)}</span>
          </button>
        ))}
      </div>

      {/* Right panel — rendered markdown */}
      <Card className="flex-1 overflow-auto">
        {selectedPlan ? (
          <>
            <div className="flex items-center justify-between gap-2 px-6 py-3 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-sm font-semibold text-foreground truncate">
                {selectedPlan.title.replace(/^Plan:\s*/i, '')}
              </h2>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-7 shrink-0"
                onClick={() => { setSharedSlug(null); setShareOpen(true); }}
              >
                {sharedSlug === selectedPlan.slug ? (
                  <><CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> Shared</>
                ) : (
                  <><Share2 className="h-3.5 w-3.5" /> Share</>
                )}
              </Button>
            </div>
            <CardContent className="p-6">
              <div
                className="prose prose-sm max-w-none text-foreground"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedPlan.content) }}
              />
            </CardContent>
          </>
        ) : (
          <CardContent className="p-6">
            <div className="text-muted-foreground text-sm">Select a plan to view</div>
          </CardContent>
        )}
      </Card>

      <SharePlanDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        plan={selectedPlan}
        defaultScopeOwner={scopeOwner}
        onShared={() => {
          setSharedSlug(selectedPlan?.slug ?? null);
          onShared?.();
        }}
      />
    </div>
  );
}

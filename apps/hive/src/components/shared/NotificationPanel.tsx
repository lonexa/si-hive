import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Monitor, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardStore } from '@/stores/dashboard-store';
import { cn } from '@/lib/utils';
import { API_BASE } from '@/lib/api-config';
import { useAuth } from '@/auth/AuthProvider';

type Category = 'session' | 'review' | 'build';

interface NotificationItem {
  id: string;
  category: Category;
  message: string;
  detail?: string;
  link: string;
  timestamp: string;
  read: boolean;
}

const CATEGORY_META: Record<Category, { label: string; icon: typeof Monitor }> = {
  session: { label: 'Sessions', icon: Monitor },
  review: { label: 'Reviews', icon: ClipboardCheck },
  build: { label: 'Builds', icon: AlertTriangle },
};

const READ_KEY = 'hive.notif.read';
const POLL_MS = 120_000;

function loadReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]') as string[]); } catch { return new Set(); }
}

export default function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [reviewItems, setReviewItems] = useState<NotificationItem[]>([]);
  const [buildItems, setBuildItems] = useState<NotificationItem[]>([]);
  const events = useDashboardStore((s) => s.events);
  const navigate = useNavigate();

  const persistRead = useCallback((ids: Set<string>) => {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
  }, []);

  // Poll the cross-user sources (cheap; no AI) for review requests + build
  // failures — only for modules that are on.
  const { hasAccess } = useAuth();
  const canReviews = hasAccess('peer-review');
  const canBuilds = hasAccess('main-feed');
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (canReviews) try {
        const res = await fetch(`${API_BASE}/api/reviews?box=incoming`, { credentials: 'include' });
        if (res.ok && !cancelled) {
          const data = await res.json() as { reviews?: Array<{ id: number; title: string; requesterName: string; status: string; updatedAt: string }> };
          setReviewItems((data.reviews || [])
            .filter((r) => r.status === 'requested' || r.status === 'changes')
            .map((r) => ({
              id: `review-${r.id}`,
              category: 'review' as const,
              message: `Review requested: ${r.title}`,
              detail: `from ${r.requesterName}`,
              link: '/reviews',
              timestamp: r.updatedAt,
              read: false,
            })));
        }
      } catch { /* ignore */ }
      if (canBuilds) try {
        const res = await fetch(`${API_BASE}/api/delivery/build-failures?ai=0`, { credentials: 'include' });
        if (res.ok && !cancelled) {
          const data = await res.json() as { failures?: Array<{ id: string; definition: string; buildNumber: string; finishTime: string }> };
          setBuildItems((data.failures || []).slice(0, 10).map((f) => ({
            id: `build-${f.id}`,
            category: 'build' as const,
            message: `Build failed: ${f.definition}`,
            detail: f.buildNumber,
            link: '/main-feed?tab=builds',
            timestamp: f.finishTime,
            read: false,
          })));
        }
      } catch { /* ignore */ }
    };
    void poll();
    const h = window.setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; window.clearInterval(h); };
  }, [canReviews, canBuilds]);

  const sessionItems: NotificationItem[] = useMemo(() => events
    .filter((e) => e.type === 'turn_end' || e.type === 'needs_input' || e.type === 'error')
    .slice(0, 20)
    .map((e) => ({
      id: e.id,
      category: 'session' as const,
      message: e.message,
      detail: e.project,
      link: `/sessions/${e.sessionId}`,
      timestamp: e.timestamp,
      read: false,
    })), [events]);

  const all: NotificationItem[] = useMemo(() => {
    const merged = [...sessionItems, ...reviewItems, ...buildItems]
      .map((n) => ({ ...n, read: readIds.has(n.id) }))
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return merged;
  }, [sessionItems, reviewItems, buildItems, readIds]);

  const visible = filter === 'all' ? all : all.filter((n) => n.category === filter);
  const unreadCount = all.filter((n) => !n.read).length;

  function markAllRead() {
    const next = new Set([...readIds, ...all.map((n) => n.id)]);
    setReadIds(next);
    persistRead(next);
  }

  function handleClick(n: NotificationItem) {
    const next = new Set([...readIds, n.id]);
    setReadIds(next);
    persistRead(next);
    navigate(n.link);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground relative"
        onClick={() => setOpen(!open)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 flex items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-0.5">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-80 bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-medium text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
              {(['all', 'session', 'review', 'build'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border',
                    filter === c ? 'border-foreground/50 bg-foreground/5 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c === 'all' ? 'All' : CATEGORY_META[c].label}
                </button>
              ))}
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {visible.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No recent notifications</div>
              ) : (
                visible.map((n) => {
                  const Icon = CATEGORY_META[n.category].icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={cn(
                        'w-full text-left px-3 py-2 border-b border-border last:border-0 hover:bg-accent/50 transition-colors',
                        !n.read && 'bg-accent/20',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium text-foreground truncate">{n.message}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 pl-5">
                        {n.detail && <span className="truncate">{n.detail}</span>}
                        {n.timestamp && <span>{new Date(n.timestamp).toLocaleTimeString()}</span>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

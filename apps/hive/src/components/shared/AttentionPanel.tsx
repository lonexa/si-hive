import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Inbox, Check, X, Loader2 } from 'lucide-react';
import { cn, timeAgo, sessionStatusLabel, getSessionDisplayName } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';
import { useAuth } from '@/auth/AuthProvider';
import { useHandoffPoll } from '@/hooks/useHandoffPoll';
import QuickActions from './QuickActions';
import type { Session } from '@/stores/types';

/**
 * Global, docked attention queue. Mounted once in AppLayout so it's reachable
 * from every page. Renders nothing unless at least one session needs attention
 * (waiting for input/approval or errored), so it stays out of the way otherwise.
 */
export default function AttentionPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const sessions = useDashboardStore((s) => s.sessions);
  const { isAuthenticated, hasAccess } = useAuth();
  const { handoffs, accept, decline, busyId } = useHandoffPoll(isAuthenticated && hasAccess('team-dashboard'));

  const items = useMemo(() => {
    const needsAttention = (s: Session) =>
      !s.isSubagent &&
      (s.status === 'error' || s.status === 'waiting-input' || s.status === 'waiting-approval');
    return [...sessions].filter(needsAttention).sort((a, b) => {
      // Errors first, then oldest activity first (most stale rises to the top).
      if (a.status === 'error' && b.status !== 'error') return -1;
      if (a.status !== 'error' && b.status === 'error') return 1;
      return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    });
  }, [sessions]);

  const count = items.length + handoffs.length;
  if (count === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-card">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-status-yellow" />
              Needs attention
              <span className="text-xs font-normal text-muted-foreground">({count})</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Collapse"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Incoming session handoffs */}
          {handoffs.length > 0 && (
            <div className="divide-y divide-border border-b border-border bg-primary/5">
              {handoffs.map((h) => (
                <div key={h.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Inbox className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="flex-1 text-sm font-medium text-foreground truncate">
                      Handoff from {h.fromName}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(h.createdAt)}</span>
                  </div>
                  {h.note && <div className="text-[11px] text-muted-foreground mt-0.5 pl-5 truncate">{h.note}</div>}
                  <div className="flex items-center gap-1.5 mt-2 pl-5">
                    <button
                      onClick={() => void accept(h.id)}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-green-500/30 text-green-500 hover:bg-green-500/10 disabled:opacity-50"
                    >
                      {busyId === h.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Accept
                    </button>
                    <button
                      onClick={() => void decline(h.id)}
                      disabled={busyId !== null}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" /> Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="divide-y divide-border">
            {items.map((s) => (
              <div key={s.id} className="px-3 py-2.5">
                <button
                  onClick={() => navigate(`/sessions/${s.id}`)}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        s.status === 'error' ? 'bg-status-red' : 'bg-status-yellow',
                      )}
                    />
                    <span className="flex-1 text-sm font-medium text-foreground truncate">
                      {getSessionDisplayName(s)}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {timeAgo(s.lastActivity)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 pl-4">
                    <span className="text-[11px] text-muted-foreground truncate">{s.project}</span>
                    <span
                      className={cn(
                        'text-[10px] shrink-0',
                        s.status === 'error' ? 'text-status-red' : 'text-status-yellow',
                      )}
                    >
                      {sessionStatusLabel(s.status)}
                    </span>
                  </div>
                </button>
                {s.paneId && (
                  <QuickActions
                    paneId={s.paneId}
                    sessionStatus={s.status}
                    terminalApp={s.terminalApp}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative h-11 w-11 flex items-center justify-center rounded-full bg-status-yellow text-black shadow-lg hover:opacity-90 transition-opacity"
        title="Needs attention"
      >
        <AlertTriangle className="h-5 w-5" />
        {!open && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full bg-status-red text-[9px] font-bold text-white border border-card">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    </div>
  );
}

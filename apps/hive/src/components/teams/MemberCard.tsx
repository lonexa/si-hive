import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Terminal, ExternalLink } from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { API_BASE } from '@/lib/api-config';
import type { TeamMember, Session, TeamTask, SessionActivity } from '@/stores/types';
import { formatModelDisplay } from '@/lib/launch-flags';
import QuickActions from '@/components/shared/QuickActions';
import SendInput from '@/components/shared/SendInput';
import ActivityLine from '@/components/shared/ActivityLine';

interface MemberCardProps {
  member: TeamMember;
  session?: Session;
  currentTask?: TeamTask;
  sessionActivity?: SessionActivity;
  onNavigate?: () => void;
  leadPaneId?: string;
}

function memberStatusColor(member: TeamMember, session?: Session): string {
  if (session?.status === 'error') return 'bg-status-red';
  if (session?.status === 'waiting-input' || session?.status === 'waiting-approval') return 'bg-status-yellow';
  if (member.isActive) return 'bg-status-green';
  return 'bg-status-gray';
}

function memberStatusLabel(member: TeamMember, session?: Session): string {
  if (session?.status === 'error') return 'Error';
  if (session?.status === 'waiting-input') return 'Needs input';
  if (session?.status === 'waiting-approval') return 'Needs approval';
  if (session?.status === 'working') return 'Working';
  if (member.isActive) return 'Active';
  return 'Idle';
}

async function handleFocus(paneId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/actions/focus-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paneId }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('[focus]', paneId, '→', data.error ?? 'unknown error');
    }
  } catch (err) {
    console.warn('[focus] fetch failed for', paneId, err);
  }
}

export default function MemberCard({ member, session, currentTask, sessionActivity, onNavigate, leadPaneId }: MemberCardProps) {
  const statusColor = memberStatusColor(member, session);
  const statusLabel = memberStatusLabel(member, session);
  const isWorking = session?.status === 'working' || member.isActive;
  // Prefer session.paneId (from process discovery), then lead's paneId (in-process agents share lead's terminal),
  // then member.tmuxPaneId (from config) — but skip non-routable values like "in-process"
  const rawPaneId = session?.paneId || leadPaneId || member.tmuxPaneId;
  const effectivePaneId = rawPaneId && rawPaneId !== 'in-process' ? rawPaneId : '';
  const terminalApp = session?.terminalApp ?? (effectivePaneId ? 'tmux' as const : undefined);

  return (
    <Card className={cn(onNavigate && 'transition-colors hover:border-foreground/30')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div
            className={cn('flex items-center gap-2 min-w-0', onNavigate && 'cursor-pointer')}
            onClick={onNavigate}
            role={onNavigate ? 'button' : undefined}
          >
            <div
              className={cn(
                'h-2.5 w-2.5 rounded-full shrink-0',
                statusColor,
                isWorking && 'animate-pulse'
              )}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn('text-sm font-medium truncate', onNavigate && 'hover:underline')}>{member.name}</span>
                <span className="text-xs text-muted-foreground">{member.agentType}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted-foreground">{statusLabel}</span>
                {member.model && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {formatModelDisplay(undefined, member.model)}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!effectivePaneId}
            title={effectivePaneId ? `Focus ${effectivePaneId}` : 'No active terminal'}
            onClick={() => effectivePaneId && handleFocus(effectivePaneId)}
          >
            <Terminal className="h-3 w-3 mr-1" />
            Focus
          </Button>
        </div>

        {/* Activity line */}
        <ActivityLine activity={sessionActivity} />

        {/* Current task */}
        {currentTask && (
          <div className="mt-3 p-2 rounded bg-secondary/50 text-xs">
            <span className="text-muted-foreground">Working on: </span>
            <span className="text-foreground">{currentTask.subject}</span>
          </div>
        )}

        {/* Quick actions for waiting states */}
        {session && effectivePaneId && (
          <QuickActions
            paneId={effectivePaneId}
            sessionStatus={session.status}
            terminalApp={terminalApp}
          />
        )}

        {/* Send free-text input */}
        {effectivePaneId && session && (
          <SendInput paneId={effectivePaneId} terminalApp={terminalApp} />
        )}

        {/* Pane ID */}
        {effectivePaneId && (
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            <span className="font-mono">{effectivePaneId}</span>
          </div>
        )}

        {/* Last activity */}
        {session?.lastActivity && (
          <div className="mt-1 text-xs text-muted-foreground">
            Last activity {timeAgo(session.lastActivity)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

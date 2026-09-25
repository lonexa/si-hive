import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, HardDrive, ListTodo, EyeOff } from 'lucide-react';
import { cn, timeAgo, sessionStatusLabel, getSessionDisplayName, shortProject } from '@/lib/utils';
import type { Session, SessionActivity } from '@/stores/types';
import { useDashboardStore } from '@/stores/dashboard-store';
import ActivityLine from '@/components/shared/ActivityLine';
import QuickActions from '@/components/shared/QuickActions';

interface SessionCardProps {
  session: Session;
  teamInfo?: { teamName: string; memberName: string };
  paneId?: string;
  sessionActivity?: SessionActivity;
  compact?: boolean;
}

function statusDotColor(status: Session['status']): string {
  switch (status) {
    case 'working': return 'bg-status-green';
    case 'waiting-input':
    case 'waiting-approval': return 'bg-status-yellow';
    case 'error': return 'bg-status-red';
    default: return 'bg-status-gray';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SessionCard({ session, teamInfo, paneId, sessionActivity, compact }: SessionCardProps) {
  const navigate = useNavigate();
  const queueData = useDashboardStore((s) => s.queues[session.id]);
  const isActive = session.status === 'working';
  const project = shortProject(session.project);
  const displayName = getSessionDisplayName(session, teamInfo, 50);
  const showPrompt = displayName !== project;
  const needsAction = session.status === 'waiting-input' || session.status === 'waiting-approval' || session.status === 'error';

  // Queue info
  const pendingCount = queueData?.tasks?.filter((t) => t.status === 'pending').length ?? 0;
  const hasActiveQueueTask = queueData?.tasks?.some((t) => t.status === 'in_progress' || t.status === 'sending');

  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground min-w-0">
        <div
          className={cn(
            'h-1.5 w-1.5 rounded-full shrink-0',
            statusDotColor(session.status),
            isActive && 'animate-pulse'
          )}
        />
        <span className="truncate min-w-0 flex-1">
          {getSessionDisplayName(session, null, 40)}
        </span>
        {session.provider && session.provider !== 'claude' && (
          <span className={cn(
            'text-[8px] font-mono font-bold px-0.5 rounded shrink-0',
            session.provider === 'gemini' && 'bg-blue-500/20 text-blue-400',
            session.provider === 'codex' && 'bg-green-500/20 text-green-400',
          )}>
            {session.provider === 'gemini' ? 'G' : 'CX'}
          </span>
        )}
        {(pendingCount > 0 || hasActiveQueueTask) && (
          <ListTodo className="h-3 w-3 text-blue-400 shrink-0" />
        )}
        <span className="shrink-0">{timeAgo(session.lastActivity)}</span>
      </div>
    );
  }

  return (
    <Card
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => navigate(`/sessions/${session.id}`)}
    >
      <CardContent className="p-3">
        {/* Row 1: status dot + project + time */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'h-2 w-2 rounded-full shrink-0',
              statusDotColor(session.status),
              isActive && 'animate-pulse'
            )}
          />
          <span className="text-xs font-semibold truncate">{project}</span>
          {session.provider && session.provider !== 'claude' && (
            <span className={cn(
              'text-[9px] font-mono font-bold px-1 py-0 rounded shrink-0',
              session.provider === 'gemini' && 'bg-blue-500/20 text-blue-400',
              session.provider === 'codex' && 'bg-green-500/20 text-green-400',
            )}>
              {session.provider === 'gemini' ? 'G' : 'CX'}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {timeAgo(session.lastActivity)}
          </span>
        </div>

        {/* Row 2: prompt snippet (if different from project) */}
        {showPrompt && (
          <p className="text-[11px] text-muted-foreground truncate mt-1 ml-4">
            {displayName}
          </p>
        )}

        {/* Row 3: status badge + file size + queue badge */}
        <div className="flex items-center gap-1.5 mt-1.5 ml-4">
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0',
              session.status === 'error' && 'text-status-red border-status-red/30',
              (session.status === 'waiting-input' || session.status === 'waiting-approval') && 'text-status-yellow border-status-yellow/30',
              session.status === 'working' && 'text-status-green border-status-green/30',
              session.status === 'done' && 'text-status-done border-status-done/30'
            )}
          >
            {sessionStatusLabel(session.status)}
          </Badge>
          {session.incognito && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 gap-0.5 border-violet-500/40 text-violet-300"
              title="Incognito — nothing about this session is logged off this machine"
            >
              <EyeOff className="h-2.5 w-2.5" />
              Incognito
            </Badge>
          )}
          {session.fileSize > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              {formatFileSize(session.fileSize)}
            </span>
          )}
          {(pendingCount > 0 || hasActiveQueueTask) && (
            <span className="flex items-center gap-0.5 text-[10px] text-blue-400">
              <ListTodo className="h-3 w-3" />
              {pendingCount > 0 ? `${pendingCount} queued` : 'running'}
            </span>
          )}
        </div>

        {/* Activity line when actively working */}
        {sessionActivity?.active && (
          <div className="ml-4 mt-1">
            <ActivityLine activity={sessionActivity} />
          </div>
        )}

        {/* Quick actions for waiting states */}
        {paneId && needsAction && (
          <div className="mt-1.5 ml-4" onClick={(e) => e.stopPropagation()}>
            <QuickActions paneId={paneId} sessionStatus={session.status} terminalApp={session.terminalApp} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, HardDrive, ListTodo, EyeOff } from 'lucide-react';
import { cn, timeAgo, sessionStatusLabel, getSessionDisplayName, shortProject } from '@/lib/utils';
import { PROVIDER_SHORT_NAMES } from '@/lib/launch-flags';
import ActivityLine from '@/components/shared/ActivityLine';
import QuickActions from '@/components/shared/QuickActions';
import DeleteSessionButton from './DeleteSessionButton';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { Session, SessionActivity, TeamTask } from '@/stores/types';

interface KanbanCardProps {
  session: Session;
  sessionActivity?: SessionActivity;
  teamInfo?: { teamName: string; memberName: string };
  paneId?: string;
  tasks: TeamTask[];
  subagents: Session[];
  subagentActivities: Record<string, SessionActivity>;
  sessionTeamMap: Map<string, { teamName: string; memberName: string }>;
}

function statusDotColor(status: Session['status']): string {
  switch (status) {
    case 'working': return 'bg-status-green';
    case 'done': return 'bg-status-done';
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

export default function KanbanCard({
  session,
  sessionActivity,
  teamInfo,
  paneId,
}: KanbanCardProps) {
  const navigate = useNavigate();
  const queueData = useDashboardStore((s) => s.queues[session.id]);
  const isActive = session.status === 'working';
  const needsAction = session.status === 'waiting-input' || session.status === 'waiting-approval' || session.status === 'error';
  const displayName = getSessionDisplayName(session, teamInfo, 50);
  const project = shortProject(session.project);

  // Show project separately only if displayName isn't already the project name
  const showProject = displayName !== project;

  // Queue info
  const pendingCount = queueData?.tasks?.filter((t) => t.status === 'pending').length ?? 0;
  const hasActiveQueueTask = queueData?.tasks?.some((t) => t.status === 'in_progress' || t.status === 'sending');

  return (
    <Card
      className="group cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={() => navigate(`/sessions/${session.id}`)}
    >
      <CardContent className="p-2.5">
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
          {session.provider && (
            <span className={cn(
              'text-[9px] font-mono font-bold px-1 py-0.5 rounded shrink-0 leading-none',
              session.provider === 'gemini' && 'bg-blue-500/20 text-blue-400',
              session.provider === 'codex' && 'bg-green-500/20 text-green-400',
              session.provider === 'claude' && 'bg-orange-500/20 text-orange-400',
            )}>
              {PROVIDER_SHORT_NAMES[session.provider]}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            {timeAgo(session.lastActivity)}
          </span>
          <DeleteSessionButton
            sessionId={session.id}
            label={displayName}
            className="-my-1 -mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          />
        </div>

        {/* Row 2: prompt / display name (if different from project) */}
        {showProject && (
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

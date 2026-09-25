import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import KanbanCard from './KanbanCard';
import type { Session, SessionActivity, TeamTask } from '@/stores/types';

interface KanbanColumnProps {
  title: string;
  color: string;
  count: number;
  sessions: Session[];
  sessionActivities: Record<string, SessionActivity>;
  sessionTeamMap: Map<string, { teamName: string; memberName: string }>;
  sessionPaneMap: Map<string, string>;
  tasksBySession: Record<string, TeamTask[]>;
  subagentMap: Map<string, Session[]>;
}

export default function KanbanColumn({
  title,
  color,
  count,
  sessions,
  sessionActivities,
  sessionTeamMap,
  sessionPaneMap,
  tasksBySession,
  subagentMap,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col min-w-[320px] max-w-[380px] bg-secondary/30 rounded-lg shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
        <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', color)} />
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="secondary" className="ml-auto">
          {count}
        </Badge>
      </div>

      {/* Scrollable card list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No sessions</p>
          ) : (
            sessions.map((session) => {
              const subagents = subagentMap.get(session.id) ?? [];
              const tasks = tasksBySession[session.id] ?? [];

              // Build subagent activity map for this session's subagents
              const subagentActivities: Record<string, SessionActivity> = {};
              for (const sub of subagents) {
                const activity = sessionActivities[sub.id];
                if (activity) {
                  subagentActivities[sub.id] = activity;
                }
              }

              return (
                <KanbanCard
                  key={session.id}
                  session={session}
                  sessionActivity={sessionActivities[session.id]}
                  teamInfo={sessionTeamMap.get(session.id)}
                  paneId={sessionPaneMap.get(session.id)}
                  tasks={tasks}
                  subagents={subagents}
                  subagentActivities={subagentActivities}
                  sessionTeamMap={sessionTeamMap}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

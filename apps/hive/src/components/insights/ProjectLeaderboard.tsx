import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectActivity, GitProjectStats } from '@/stores/types';

interface ProjectLeaderboardProps {
  projects: ProjectActivity[];
  gitStats: GitProjectStats[];
  ticketCounts?: Record<string, number>;
  timeRange: 'today' | 'week' | 'month' | 'all';
}

function getSessionCount(p: ProjectActivity, timeRange: string): number {
  if (timeRange === 'today') return p.sessionsToday;
  if (timeRange === 'week') return p.sessionsThisWeek;
  return p.sessionsTotal;
}

export default function ProjectLeaderboard({ projects, gitStats, ticketCounts, timeRange }: ProjectLeaderboardProps) {
  const gitByProject = new Map(gitStats.map((g) => [g.project, g]));

  const ranked = projects
    .map((p) => ({
      ...p,
      displaySessions: getSessionCount(p, timeRange),
      git: gitByProject.get(p.project),
      tickets: ticketCounts?.[p.project] ?? 0,
    }))
    .filter((p) => p.displaySessions > 0)
    .sort((a, b) => b.displaySessions - a.displaySessions);

  const maxSessions = ranked[0]?.displaySessions || 1;

  if (ranked.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Project Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm py-4 text-center">
            No project activity for this period.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Project Leaderboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {ranked.map((p, i) => {
          const barWidth = (p.displaySessions / maxSessions) * 100;
          return (
            <div key={p.project} className="group">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{p.project}</span>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span>{p.displaySessions} session{p.displaySessions !== 1 ? 's' : ''}</span>
                      {p.git && (
                        <span className="text-green-400">+{p.git.linesAdded.toLocaleString()}</span>
                      )}
                      {p.git && p.git.linesDeleted > 0 && (
                        <span className="text-red-400">-{p.git.linesDeleted.toLocaleString()}</span>
                      )}
                      {p.tickets > 0 && (
                        <span>{p.tickets} ticket{p.tickets !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GitProjectStats } from '@/stores/types';

interface GitImpactProps {
  gitStats: GitProjectStats[];
}

export default function GitImpact({ gitStats }: GitImpactProps) {
  if (gitStats.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Git Impact</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm py-4 text-center">
            Git stats unavailable. No project directories with git repos found.
          </div>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...gitStats].sort((a, b) => (b.linesAdded + b.linesDeleted) - (a.linesAdded + a.linesDeleted));
  const maxLines = Math.max(...sorted.map((g) => Math.max(g.linesAdded, g.linesDeleted)), 1);
  const totalAdded = sorted.reduce((sum, g) => sum + g.linesAdded, 0);
  const totalDeleted = sorted.reduce((sum, g) => sum + g.linesDeleted, 0);
  const totalCommits = sorted.reduce((sum, g) => sum + g.commits, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Git Impact</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>
            <span className="text-green-400 font-medium">+{totalAdded.toLocaleString()}</span> added
          </span>
          <span>
            <span className="text-red-400 font-medium">-{totalDeleted.toLocaleString()}</span> deleted
          </span>
          <span>{totalCommits} commit{totalCommits !== 1 ? 's' : ''}</span>
        </div>

        <div className="space-y-2">
          {sorted.map((g) => (
            <div key={g.project} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium">{g.project}</span>
                <span className="text-muted-foreground shrink-0 ml-2">{g.commits} commit{g.commits !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex gap-0.5 h-3">
                <div
                  className="bg-green-500 rounded-l transition-all duration-500"
                  style={{ width: `${(g.linesAdded / maxLines) * 50}%` }}
                  title={`+${g.linesAdded} lines added`}
                />
                <div
                  className="bg-red-500 rounded-r transition-all duration-500"
                  style={{ width: `${(g.linesDeleted / maxLines) * 50}%` }}
                  title={`-${g.linesDeleted} lines deleted`}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

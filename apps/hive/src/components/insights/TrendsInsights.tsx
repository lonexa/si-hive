import { Card, CardContent } from '@/components/ui/card';
import type { DeveloperInsights, GitProjectStats } from '@/stores/types';

interface TrendsInsightsProps {
  insights: DeveloperInsights;
}

interface InsightItem {
  icon: string;
  text: string;
  highlight?: boolean;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function buildInsights(insights: DeveloperInsights): InsightItem[] {
  const items: InsightItem[] = [];

  // Streak
  if (insights.currentStreak > 0) {
    const streakText = insights.currentStreak >= insights.longestStreak && insights.currentStreak > 3
      ? `${insights.currentStreak}-day streak — that's your longest!`
      : `${insights.currentStreak}-day streak! Your longest was ${insights.longestStreak} days.`;
    items.push({ icon: '\u{1F525}', text: streakText, highlight: insights.currentStreak >= 7 });
  }

  // Most active project
  if (insights.mostActiveProject !== 'None') {
    const topProject = insights.projectActivity[0];
    if (topProject) {
      items.push({
        icon: '\u{1F3AF}',
        text: `${insights.mostActiveProject} is your most active project this week (${topProject.sessionsThisWeek} sessions)`,
      });
    }
  }

  // Most active day
  if (insights.mostActiveDay !== 'N/A') {
    items.push({
      icon: '\u{1F4C5}',
      text: `${insights.mostActiveDay}s are your most productive day`,
    });
  }

  // Peak hour
  items.push({
    icon: '\u{23F0}',
    text: `Your peak coding hour is ${formatHour(insights.peakHour)}`,
  });

  // Git lines
  const totalAdded = insights.gitStats.reduce((sum: number, g: GitProjectStats) => sum + g.linesAdded, 0);
  if (totalAdded > 0) {
    const projectCount = insights.gitStats.length;
    items.push({
      icon: '\u{1F4DD}',
      text: `You've added ${totalAdded.toLocaleString()} lines of code this week across ${projectCount} project${projectCount !== 1 ? 's' : ''}`,
    });
  }

  // Total days active
  if (insights.totalDaysActive > 0) {
    items.push({
      icon: '\u{1F4CA}',
      text: `${insights.totalDaysActive} total days active with AI`,
    });
  }

  // KB
  if (insights.kbStats?.totalEntries) {
    items.push({
      icon: '\u{1F4DA}',
      text: `${insights.kbStats.totalEntries} knowledge base entries across ${Object.keys(insights.kbStats.categoryCounts).length} categories`,
    });
  }

  // Tickets
  if (insights.ticketStats?.configured) {
    const { completedThisSprint, inProgress } = insights.ticketStats;
    if (completedThisSprint > 0 || inProgress > 0) {
      items.push({
        icon: '\u{1F3AB}',
        text: `${completedThisSprint} tickets completed this sprint, ${inProgress} in progress`,
      });
    }
  }

  return items;
}

export default function TrendsInsights({ insights }: TrendsInsightsProps) {
  const items = buildInsights(insights);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((item, i) => (
        <Card key={i} className={item.highlight ? 'border-yellow-500/30' : ''}>
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <span className="text-lg shrink-0">{item.icon}</span>
            <span className="text-sm text-muted-foreground">{item.text}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

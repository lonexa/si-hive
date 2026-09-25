import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { StatsCache, DeveloperInsights } from '@/stores/types';
import BarChart from './BarChart';
import ActivityHeatmap from './ActivityHeatmap';
import ProjectLeaderboard from './ProjectLeaderboard';
import GitImpact from './GitImpact';
import TicketsSummary from './TicketsSummary';
import KBSummary from './KBSummary';
import TrendsInsights from './TrendsInsights';

interface UsageStatsProps {
  stats: StatsCache | null;
  devInsights: DeveloperInsights | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function modelDisplayName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model;
}

const MODEL_COLORS: Record<string, string> = {
  opus: 'bg-purple-500',
  sonnet: 'bg-blue-500',
  haiku: 'bg-emerald-500',
};

function getModelColor(model: string): string {
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (model.includes(key)) return color;
  }
  return 'bg-gray-500';
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

type TimeRange = 'today' | 'week' | 'month' | 'all';

export default function UsageStats({ stats, devInsights }: UsageStatsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('week');

  if (!stats && !devInsights) {
    return (
      <div className="text-muted-foreground text-sm py-8 text-center">
        No data found. Start using AI to see your developer insights.
      </div>
    );
  }

  // Compute highlight values
  const sessionsToday = devInsights?.projectActivity.reduce((s, p) => s + p.sessionsToday, 0) ?? 0;
  const activeProjects = devInsights?.projectActivity.filter((p) => p.sessionsThisWeek > 0).length ?? 0;
  const totalLinesAdded = devInsights?.gitStats.reduce((s, g) => s + g.linesAdded, 0) ?? 0;
  const streak = devInsights?.currentStreak ?? 0;
  const ticketsInProgress = devInsights?.ticketStats?.inProgress ?? 0;
  const kbItems = devInsights?.kbStats?.totalEntries ?? 0;
  const peakHour = devInsights?.peakHour ?? 0;
  const mostActive = devInsights?.mostActiveProject ?? 'N/A';

  // Build stacked bar chart data from daily activity + project breakdown
  const chartData = stats?.dailyActivity.map((d) => ({
    label: d.date.slice(5),
    value: d.sessionCount || d.messageCount,
  })) ?? [];

  const modelEntries = stats ? Object.entries(stats.modelUsage) : [];
  const totalCost = modelEntries.reduce((sum, [, usage]) => sum + (usage.costUSD ?? 0), 0);

  return (
    <div className="space-y-6 pt-4">
      {/* Time range selector */}
      <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">This Week</TabsTrigger>
          <TabsTrigger value="month">This Month</TabsTrigger>
          <TabsTrigger value="all">All Time</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Highlight cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <HighlightCard label="Sessions Today" value={String(sessionsToday)} />
        <HighlightCard label="Active Projects" value={String(activeProjects)} />
        <HighlightCard label="Lines Written" value={totalLinesAdded > 0 ? `+${totalLinesAdded.toLocaleString()}` : '—'} color="text-green-400" />
        <HighlightCard label="Streak" value={streak > 0 ? `${streak} days` : '—'} color={streak >= 7 ? 'text-yellow-400' : undefined} />
        <HighlightCard label="Tickets Active" value={devInsights?.ticketStats ? String(ticketsInProgress) : '—'} />
        <HighlightCard label="KB Items" value={devInsights?.kbStats ? String(kbItems) : '—'} />
        <HighlightCard label="Peak Hour" value={formatHour(peakHour)} />
        <HighlightCard label="Most Active" value={mostActive} small />
      </div>

      {/* Project Leaderboard */}
      {devInsights && (
        <ProjectLeaderboard
          projects={devInsights.projectActivity}
          gitStats={devInsights.gitStats}
          timeRange={timeRange}
        />
      )}

      {/* Daily activity chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={chartData} maxHeight={140} barColor="bg-blue-500" />
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              {chartData.length <= 14
                ? chartData.map((d, i) => (
                    <span key={i} className="flex-1 text-center">{d.label}</span>
                  ))
                : [0, Math.floor(chartData.length / 2), chartData.length - 1].map((idx) => (
                    <span key={idx} className="flex-1 text-center">{chartData[idx]?.label}</span>
                  ))
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two-column: Git Impact + Tickets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {devInsights && <GitImpact gitStats={devInsights.gitStats} />}
        {devInsights && <TicketsSummary ticketStats={devInsights.ticketStats} />}
      </div>

      {/* Two-column: Activity Heatmap + KB */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Activity by Hour</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityHeatmap hourCounts={stats.hourCounts} />
            </CardContent>
          </Card>
        )}
        {devInsights && <KBSummary kbStats={devInsights.kbStats} />}
      </div>

      {/* Model usage breakdown */}
      {modelEntries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Model Usage
              {totalCost > 0 && <span className="text-green-400 ml-2 font-normal">${totalCost.toFixed(2)} total</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {modelEntries.map(([model, usage]) => {
              const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens;
              return (
                <div key={model} className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full shrink-0 ${getModelColor(model)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{modelDisplayName(model)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTokens(totalTokens)} tokens · {formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out
                      {usage.costUSD > 0 && ` · $${usage.costUSD.toFixed(2)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Trends & Insights */}
      {devInsights && <TrendsInsights insights={devInsights} />}
    </div>
  );
}

function HighlightCard({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-2 px-3">
        <div className={`${small ? 'text-lg' : 'text-2xl'} font-bold truncate ${color ?? ''}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground truncate">{label}</div>
      </CardContent>
    </Card>
  );
}

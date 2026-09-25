import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  CalendarDays,
  Clock,
  Zap,
} from 'lucide-react';
import AISessionButton from '@/components/shared/AISessionButton';
import { calendarEvent as calendarEventPrompt } from '@/lib/prompt-templates';
import { resolveDefaultProjectDir } from '@/lib/project-mappings';

import { API_BASE } from '@/lib/api-config';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  type: 'sprint' | 'sprint-end' | 'schedule';
  color: string;
  details?: string;
}

interface CalendarData {
  events: CalendarEvent[];
  errors: string[];
  month: number;
  year: number;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  sprint: 'Sprint Start',
  'sprint-end': 'Sprint End',
  schedule: 'Scheduled Task',
};

const EVENT_TYPE_ICONS: Record<string, typeof CalendarDays> = {
  sprint: CalendarDays,
  'sprint-end': Clock,
  schedule: Zap,
};

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getWeekDates(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(monday), end: fmt(friday) };
}

export default function CalendarTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState('');

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    try {
      setLoading(true);
      setError(null);
      const monthStr = `${y}-${String(m).padStart(2, '0')}`;
      const resp = await fetch(`${API_BASE}/api/dashboard/calendar?month=${monthStr}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result: CalendarData = await resp.json();
      setData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar(year, month);
  }, [year, month, fetchCalendar]);

  useEffect(() => { resolveDefaultProjectDir().then(setProjectDir); }, []);

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear(y => y - 1);
      setMonth(12);
    } else {
      setMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear(y => y + 1);
      setMonth(1);
    } else {
      setMonth(m => m + 1);
    }
  };

  const handleToday = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
  };

  // Group events by date
  const eventsByDate = useMemo(() => {
    if (!data) return new Map<string, CalendarEvent[]>();
    const map = new Map<string, CalendarEvent[]>();
    for (const event of data.events) {
      const existing = map.get(event.date) ?? [];
      existing.push(event);
      map.set(event.date, existing);
    }
    return map;
  }, [data]);

  // "What's due this week" summary
  const thisWeekEvents = useMemo(() => {
    if (!data) return [];
    const { start, end } = getWeekDates();
    return data.events.filter(e => e.date >= start && e.date <= end);
  }, [data]);

  // Summary counts by type
  const typeCounts = useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = {};
    for (const event of data.events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }, [data]);

  const today = getToday();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = getFirstDayOfWeek(year, month);
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Build calendar grid
  const calendarCells: Array<{ day: number | null; dateStr: string }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarCells.push({ day: null, dateStr: '' });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarCells.push({ day: d, dateStr });
  }
  // Pad remaining cells to complete the last week
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push({ day: null, dateStr: '' });
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading calendar...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load calendar: {error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => fetchCalendar(year, month)}>
            <RefreshCw className="h-3 w-3 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Events</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="text-2xl font-bold">{data?.events.length ?? 0}</div>
          </CardContent>
        </Card>
        {Object.entries(typeCounts).map(([type, count]) => {
          const Icon = EVENT_TYPE_ICONS[type] ?? CalendarDays;
          return (
            <Card key={type}>
              <CardHeader className="pb-2 pt-3 px-3">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Icon className="h-3 w-3" />
                  {EVENT_TYPE_LABELS[type] ?? type}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="text-2xl font-bold">{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Partial errors banner */}
      {data && data.errors.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0" />
          <div>
            <p className="font-medium text-yellow-400">Some data sources failed to load:</p>
            <ul className="mt-1 space-y-0.5 text-xs text-yellow-300">
              {data.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* What's Due This Week */}
      {thisWeekEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm font-medium">Due This Week</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="flex flex-wrap gap-2">
              {thisWeekEvents.map(event => {
                const Icon = EVENT_TYPE_ICONS[event.type] ?? CalendarDays;
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    style={{ borderColor: event.color + '40' }}
                  >
                    <Icon className="h-3 w-3" style={{ color: event.color }} />
                    <span className="font-medium">{event.title}</span>
                    <span className="text-muted-foreground">{event.date}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold min-w-[180px] text-center">
            {formatMonthYear(year, month)}
          </h2>
          <Button variant="outline" size="sm" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleToday}>
            Today
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchCalendar(year, month)}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-md border overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {weekDays.map(day => (
            <div key={day} className="px-2 py-1.5 text-xs font-medium text-center text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div className="grid grid-cols-7">
          {calendarCells.map((cell, idx) => {
            const isToday = cell.dateStr === today;
            const events = cell.dateStr ? eventsByDate.get(cell.dateStr) ?? [] : [];
            const isWeekend = idx % 7 === 0 || idx % 7 === 6;

            return (
              <div
                key={idx}
                className={`
                  min-h-[90px] border-b border-r p-1 transition-colors
                  ${cell.day === null ? 'bg-muted/20' : 'hover:bg-muted/30'}
                  ${isToday ? 'bg-primary/5' : ''}
                  ${isWeekend && cell.day !== null ? 'bg-muted/10' : ''}
                `}
              >
                {cell.day !== null && (
                  <>
                    <div className="flex items-center justify-between mb-0.5">
                      <span
                        className={`
                          text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                          ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}
                        `}
                      >
                        {cell.day}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {events.slice(0, 3).map(event => (
                        <div
                          key={event.id}
                          className="text-[10px] leading-tight px-1 py-0.5 rounded truncate cursor-default"
                          style={{
                            backgroundColor: event.color + '20',
                            color: event.color,
                            borderLeft: `2px solid ${event.color}`,
                          }}
                          title={event.details ? `${event.title}\n${event.details}` : event.title}
                        >
                          {event.title}
                        </div>
                      ))}
                      {events.length > 3 && (
                        <div className="text-[10px] text-muted-foreground px-1">
                          +{events.length - 3} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium">Legend:</span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#3b82f620', border: '1px solid #3b82f6' }} />
          Sprint Start
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#ef444420', border: '1px solid #ef4444' }} />
          Sprint End
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: '#8b5cf620', border: '1px solid #8b5cf6' }} />
          Scheduled Task
        </span>
      </div>

      {/* Event List */}
      {data && data.events.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm font-medium">All Events This Month</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1.5">
              {[...data.events]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(event => {
                  const Icon = EVENT_TYPE_ICONS[event.type] ?? CalendarDays;
                  return (
                    <div
                      key={event.id}
                      className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/30"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: event.color }} />
                      <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                        {event.date}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] shrink-0"
                        style={{ borderColor: event.color + '60', color: event.color }}
                      >
                        {EVENT_TYPE_LABELS[event.type] ?? event.type}
                      </Badge>
                      <span className="font-medium truncate">{event.title}</span>
                      {event.details && (
                        <span className="text-xs text-muted-foreground truncate">
                          {event.details}
                        </span>
                      )}
                      <AISessionButton
                        cwd={projectDir}
                        prompt={calendarEventPrompt(
                          event.title,
                          event.date,
                          event.details || EVENT_TYPE_LABELS[event.type] || event.type,
                        )}
                        variant="icon-only"
                        size="icon"
                        tooltip="Prepare"
                        className="ml-auto h-6 w-6 shrink-0"
                      />
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

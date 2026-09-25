import http from 'node:http';
import { loadConfig } from '../config.js';
import { getTracker } from '../integrations/registry.js';
import { getAllSchedules } from '../db.js';
import { sendJson } from '../../../../packages/shared/src/server/http-utils.js';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;          // YYYY-MM-DD
  endDate?: string;      // YYYY-MM-DD for multi-day events
  type: 'sprint' | 'sprint-end' | 'schedule';
  color: string;
  details?: string;
}

interface CalendarData {
  events: CalendarEvent[];
  errors: string[];       // partial-failure indicators
  month: number;
  year: number;
}

async function fetchSprintEvents(year: number, month: number): Promise<CalendarEvent[]> {
  const tracker = getTracker(loadConfig());
  if (!tracker?.capabilities.has('iterations') || !tracker.listIterations) return [];
  const iterations = await tracker.listIterations();

  const events: CalendarEvent[] = [];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  for (const iter of iterations) {
    const startDate = iter.startDate ? new Date(iter.startDate) : null;
    const finishDate = iter.endDate ? new Date(iter.endDate) : null;

    if (!startDate && !finishDate) continue;

    // Check if this iteration overlaps with the requested month
    const iterStart = startDate ?? finishDate!;
    const iterEnd = finishDate ?? startDate!;

    if (iterEnd < monthStart || iterStart > monthEnd) continue;

    // Sprint start event
    if (startDate && startDate >= monthStart && startDate <= monthEnd) {
      events.push({
        id: `sprint-start-${iter.id}`,
        title: `${iter.name} starts`,
        date: startDate.toISOString().slice(0, 10),
        endDate: finishDate ? finishDate.toISOString().slice(0, 10) : undefined,
        type: 'sprint',
        color: '#3b82f6',
        details: finishDate ? `Ends ${finishDate.toISOString().slice(0, 10)}` : undefined,
      });
    }

    // Sprint end event
    if (finishDate && finishDate >= monthStart && finishDate <= monthEnd) {
      events.push({
        id: `sprint-end-${iter.id}`,
        title: `${iter.name} ends`,
        date: finishDate.toISOString().slice(0, 10),
        type: 'sprint-end',
        color: '#ef4444',
        details: startDate ? `Started ${startDate.toISOString().slice(0, 10)}` : undefined,
      });
    }
  }

  return events;
}

function fetchScheduleEvents(year: number, month: number): CalendarEvent[] {
  const schedules = getAllSchedules();
  const events: CalendarEvent[] = [];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;

    // If there's a next run date within the month, show it
    if (schedule.nextRunAt) {
      const nextRun = new Date(schedule.nextRunAt);
      if (nextRun >= monthStart && nextRun <= monthEnd) {
        events.push({
          id: `schedule-${schedule.id}`,
          title: schedule.name,
          date: nextRun.toISOString().slice(0, 10),
          type: 'schedule',
          color: '#8b5cf6',
          details: schedule.cronExpression
            ? `Cron: ${schedule.cronExpression}`
            : schedule.intervalMs
              ? `Every ${Math.round(schedule.intervalMs / 60000)}m`
              : undefined,
        });
      }
    }

    // If there's a last run in this month, show it too
    if (schedule.lastRunAt) {
      const lastRun = new Date(schedule.lastRunAt);
      if (lastRun >= monthStart && lastRun <= monthEnd) {
        events.push({
          id: `schedule-last-${schedule.id}`,
          title: `${schedule.name} (ran)`,
          date: lastRun.toISOString().slice(0, 10),
          type: 'schedule',
          color: '#8b5cf6',
          details: 'Last execution',
        });
      }
    }
  }

  return events;
}

export function registerCalendarRoutes(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  // GET /api/dashboard/calendar?month=2026-03
  if (url.pathname === '/api/dashboard/calendar' && req.method === 'GET') {
    (async () => {
      try {
        const monthParam = url.searchParams.get('month');
        let year: number;
        let month: number;

        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
          const parts = monthParam.split('-');
          year = parseInt(parts[0], 10);
          month = parseInt(parts[1], 10);
        } else {
          const now = new Date();
          year = now.getFullYear();
          month = now.getMonth() + 1;
        }

        const allEvents: CalendarEvent[] = [];
        const errors: string[] = [];

        // Fetch from each source independently — partial failures are OK
        try {
          const sprintEvents = await fetchSprintEvents(year, month);
          allEvents.push(...sprintEvents);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Sprints: ${msg}`);
          console.error('[calendar] Failed to fetch sprint events:', msg);
        }

        try {
          const scheduleEvents = fetchScheduleEvents(year, month);
          allEvents.push(...scheduleEvents);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Schedules: ${msg}`);
          console.error('[calendar] Failed to fetch schedule events:', msg);
        }

        const data: CalendarData = {
          events: allEvents,
          errors,
          month,
          year,
        };

        sendJson(res, 200, data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendJson(res, 500, { error: msg });
      }
    })();
    return true;
  }

  return false;
}

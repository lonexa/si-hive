import { useEffect, useState } from 'react';
import { CalendarDays, MapPin, Users, Clock, Loader2, Video } from 'lucide-react';
import { Card, CardContent } from '@hive/shared/components/ui/card';
import { Badge } from '@hive/shared/components/ui/badge';
import { Separator } from '@hive/shared/components/ui/separator';
import { useGmailStore } from '@/stores/gmail-store';
import { API_BASE } from '@/lib/api-config';

export default function CalendarTab() {
  const { todayEvents, setTodayEvents, events, setEvents, setError } = useGmailStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEvents() {
      setLoading(true);
      setError(null);
      try {
        const [todayRes, upcomingRes] = await Promise.all([
          fetch(`${API_BASE}/api/calendar/events/today`),
          fetch(`${API_BASE}/api/calendar/events?days=7`),
        ]);
        if (!todayRes.ok) throw new Error(`Today events: HTTP ${todayRes.status}`);
        if (!upcomingRes.ok) throw new Error(`Upcoming events: HTTP ${upcomingRes.status}`);
        const todayData = await todayRes.json();
        const upcomingData = await upcomingRes.json();
        setTodayEvents(todayData.events || todayData || []);
        setEvents(upcomingData.events || upcomingData || []);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch calendar events');
      } finally {
        setLoading(false);
      }
    }
    fetchEvents();
  }, [setTodayEvents, setEvents, setError]);

  function formatTimeRange(start: string, end: string, isAllDay: boolean) {
    if (isAllDay) return 'All day';
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  function formatEventDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  interface CalendarEventItem {
    id: string;
    summary: string;
    description?: string;
    start: string;
    end: string;
    location?: string;
    attendees: Array<{ email: string; displayName?: string; responseStatus?: string }>;
    htmlLink?: string;
    meetLink?: string;
    isAllDay: boolean;
  }

  function EventCard({ event, showDate = false }: { event: CalendarEventItem; showDate?: boolean }) {
    return (
      <Card className="hover:bg-muted/30 transition-colors">
        <CardContent className="py-3 px-4 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{event.summary}</p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                <Clock className="h-3 w-3 flex-shrink-0" />
                {showDate && (
                  <span>{formatEventDate(event.start)} &middot; </span>
                )}
                <span>{formatTimeRange(event.start, event.end, event.isAllDay)}</span>
              </div>
            </div>
            {event.isAllDay && (
              <Badge variant="outline" className="text-[10px] flex-shrink-0">All day</Badge>
            )}
          </div>

          {event.meetLink && (
            <div className="flex items-center gap-1.5 text-xs">
              <Video className="h-3 w-3 flex-shrink-0 text-blue-500" />
              <a
                href={event.meetLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline truncate"
              >
                Join Google Meet
              </a>
            </div>
          )}

          {event.location && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3 w-3 flex-shrink-0" />
              <span>
                {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Filter upcoming events to exclude today's events (avoid duplicates)
  const todayDateStr = new Date().toDateString();
  const upcomingFiltered = events.filter(
    (e) => new Date(e.start).toDateString() !== todayDateStr
  );

  return (
    <div className="space-y-6">
      {/* Today's Events */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Today</h3>
          <Badge variant="outline" className="text-[10px]">
            {todayEvents.length}
          </Badge>
        </div>
        {todayEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground pl-6">No events today</p>
        ) : (
          <div className="space-y-2">
            {todayEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Upcoming Events */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Upcoming (7 days)</h3>
          <Badge variant="outline" className="text-[10px]">
            {upcomingFiltered.length}
          </Badge>
        </div>
        {upcomingFiltered.length === 0 ? (
          <p className="text-sm text-muted-foreground pl-6">No upcoming events</p>
        ) : (
          <div className="space-y-2">
            {upcomingFiltered.map((event) => (
              <EventCard key={event.id} event={event} showDate />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

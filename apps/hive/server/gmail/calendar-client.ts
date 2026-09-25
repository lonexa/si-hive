const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
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

async function calendarFetch(
  accessToken: string,
  path: string,
  options?: { params?: Record<string, string>; method?: string; body?: unknown },
): Promise<unknown> {
  const url = new URL(`${CALENDAR_API}${path}`);
  if (options?.params) {
    for (const [k, v] of Object.entries(options.params)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  const fetchOpts: RequestInit = { method: options?.method ?? 'GET', headers };

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(options.body);
  }

  const res = await fetch(url.toString(), fetchOpts);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API error: ${res.status} ${text}`);
  }

  return res.json();
}

export async function getUpcomingEvents(
  accessToken: string,
  days: number = 7,
): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const data = await calendarFetch(accessToken, '/calendars/primary/events', {
    params: {
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    },
  }) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    }>;
  };

  return (data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? '(No title)',
    description: e.description,
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location,
    attendees: e.attendees ?? [],
    htmlLink: e.htmlLink,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri,
    isAllDay: !e.start?.dateTime,
  }));
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  start: string; // ISO datetime or YYYY-MM-DD for all-day
  end: string;
  location?: string;
  attendees?: string[]; // email addresses
  timeZone?: string;
  addMeetLink?: boolean; // defaults to true
}

export async function createEvent(
  accessToken: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const isAllDay = input.start.length === 10; // YYYY-MM-DD
  const tz = input.timeZone ?? 'America/Kentucky/Louisville';

  const includeMeet = input.addMeetLink !== false;

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: isAllDay ? { date: input.start } : { dateTime: input.start, timeZone: tz },
    end: isAllDay ? { date: input.end } : { dateTime: input.end, timeZone: tz },
  };

  if (input.attendees?.length) {
    body.attendees = input.attendees.map((email) => ({ email }));
  }

  if (includeMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  }

  const data = await calendarFetch(accessToken, '/calendars/primary/events', {
    method: 'POST',
    params: { sendUpdates: 'all', conferenceDataVersion: '1' },
    body,
  }) as {
    id: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
    htmlLink?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  };

  const meetLink =
    data.hangoutLink ??
    data.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri;

  return {
    id: data.id,
    summary: data.summary ?? '(No title)',
    description: data.description,
    start: data.start?.dateTime ?? data.start?.date ?? '',
    end: data.end?.dateTime ?? data.end?.date ?? '',
    location: data.location,
    attendees: data.attendees ?? [],
    htmlLink: data.htmlLink,
    meetLink,
    isAllDay,
  };
}

export async function getTodayEvents(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const data = await calendarFetch(accessToken, '/calendars/primary/events', {
    params: {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    },
  }) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
      htmlLink?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
    }>;
  };

  return (data.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? '(No title)',
    description: e.description,
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    location: e.location,
    attendees: e.attendees ?? [],
    htmlLink: e.htmlLink,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri,
    isAllDay: !e.start?.dateTime,
  }));
}

import type { CalendarEvent } from '@homedash/contracts';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { deleteCacheByPrefix, getCache, setCache } from '../repositories/dashboard.js';

const calendarListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string(),
        primary: z.boolean().optional(),
        backgroundColor: z.string().optional(),
        accessRole: z.string().optional(),
      }),
    )
    .default([]),
});

const googleEventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  status: z.string().default('confirmed'),
  htmlLink: z.string().url().optional(),
  start: z.object({ date: z.string().optional(), dateTime: z.string().optional() }),
  end: z.object({ date: z.string().optional(), dateTime: z.string().optional() }),
});

const eventListSchema = z.object({ items: z.array(googleEventSchema).default([]) });

let accessTokenCache: { token: string; expiresAt: number } | undefined;

function isConfigured(): boolean {
  return Boolean(
    config.GOOGLE_OAUTH_CLIENT_ID &&
    config.GOOGLE_OAUTH_CLIENT_SECRET &&
    config.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

async function accessToken(): Promise<string> {
  if (!isConfigured()) {
    throw new AppError(
      503,
      'CALENDAR_NOT_CONFIGURED',
      "Google Calendar n'est pas encore connecté.",
    );
  }
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000)
    return accessTokenCache.token;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: config.GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new AppError(
      503,
      'CALENDAR_AUTH_FAILED',
      "L'autorisation Google Calendar doit être renouvelée.",
    );
  }
  const data = z
    .object({ access_token: z.string(), expires_in: z.number().default(3600) })
    .parse(await response.json());
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function googleRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) accessTokenCache = undefined;
  if (!response.ok) {
    throw new AppError(
      response.status >= 500 ? 503 : 400,
      'CALENDAR_API_ERROR',
      `Google Calendar a répondu ${response.status}.`,
    );
  }
  return response;
}

function mapEvent(calendarId: string, event: z.infer<typeof googleEventSchema>): CalendarEvent {
  const allDay = Boolean(event.start.date);
  return {
    id: event.id,
    calendarId,
    title: event.summary ?? '(Sans titre)',
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.start.dateTime ?? event.start.date ?? '',
    end: event.end.dateTime ?? event.end.date ?? '',
    allDay,
    status: event.status,
    htmlLink: event.htmlLink ?? null,
  };
}

export function calendarStatus(): { configured: boolean; connected: boolean; message: string } {
  const configured = isConfigured();
  return {
    configured,
    connected: configured,
    message: configured
      ? 'Identifiants OAuth configurés côté Raspberry Pi.'
      : 'Ajoutez les trois variables GOOGLE_OAUTH_* dans homedash.env.',
  };
}

export async function listCalendars(): Promise<
  Array<{ id: string; name: string; primary: boolean; color: string | null; writable: boolean }>
> {
  const response = await googleRequest('/users/me/calendarList?minAccessRole=reader');
  const data = calendarListSchema.parse(await response.json());
  return data.items.map((calendar) => ({
    id: calendar.id,
    name: calendar.summary,
    primary: calendar.primary ?? false,
    color: calendar.backgroundColor ?? null,
    writable: calendar.accessRole === 'writer' || calendar.accessRole === 'owner',
  }));
}

export async function listEvents(
  calendarIds: string[],
  days: number,
): Promise<{ events: CalendarEvent[]; stale: boolean; fetchedAt: string }> {
  const selected = calendarIds.length > 0 ? calendarIds : ['primary'];
  const cacheKey = `calendar:events:${selected.sort().join(',')}:${days}`;
  const cached = getCache<{ events: CalendarEvent[]; fetchedAt: string }>(cacheKey);
  if (cached && !cached.expired) return { ...cached.payload, stale: false };
  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
    const chunks = await Promise.all(
      selected.map(async (calendarId) => {
        const query = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '50',
        });
        const response = await googleRequest(
          `/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
        );
        const data = eventListSchema.parse(await response.json());
        return data.items.map((event) => mapEvent(calendarId, event));
      }),
    );
    const payload = {
      events: chunks.flat().sort((a, b) => a.start.localeCompare(b.start)),
      fetchedAt: new Date().toISOString(),
    };
    setCache(cacheKey, payload, 5 * 60_000);
    return { ...payload, stale: false };
  } catch (error) {
    if (cached) return { ...cached.payload, stale: true };
    throw error;
  }
}

export async function createEvent(
  calendarId: string,
  event: Record<string, unknown>,
): Promise<CalendarEvent> {
  const response = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(event),
  });
  const created = mapEvent(calendarId, googleEventSchema.parse(await response.json()));
  deleteCacheByPrefix('calendar:events:');
  return created;
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  event: Record<string, unknown>,
): Promise<CalendarEvent> {
  const response = await googleRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(event),
    },
  );
  const updated = mapEvent(calendarId, googleEventSchema.parse(await response.json()));
  deleteCacheByPrefix('calendar:events:');
  return updated;
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await googleRequest(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  );
  deleteCacheByPrefix('calendar:events:');
}

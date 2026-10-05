import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { listEvents } from './calendar.js';

const cache = vi.hoisted(
  () => new Map<string, { payload: unknown; fetchedAt: string; expired: boolean }>(),
);
vi.mock('../repositories/dashboard.js', () => ({
  getCache: (key: string) => cache.get(key),
  setCache: (key: string, payload: unknown) =>
    cache.set(key, { payload, fetchedAt: new Date().toISOString(), expired: false }),
  deleteCacheByPrefix: vi.fn(),
}));
vi.mock('../config.js', () => ({
  config: {
    GOOGLE_OAUTH_CLIENT_ID: 'client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh',
  },
}));
const fetchMock = vi.fn();
let time = Date.now();
const event = {
  id: 'one',
  summary: 'Réunion',
  start: { dateTime: '2026-10-05T10:00:00Z' },
  end: { dateTime: '2026-10-05T11:00:00Z' },
};
const eventCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/events?'));
beforeEach(() => {
  vi.useFakeTimers();
  time += 86_400_000;
  vi.setSystemTime(time);
  cache.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('oauth2')
            ? { access_token: 'access', expires_in: 3600 }
            : { items: [event] },
        ),
      ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('Google Calendar régulier et au réveil', () => {
  it('contourne le cache au réveil, sans modifier les agendas reçus et partage les demandes simultanées', async () => {
    const ids = ['primary', 'family'];
    const original = [...ids];
    await listEvents(ids, 14);
    await listEvents(ids, 14);
    expect(eventCalls()).toHaveLength(2);
    const [first, second] = await Promise.all([
      listEvents(ids, 14, true),
      listEvents(['family', 'primary'], 14, true),
    ]);
    expect(first).toEqual(second);
    expect(ids).toEqual(original);
    expect(eventCalls()).toHaveLength(4);
    // Both calendars share one OAuth renewal.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('oauth2'))).toHaveLength(1);
  });
  it('conserve un cache daté lors d’une panne, attend une minute, puis récupère', async () => {
    const data = await listEvents(['primary'], 14);
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await listEvents(['primary'], 14, true)).toEqual({ ...data, stale: true });
    expect((await listEvents(['primary'], 14)).stale).toBe(true);
    expect(eventCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await listEvents(['primary'], 14, true)).stale).toBe(false);
  });
  it('récupère des événements modifiés après cinq minutes sans attendre un réveil', async () => {
    await listEvents(['primary'], 14);
    await vi.advanceTimersByTimeAsync(300_000);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ ...event, summary: 'Nouvelle réunion' }] })),
    );
    expect((await listEvents(['primary'], 14)).events[0]?.title).toBe('Nouvelle réunion');
  });
});

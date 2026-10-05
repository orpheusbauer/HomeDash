import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { WidgetInstance } from '@homedash/contracts';
import { getBootstrap, getCache } from '../repositories/dashboard.js';
import { getWeather } from './weather.js';
import { listEvents } from './calendar.js';
import { configuredIntegrationTargets, startIntegrationRefresh } from './integration-refresh.js';

vi.mock('../repositories/dashboard.js', () => ({ getBootstrap: vi.fn(), getCache: vi.fn() }));
vi.mock('../realtime.js', () => ({ broadcast: vi.fn() }));
vi.mock('./weather.js', () => ({
  getWeather: vi.fn(),
  weatherCacheKey: (lat: number, lon: number) => `weather:${lat}:${lon}`,
}));
vi.mock('./calendar.js', () => ({
  listEvents: vi.fn(),
  calendarStatus: () => ({ configured: true }),
  normalizeCalendarIds: (ids: string[]) => [...new Set(ids.length ? ids : ['primary'])].sort(),
  calendarCacheKey: (ids: string[], days: number) =>
    `calendar:${[...ids].sort().join(',')}:${days}`,
}));
const instances = [
  { widgetId: 'weather.current', config: { location: 'Maison', latitude: 48, longitude: 2 } },
  { widgetId: 'weather.hourly', config: { location: 'Maison', latitude: 48, longitude: 2 } },
  { widgetId: 'calendar', config: { calendarIds: ['family', 'primary'] } },
  { widgetId: 'calendar', config: { calendarIds: ['primary', 'family'] } },
] as unknown as WidgetInstance[];
let stop: () => void;
const cached = new Map<string, { fetchedAt: string }>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
  vi.resetAllMocks();
  cached.clear();
  vi.mocked(getBootstrap).mockReturnValue({ instances } as ReturnType<typeof getBootstrap>);
  vi.mocked(getCache).mockImplementation((key) =>
    cached.has(key)
      ? { payload: cached.get(key)!, fetchedAt: cached.get(key)!.fetchedAt, expired: false }
      : undefined,
  );
  const save = (key: string) => {
    const payload = { fetchedAt: new Date().toISOString(), stale: false };
    cached.set(key, payload);
    return payload;
  };
  vi.mocked(getWeather).mockImplementation(
    async (_label, lat, lon) =>
      save(`weather:${lat}:${lon}`) as Awaited<ReturnType<typeof getWeather>>,
  );
  vi.mocked(listEvents).mockImplementation(async (ids, days) => ({
    ...save(`calendar:${ids.join(',')}:${days}`),
    events: [],
  }));
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
});
describe('collecte autonome du Pi', () => {
  it('collecte toutes les pages sans tablette et regroupe les widgets identiques', async () => {
    expect(configuredIntegrationTargets(instances)).toHaveLength(2);
    stop = startIntegrationRefresh({ warn: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(getWeather).toHaveBeenCalledTimes(2);
    expect(listEvents).toHaveBeenCalledTimes(3);
    vi.mocked(getBootstrap).mockReturnValue({ instances: [] } as unknown as ReturnType<
      typeof getBootstrap
    >);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(getWeather).toHaveBeenCalledTimes(2);
  });
  it('ne superpose pas les cycles pendant une requête et s’arrête proprement', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof getWeather>>) => void;
    vi.mocked(getWeather).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    stop = startIntegrationRefresh({ warn: vi.fn() });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getWeather).toHaveBeenCalledTimes(1);
    expect(listEvents).not.toHaveBeenCalled();
    stop();
    resolve({ fetchedAt: new Date().toISOString(), stale: false } as Awaited<
      ReturnType<typeof getWeather>
    >);
    await vi.advanceTimersByTimeAsync(0);
    expect(listEvents).not.toHaveBeenCalled();
  });
});

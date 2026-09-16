import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCache, setCache } from '../repositories/dashboard.js';
import { getWeather } from './weather.js';

vi.mock('../repositories/dashboard.js', () => ({ getCache: vi.fn(), setCache: vi.fn() }));

const forecast = {
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: 'Europe/Paris',
  current: { time: '2026-09-16T13:00', temperature_2m: 22, is_day: 1, weather_code: 0 },
  hourly: {
    time: ['2026-09-16T13:00'],
    temperature_2m: [22],
    relative_humidity_2m: [60],
    weather_code: [0],
    is_day: [1],
    precipitation_probability: [0],
  },
  daily: {
    time: ['2026-09-16'],
    temperature_2m_min: [15],
    temperature_2m_max: [24],
    weather_code: [0],
    precipitation_probability_max: [0],
  },
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(forecast)));
});
afterEach(() => vi.unstubAllGlobals());

async function primeCache() {
  const payload = await getWeather('Paris', 48.8566, 2.3522);
  vi.mocked(getCache).mockReturnValue({ payload, fetchedAt: payload.fetchedAt, expired: false });
  fetchMock.mockClear();
  return payload;
}

describe('actualisation météo au réveil', () => {
  it('respecte le cache normal, mais récupère de nouvelles données sur demande', async () => {
    await primeCache();
    await getWeather('Paris', 48.8566, 2.3522);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...forecast, current: { ...forecast.current, temperature_2m: 25 } }),
      ),
    );
    const fresh = await getWeather('Paris', 48.8566, 2.3522, true);
    expect(fresh.current.temperature).toBe(25);
    expect(fresh.stale).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setCache).toHaveBeenLastCalledWith(expect.any(String), fresh, 15 * 60_000);
  });

  it('partage la requête entre widgets de même position et préserve leurs libellés', async () => {
    await primeCache();
    const results = await Promise.all([
      getWeather('Paris', 48.8566, 2.3522, true),
      getWeather('Maison', 48.8566, 2.3522, true),
      getWeather('Paris', 48.8566, 2.3522, true),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.location)).toEqual(['Paris', 'Maison', 'Paris']);
    await getWeather('Paris', 48.8566, 2.3522, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('conserve les dernières valeurs datées et signalées périmées en cas de coupure', async () => {
    const cached = await primeCache();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await getWeather('Paris', 48.8566, 2.3522, true)).toEqual({ ...cached, stale: true });
    expect((await getWeather('Paris', 48.8566, 2.3522, true)).stale).toBe(false);
  });

  it('signale une indisponibilité sans cache, puis permet une nouvelle tentative', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(getWeather('Paris', 48.8566, 2.3522, true)).rejects.toMatchObject({
      code: 'WEATHER_UNAVAILABLE',
    });
    expect((await getWeather('Paris', 48.8566, 2.3522, true)).stale).toBe(false);
  });
});

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WeatherData, WidgetInstance } from '@homedash/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { listenForDashboardResume } from '../dashboard-refresh';
import { weatherLocalTime } from '../use-current-time';
import { HourlyWeatherWidget } from './WeatherWidget';

vi.mock('../api', () => ({ api: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('horloge des prévisions', () => {
  it('utilise le fuseau du lieu, y compris à minuit et aux changements de saison', () => {
    expect(weatherLocalTime(new Date('2026-09-16T22:05:00Z'), 'Europe/Paris')).toBe(
      '2026-09-17T00:00',
    );
    expect(weatherLocalTime(new Date('2026-01-16T12:05:00Z'), 'Europe/Paris')).toBe(
      '2026-01-16T13:00',
    );
    expect(weatherLocalTime(new Date('2026-09-16T11:05:00Z'), 'America/New_York')).toBe(
      '2026-09-16T07:00',
    );
  });

  it('passe de 9 h à 13 h au réveil avant la réponse réseau et remet le rail au début', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T07:05:00Z'));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const data: WeatherData = {
      location: 'Paris',
      latitude: 48.8566,
      longitude: 2.3522,
      timezone: 'Europe/Paris',
      current: {
        time: '2026-09-16T09:00',
        temperature: 18,
        apparentTemperature: 18,
        humidity: 60,
        windSpeed: 5,
        weatherCode: 0,
        isDay: true,
      },
      hourly: Array.from({ length: 15 }, (_, index) => ({
        time: `2026-09-16T${String(index + 9).padStart(2, '0')}:00`,
        temperature: 18 + index,
        humidity: 60,
        weatherCode: 0,
        isDay: true,
        precipitationProbability: 0,
      })),
      daily: [],
      fetchedAt: '2026-09-16T07:00:00Z',
      stale: false,
    };
    vi.mocked(api).mockResolvedValueOnce(data);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stop = listenForDashboardResume(client);
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(HourlyWeatherWidget, {
              instance: { config: {}, widgetId: 'weather.hourly' } as WidgetInstance,
              editing: false,
              adminUnlocked: false,
            }),
          ),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const rail = host.querySelector<HTMLDivElement>('.hourly-weather-list')!;
      expect(rail.querySelector('time')?.dateTime).toBe('2026-09-16T09:00');
      rail.scrollLeft = 250;
      let finish!: (data: WeatherData) => void;
      vi.mocked(api).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      vi.setSystemTime(new Date('2026-09-16T11:05:00Z'));
      await act(async () => {
        window.dispatchEvent(new Event('homedash:resume'));
      });
      expect(rail.querySelector('time')?.dateTime).toBe('2026-09-16T13:00');
      expect(rail.scrollLeft).toBe(0);
      expect(api).toHaveBeenLastCalledWith(
        expect.stringContaining('refresh=true'),
        expect.objectContaining({ cache: 'no-store' }),
      );
      await act(async () => {
        finish({ ...data, stale: true });
      });
      expect(rail.querySelector('time')?.dateTime).toBe('2026-09-16T13:00');
    } finally {
      await act(async () => root.unmount());
      stop();
      client.clear();
    }
  });
});

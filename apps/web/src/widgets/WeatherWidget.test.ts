import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WeatherData } from '@homedash/contracts';
import { temperatureColor } from './TemperatureTrendChart';
import { HOURLY_FORECAST_HOURS, responsiveItemCount, upcomingHours } from './WeatherWidget';
import { WeatherIcon } from './shared';
import { HOURLY_WIDGET_REFRESH_MS, hourlyWidgetRefresh } from '../widget-refresh';

const hour = (time: string, isDay = true): WeatherData['hourly'][number] => ({
  time,
  temperature: 20,
  humidity: 60,
  weatherCode: 0,
  isDay,
  precipitationProbability: 0,
});

describe('widget météo', () => {
  it('continue les prévisions après minuit', () => {
    const hours = [
      hour('2026-09-02T22:00'),
      hour('2026-09-02T23:00'),
      hour('2026-09-03T00:00'),
      hour('2026-09-03T01:00'),
    ];
    expect(upcomingHours(hours, '2026-09-02T23:17').map((item) => item.time)).toEqual([
      '2026-09-02T23:00',
      '2026-09-03T00:00',
      '2026-09-03T01:00',
    ]);
  });

  it('conserve au maximum les 24 heures à partir de l’heure courante', () => {
    const hours = Array.from({ length: 36 }, (_, index) =>
      hour(
        `2026-09-${String(2 + Math.floor(index / 24)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00`,
      ),
    );
    const upcoming = upcomingHours(hours, '2026-09-02T08:17');

    expect(HOURLY_FORECAST_HOURS).toBe(24);
    expect(upcoming).toHaveLength(24);
    expect(upcoming[0]!.time).toBe('2026-09-02T08:00');
    expect(upcoming.at(-1)!.time).toBe('2026-09-03T07:00');
  });

  it('adapte le nombre de cartes à la largeur disponible', () => {
    expect(responsiveItemCount(330, 74, 24)).toBe(4);
    expect(responsiveItemCount(810, 74, 24)).toBe(10);
    expect(responsiveItemCount(810, 74, 3)).toBe(3);
  });

  it('utilise une palette du bleu froid au rouge canicule', () => {
    expect(temperatureColor(-20)).toBe('#bdefff');
    expect(temperatureColor(45)).toBe('#8f1d24');
    expect(temperatureColor(10)).not.toBe(temperatureColor(35));
  });

  it('rafraîchit les sources externes toutes les heures, même en arrière-plan', () => {
    expect(HOURLY_WIDGET_REFRESH_MS).toBe(3_600_000);
    expect(hourlyWidgetRefresh).toEqual({
      staleTime: 3_600_000,
      refetchInterval: 3_600_000,
      refetchIntervalInBackground: true,
    });
  });

  it('affiche une lune pour un ciel dégagé pendant la nuit locale', () => {
    const night = renderToStaticMarkup(createElement(WeatherIcon, { code: 0, isDay: false }));
    const day = renderToStaticMarkup(createElement(WeatherIcon, { code: 0, isDay: true }));

    expect(night).toContain('weather-icon__moon');
    expect(night).not.toContain('weather-icon__sun');
    expect(day).toContain('weather-icon__sun');
  });
});

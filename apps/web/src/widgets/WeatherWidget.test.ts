import { describe, expect, it } from 'vitest';
import type { WeatherData } from '@homedash/contracts';
import { temperatureColor } from './TemperatureTrendChart';
import { responsiveItemCount, upcomingHours } from './WeatherWidget';

const hour = (time: string): WeatherData['hourly'][number] => ({
  time,
  temperature: 20,
  humidity: 60,
  weatherCode: 0,
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
});

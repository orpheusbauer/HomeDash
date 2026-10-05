// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarData } from '@homedash/contracts';
import { readWidgetCache, saveWidgetCache } from './widget-cache';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
const calendar: CalendarData = { events: [], fetchedAt: '2026-10-05T08:00:00Z', stale: false };
describe('dernières données conservées sur la tablette', () => {
  it('restaure les données comme périmées sans inventer une nouvelle date', () => {
    saveWidgetCache('family', calendar);
    expect(readWidgetCache('family', 'calendar')).toEqual({ ...calendar, stale: true });
    expect(readWidgetCache('other', 'calendar')).toBeUndefined();
  });
  it('ignore un cache corrompu ou incompatible et borne les lieux/agendas conservés', () => {
    localStorage.setItem('homedash.widget-data.v1:corrupt', '{bad');
    expect(readWidgetCache('corrupt', 'calendar')).toBeUndefined();
    for (let index = 0; index < 40; index++) saveWidgetCache(String(index), calendar);
    expect(localStorage.length).toBe(32);
  });
  it('continue si le stockage est indisponible', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => saveWidgetCache('family', calendar)).not.toThrow();
    spy.mockRestore();
  });
});

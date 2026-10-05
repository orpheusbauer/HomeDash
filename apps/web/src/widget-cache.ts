import {
  calendarDataSchema,
  weatherSchema,
  type CalendarData,
  type WeatherData,
} from '@homedash/contracts';

const PREFIX = 'homedash.widget-data.v1:';
const MAX_ENTRIES = 32;

export function readWidgetCache<T extends WeatherData | CalendarData>(
  key: string,
  kind: 'weather' | 'calendar',
): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const result = (kind === 'weather' ? weatherSchema : calendarDataSchema).safeParse(
      JSON.parse(raw),
    );
    return result.success ? ({ ...result.data, stale: true } as T) : undefined;
  } catch {
    return undefined;
  }
}

export function saveWidgetCache(key: string, data: WeatherData | CalendarData): void {
  try {
    // Keep the last successful values through WebView/app reloads, including a Pi reboot.
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter((entry): entry is string => entry?.startsWith(PREFIX) === true);
    for (const old of keys
      .filter((entry) => entry !== PREFIX + key)
      .slice(0, Math.max(0, keys.length - MAX_ENTRIES)))
      localStorage.removeItem(old);
  } catch {
    // Quota/private storage failures must not discard the live response.
  }
}

import { useEffect, useState } from 'react';
import { DASHBOARD_REFRESH_EVENT } from './dashboard-refresh';

export function useCurrentTime(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener(DASHBOARD_REFRESH_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, refresh);
    };
  }, [intervalMs]);
  return now;
}

/** Open-Meteo timestamps are wall-clock values in the forecast location's timezone. */
export function weatherLocalTime(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:00`;
}

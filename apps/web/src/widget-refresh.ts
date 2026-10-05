import { CALENDAR_REFRESH_MS, WEATHER_REFRESH_MS } from '@homedash/contracts';

const refreshOptions = (interval: number) => ({
  staleTime: interval,
  refetchInterval: interval,
  refetchIntervalInBackground: true,
  refetchOnMount: 'always' as const,
  networkMode: 'always' as const,
});

export const weatherWidgetRefresh = refreshOptions(WEATHER_REFRESH_MS);
export const calendarWidgetRefresh = refreshOptions(CALENDAR_REFRESH_MS);

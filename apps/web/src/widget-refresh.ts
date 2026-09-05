export const HOURLY_WIDGET_REFRESH_MS = 60 * 60_000;

export const hourlyWidgetRefresh = {
  staleTime: HOURLY_WIDGET_REFRESH_MS,
  refetchInterval: HOURLY_WIDGET_REFRESH_MS,
  refetchIntervalInBackground: true,
} as const;

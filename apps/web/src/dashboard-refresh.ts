import type { QueryClient } from '@tanstack/react-query';

export const DASHBOARD_REFRESH_EVENT = 'homedash:refresh';

/** One refresh for the group of browser/native events emitted by a single wake. */
export function listenForDashboardResume(client: QueryClient) {
  let lastRefresh = -Infinity;
  const refresh = (event: Event) => {
    // Android can notify us before the WebView reports itself visible.
    if (document.visibilityState === 'hidden' && event.type !== 'homedash:resume') return;
    window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    const now = Date.now();
    if (event.type !== 'online' && now - lastRefresh < 1_000) return;
    lastRefresh = now;
    // Inactive pages become stale too, and load fresh data when selected.
    // Share requests already running instead of cancelling them on every signal.
    void client.invalidateQueries({}, { cancelRefetch: false });
  };
  const events = ['focus', 'pageshow', 'online', 'homedash:resume'];
  for (const event of events) window.addEventListener(event, refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    for (const event of events) window.removeEventListener(event, refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}

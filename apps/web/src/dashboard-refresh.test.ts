// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForDashboardResume } from './dashboard-refresh';

let client: QueryClient;
let stop: () => void;
let unsubscribe: () => void;
const fetchData = vi.fn(async () => 'fresh');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T11:00:00Z'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fetchData.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, {
    queryKey: ['weather'],
    queryFn: fetchData,
    initialData: 'cached',
    staleTime: 3_600_000,
  });
  unsubscribe = observer.subscribe(() => {});
  stop = listenForDashboardResume(client);
});
afterEach(() => {
  stop();
  unsubscribe();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('retour au dashboard', () => {
  it.each(['focus', 'pageshow', 'homedash:resume', 'online', 'visibilitychange'])(
    'relance immédiatement les données encore fraîches sur %s',
    async (event) => {
      const target = event === 'visibilitychange' ? document : window;
      target.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchData).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(['weather'])).toBe('fresh');
    },
  );

  it('regroupe les signaux du même réveil, puis autorise le réveil suivant', async () => {
    window.dispatchEvent(new Event('homedash:resume'));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    window.dispatchEvent(new Event('homedash:resume'));
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('ignore le passage en arrière-plan mais accepte le signal Android avant la visibilité', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(fetchData).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('homedash:resume'));
    expect(fetchData).toHaveBeenCalledTimes(1);
  });

  it('invalide les autres pages sans les charger et retire ses écouteurs au démontage', () => {
    client.setQueryData(['calendar-events'], ['old']);
    window.dispatchEvent(new Event('homedash:resume'));
    expect(client.getQueryState(['calendar-events'])?.isInvalidated).toBe(true);
    stop();
    vi.advanceTimersByTime(2_000);
    window.dispatchEvent(new Event('focus'));
    expect(fetchData).toHaveBeenCalledTimes(1);
  });
});

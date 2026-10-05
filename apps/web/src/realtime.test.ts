// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForRealtime } from './realtime';
const sockets: FakeSocket[] = [];
class FakeSocket extends EventTarget {
  close = vi.fn(() => this.dispatchEvent(new Event('close')));
  constructor() {
    super();
    sockets.push(this);
  }
}
let stop: () => void;
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  client = new QueryClient();
});
afterEach(() => {
  stop();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('reprise des liaisons silencieusement coupées', () => {
  it('attend trois secondes après une erreur pour éviter une boucle de connexions', async () => {
    stop = listenForRealtime(client, vi.fn());
    sockets[0]!.dispatchEvent(new Event('error'));
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
  });
  it('reconnecte une socket restée ouverte mais sans messages et recharge les widgets', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    stop = listenForRealtime(client, vi.fn());
    sockets[0]!.dispatchEvent(new Event('open'));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(sockets).toHaveLength(2);
    expect(sockets[0]!.close).toHaveBeenCalledOnce();
    sockets[1]!.dispatchEvent(new Event('open'));
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: ['calendar-events'] },
      { cancelRefetch: false },
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['weather'] }, { cancelRefetch: false });
  });
  it('détecte une veille prolongée au réveil et retire tous ses écouteurs', () => {
    stop = listenForRealtime(client, vi.fn());
    sockets[0]!.dispatchEvent(new Event('open'));
    vi.setSystemTime(Date.now() + 3_600_000);
    window.dispatchEvent(new Event('homedash:resume'));
    expect(sockets).toHaveLength(2);
    stop();
    window.dispatchEvent(new Event('homedash:resume'));
    expect(sockets).toHaveLength(2);
  });
  it('maintient la liaison tant que des heartbeats arrivent', async () => {
    stop = listenForRealtime(client, vi.fn());
    sockets[0]!.dispatchEvent(new Event('open'));
    for (let index = 0; index < 5; index++) {
      await vi.advanceTimersByTimeAsync(20_000);
      sockets[0]!.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'server.heartbeat',
            payload: { serverTime: new Date().toISOString() },
          }),
        }),
      );
    }
    expect(sockets).toHaveLength(1);
  });
});

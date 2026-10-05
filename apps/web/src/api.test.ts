// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('requêtes bornées pendant une perte du Pi', () => {
  it('annule une requête silencieusement bloquée pour permettre la suivante', async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', request);
    const pending = api('/api/v1/connection', {}, false, 8_000);
    const expected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(8_000);
    await expected;
    request.mockImplementationOnce(async () => new Response(JSON.stringify({ status: 'ready' })));
    expect(await api('/health/ready')).toEqual({ status: 'ready' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('conserve l’annulation demandée par React Query', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = api('/api/v1/weather', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

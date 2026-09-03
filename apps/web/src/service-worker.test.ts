import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = {
  request?: { url: string; method: string; mode: string; destination: string };
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<Response>): void;
};

function worker() {
  const stores = new Map<string, Map<string, Response>>();
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const network = vi.fn<typeof fetch>();
  const key = (request: string | { url: string }) =>
    new URL(typeof request === 'string' ? request : request.url, 'https://homedash.local').href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      let store = stores.get(name);
      if (!store) stores.set(name, (store = new Map<string, Response>()));
      return {
        match: async (request: string | { url: string }) => store.get(key(request))?.clone(),
        put: async (request: string | { url: string }, response: Response) => {
          store.set(key(request), response.clone());
        },
      };
    },
  };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: {
      location: { origin: 'https://homedash.local' },
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) =>
        listeners.set(name, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches,
    fetch: network,
    URL,
  });
  async function dispatch(name: string, path = '/', destination = '') {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(name)!({
      request: {
        url: key(path),
        method: 'GET',
        mode: destination === 'document' ? 'navigate' : 'cors',
        destination,
      },
      waitUntil: (promise) => {
        pending.push(promise);
      },
      respondWith: (promise) => {
        response = promise;
      },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  return { stores, caches, network, dispatch };
}
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
const script = (body: string) =>
  new Response(body, { headers: { 'Content-Type': 'text/javascript' } });

describe('cache pendant une mise à jour', () => {
  it('conserve la dernière page saine pendant un 502 puis charge la nouvelle version', async () => {
    const w = worker();
    w.network.mockResolvedValueOnce(html('version A'));
    expect(await (await w.dispatch('fetch', '/', 'document'))!.text()).toBe('version A');
    w.network.mockResolvedValueOnce(html('Bad Gateway', 502));
    expect(await (await w.dispatch('fetch', '/', 'document'))!.text()).toBe('version A');
    w.network.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await w.dispatch('fetch', '/', 'document'))!.text()).toBe('version A');
    w.network.mockResolvedValueOnce(html('version B'));
    expect(await (await w.dispatch('fetch', '/', 'document'))!.text()).toBe('version B');
    expect(w.network.mock.calls.at(-1)?.[1]?.cache).toBe('no-store');
  });

  it('garde le script exact d’une ancienne page après le remplacement du serveur', async () => {
    const w = worker();
    w.network.mockResolvedValueOnce(script('old bundle'));
    await w.dispatch('fetch', '/assets/index-old.js', 'script');
    w.network.mockResolvedValue(html('new index'));
    expect(await (await w.dispatch('fetch', '/assets/index-old.js', 'script'))!.text()).toBe(
      'old bundle',
    );
    expect(w.network).toHaveBeenCalledTimes(1);
  });

  it('ne remplace jamais un script absent par le HTML de la page', async () => {
    const w = worker();
    w.network.mockResolvedValueOnce(html('dashboard'));
    await w.dispatch('fetch', '/', 'document');
    w.network.mockRejectedValueOnce(new TypeError('offline'));
    await expect(w.dispatch('fetch', '/assets/missing.js', 'script')).rejects.toThrow('offline');
  });

  it('ne mémorise ni les erreurs HTTP ni du HTML à une adresse de script', async () => {
    const w = worker();
    w.network.mockResolvedValueOnce(html('new index'));
    await w.dispatch('fetch', '/assets/missing.js', 'script');
    const cache = await w.caches.open('homedash-shell-v2');
    expect(await cache.match('/assets/missing.js')).toBeUndefined();
    w.network.mockResolvedValueOnce(html('Bad Gateway', 502));
    await w.dispatch('fetch', '/', 'document');
    expect(await cache.match('/')).toBeUndefined();
  });

  it('remplace le cache historique sans toucher aux autres données du site', async () => {
    const w = worker();
    await w.caches.open('homedash-shell-v1');
    await w.caches.open('homedash-shell-v2');
    await w.caches.open('other-app');
    await w.dispatch('install');
    await w.dispatch('activate');
    expect([...w.stores.keys()]).toEqual(['homedash-shell-v2', 'other-app']);
    expect(w.network).not.toHaveBeenCalled();
  });

  it('laisse les API, contrôles de santé et ressources externes au réseau', async () => {
    const w = worker();
    for (const url of [
      '/api/v1/bootstrap',
      '/health/ready',
      '/sw.js',
      'https://example.com/picture',
    ]) {
      expect(await w.dispatch('fetch', url)).toBeUndefined();
    }
    expect(w.network).not.toHaveBeenCalled();
  });

  it('affiche la page même lorsque le stockage du cache est indisponible', async () => {
    const w = worker();
    vi.spyOn(w.caches, 'open').mockRejectedValue(new Error('QuotaExceededError'));
    w.network.mockResolvedValueOnce(html('dashboard'));
    expect(await (await w.dispatch('fetch', '/', 'document'))!.text()).toBe('dashboard');
  });
});

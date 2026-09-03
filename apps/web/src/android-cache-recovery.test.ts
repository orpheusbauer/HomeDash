import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const kotlin = readFileSync(
  new URL('../../android/app/src/main/java/io/homedash/kiosk/DashboardLoader.kt', import.meta.url),
  'utf8',
);
const script = kotlin.match(/WEB_CACHE_RECOVERY_SCRIPT = """([\s\S]*?)"""/)?.[1];
if (!script) throw new Error('Native cache recovery script not found');

describe('récupération native indépendante du dashboard', () => {
  it('attend le nettoyage ciblé et conserve association, notes et autres caches', async () => {
    let finish!: () => void;
    const unregister = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const unrelated = vi.fn();
    const deleted: string[] = [];
    const localStorage = { clear: vi.fn(), removeItem: vi.fn() };
    const window = { __homedashCacheRepairDone: false, caches: {} };
    const caches = {
      keys: async () => ['homedash-shell-v1', 'homedash-shell-v2', 'other-app'],
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    runInNewContext(script, {
      window,
      caches,
      localStorage,
      URL,
      location: { origin: 'https://homedash.local' },
      navigator: {
        serviceWorker: {
          getRegistrations: async () => [
            { active: { scriptURL: 'https://homedash.local/sw.js' }, unregister },
            { active: { scriptURL: 'https://homedash.local/other/sw.js' }, unregister: unrelated },
            { active: { scriptURL: 'https://other.local/sw.js' }, unregister: unrelated },
          ],
        },
      },
    });
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(window.__homedashCacheRepairDone).toBe(false);
    finish();
    await vi.waitFor(() => expect(window.__homedashCacheRepairDone).toBe(true));
    expect(deleted).toEqual(['homedash-shell-v1', 'homedash-shell-v2']);
    expect(unrelated).not.toHaveBeenCalled();
    expect(localStorage.clear).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
  });

  it('termine même si le stockage est inaccessible', async () => {
    const window = { __homedashCacheRepairDone: false, caches: {} };
    runInNewContext(script, {
      window,
      navigator: {},
      caches: {
        keys: async () => {
          throw new Error('unavailable');
        },
      },
    });
    await vi.waitFor(() => expect(window.__homedashCacheRepairDone).toBe(true));
  });
});

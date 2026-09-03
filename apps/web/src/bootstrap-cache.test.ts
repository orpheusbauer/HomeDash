import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapData } from '@homedash/contracts';
import { cachedBootstrap, saveBootstrapCache } from './bootstrap-cache';

const valid: BootstrapData = {
  version: '0.4.6',
  pages: [],
  instances: [],
  widgets: [],
  layoutRevision: {},
  serverTime: '2026-09-03T10:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());

describe('données locales après une mise à jour', () => {
  it.each(['{broken', '{}', '{"pages":null}', JSON.stringify({ ...valid, layoutRevision: null })])(
    'ignore un cache incompatible sans effacer les autres données',
    (raw) => {
      const setItem = vi.fn();
      const removeItem = vi.fn();
      vi.stubGlobal('localStorage', { getItem: () => raw, setItem, removeItem });
      expect(cachedBootstrap()).toBeUndefined();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    },
  );
  it('conserve un cache valide pour un démarrage hors ligne', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(valid) });
    expect(cachedBootstrap()).toEqual(valid);
  });
  it('ne bloque pas la réponse du serveur si le cache est plein', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(cachedBootstrap()).toBeUndefined();
    expect(() => saveBootstrapCache(valid)).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdates, installUpdate, isNewer, parseAndroidChecksum } from './updates.js';

afterEach(() => vi.unstubAllGlobals());

describe('mises à jour', () => {
  it.each([
    { draft: true, prerelease: false, tag_name: 'v0.4.3' },
    { draft: false, prerelease: true, tag_name: 'v0.4.3' },
    { draft: false, prerelease: false, tag_name: 'v0.4.3-beta' },
    { draft: false, prerelease: false, tag_name: 'latest' },
  ])('refuse une release non stable ou un tag non exact : $tag_name', async (release) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...release,
              name: 'Test',
              body: '',
              html_url: 'https://github.com/example/HomeDash/releases',
              published_at: null,
              assets: [],
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await checkForUpdates();
    expect(result.updateAvailable).toBe(false);
    expect(result.installable).toBe(false);
    expect(result.manifest).toBeNull();
  });
  it('compare les versions sémantiques', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });

  it('refuse un manifeste non vérifiable avant de joindre l’agent', async () => {
    await expect(
      installUpdate({
        kind: 'native',
        version: 'latest',
        tag: 'vlatest',
        archive: '../../attaque.tar.gz',
        checksum: 'bad',
      }),
    ).rejects.toThrow();
  });

  it('n’accepte que la somme SHA-256 associée au nom exact de l’APK', () => {
    const digest = 'a'.repeat(64);
    expect(
      parseAndroidChecksum(`${digest}  homedash-kiosk-0.3.0.apk\n`, 'homedash-kiosk-0.3.0.apk'),
    ).toBe(digest);
    expect(() =>
      parseAndroidChecksum(`${digest}  autre.apk\n`, 'homedash-kiosk-0.3.0.apk'),
    ).toThrow();
  });
});

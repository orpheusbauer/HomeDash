import { describe, expect, it } from 'vitest';
import { installUpdate, isNewer, parseAndroidChecksum } from './updates.js';

describe('mises à jour', () => {
  it('compare les versions sémantiques', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });

  it('refuse un manifeste non vérifiable avant de joindre l’agent', async () => {
    await expect(
      installUpdate({ version: 'latest', image: 'docker.io/attacker/image', digest: 'bad' }),
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

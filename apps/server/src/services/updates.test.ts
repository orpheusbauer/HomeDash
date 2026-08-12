import { describe, expect, it } from 'vitest';
import { installUpdate, isNewer } from './updates.js';

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
});

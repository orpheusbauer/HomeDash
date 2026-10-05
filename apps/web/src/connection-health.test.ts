import { describe, expect, it } from 'vitest';
import type { ConnectionHealth } from '@homedash/contracts';
import { ApiError } from './api';
import { connectionSummary } from './connection-health';
const data: ConnectionHealth = {
  version: '0.4.11',
  serverTime: new Date().toISOString(),
  integrations: [],
  nightlyReboot: { active: false, time: '03:00', timezone: 'Europe/Paris' },
};
const base = {
  networkOnline: true,
  error: null,
  checkedAt: 100_000,
  now: 100_000,
  data,
  realtime: 'online' as const,
};
describe('diagnostic tablette / Pi / fournisseur', () => {
  it('distingue une tablette hors réseau d’un Pi inaccessible et d’une erreur HTTP', () => {
    expect(
      connectionSummary({ ...base, networkOnline: false, error: new Error('network') }).label,
    ).toBe('Tablette hors réseau');
    expect(connectionSummary({ ...base, error: new Error('network') }).label).toBe(
      'Pi inaccessible',
    );
    expect(connectionSummary({ ...base, error: new ApiError(503, 'ERROR', 'failed') }).label).toBe(
      'HomeDash en erreur',
    );
  });
  it('garde le Pi connecté quand seul le fournisseur météo est indisponible', () => {
    const summary = connectionSummary({
      ...base,
      data: {
        ...data,
        integrations: [
          {
            id: 'weather',
            kind: 'weather',
            label: 'Paris',
            state: 'stale',
            fetchedAt: data.serverTime,
            lastAttemptAt: data.serverTime,
            lastError: 'Open-Meteo',
            refreshIntervalMs: 600_000,
          },
        ],
      },
    });
    expect(summary.level).toBe('warning');
    expect(summary.message).toContain('Le Pi répond');
    expect(summary.message).toContain('Météo');
  });
  it('signale une liaison temps réel coupée malgré HTTP disponible et évite un état vert périmé', () => {
    expect(connectionSummary({ ...base, realtime: 'offline' }).label).toContain(
      'liaison en reprise',
    );
    expect(connectionSummary({ ...base, now: 200_000 }).level).toBe('connecting');
    expect(connectionSummary(base).level).toBe('online');
  });
});

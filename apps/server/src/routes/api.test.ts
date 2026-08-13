import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'homedash-api-'));
process.env.NODE_ENV = 'test';
process.env.HOMEDASH_DATABASE_PATH = join(directory, 'api.db');
process.env.HOMEDASH_ADMIN_PIN = '0000';
process.env.HOMEDASH_SENSOR_INGEST_TOKEN = 'test-sensor-token-123';

let app: FastifyInstance;
let closeDatabase: () => void;
let adminHeaders: { 'x-homedash-admin': string };

beforeAll(async () => {
  ({ closeDatabase } = await import('../db/index.js'));
  const module = await import('../app.js');
  app = await module.createApp();
  await app.ready();
  const unlock = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/unlock',
    payload: { pin: '0000' },
  });
  expect(unlock.statusCode).toBe(200);
  adminHeaders = { 'x-homedash-admin': unlock.json<{ token: string }>().token };
});

afterAll(async () => {
  await app.close();
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

describe('API HomeDash', () => {
  it('expose santé et bootstrap', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    const bootstrap = await app.inject({ method: 'GET', url: '/api/v1/bootstrap' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json<{ widgets: unknown[] }>().widgets.length).toBeGreaterThanOrEqual(8);
  });

  it('protège les changements de page', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      payload: { name: 'Maison' },
    });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/pages',
      headers: adminHeaders,
      payload: { name: 'Maison' },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json<{ name: string }>().name).toBe('Maison');
  });

  it('déverrouille l’administration uniquement avec le PIN 0000', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/unlock',
      payload: { pin: '1234' },
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json<{ error: { code: string } }>().error.code).toBe('ADMIN_PIN_INVALID');

    const verified = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/verify',
      headers: adminHeaders,
    });
    expect(verified.statusCode).toBe(200);
  });

  it('sépare le jeton d’ingestion capteur', async () => {
    const payload = {
      id: 'api-salon',
      name: 'Salon API',
      type: 'temperature',
      location: 'indoor',
      value: 21.8,
      unit: '°C',
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/sensors/ingest', payload })).statusCode,
    ).toBe(401);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/sensors/ingest',
      headers: { 'x-homedash-sensor': 'test-sensor-token-123' },
      payload,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json<{ value: number }>().value).toBe(21.8);
  });

  it('associe, authentifie puis révoque une tablette', async () => {
    const pairing = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/pairing',
      headers: adminHeaders,
    });
    const code = pairing.json<{ code: string }>().code;
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair',
      payload: { code, name: 'Tablette test' },
    });
    expect(paired.statusCode).toBe(201);
    const credentials = paired.json<{ deviceId: string; token: string }>();
    const telemetry = await app.inject({
      method: 'POST',
      url: `/api/v1/devices/${credentials.deviceId}/telemetry`,
      headers: { authorization: `Bearer ${credentials.token}` },
      payload: { batteryPercent: 64, charging: true, presenceState: 'present' },
    });
    expect(telemetry.statusCode).toBe(204);
    const devices = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: adminHeaders,
    });
    const listed = devices.json<Array<{ telemetry: { batteryPercent?: number } }>>();
    expect(listed[0]?.telemetry.batteryPercent).toBe(64);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${credentials.deviceId}`,
      headers: adminHeaders,
    });
    expect(removed.statusCode).toBe(204);
  });
});

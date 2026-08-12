import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TabletDevice, TabletTelemetry } from '@homedash/contracts';
import { sqlite } from '../db/index.js';
import { AppError } from '../errors.js';

type PendingPairing = { codeHash: string; expiresAt: number };
let pendingPairing: PendingPairing | null = null;

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export function createPairingCode(): { code: string; expiresAt: string } {
  const code = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0');
  const expiresAt = Date.now() + 10 * 60_000;
  pendingPairing = { codeHash: hash(code), expiresAt };
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

export function pairTablet(code: string, name: string): { deviceId: string; token: string } {
  if (
    !pendingPairing ||
    pendingPairing.expiresAt < Date.now() ||
    pendingPairing.codeHash !== hash(code)
  ) {
    throw new AppError(
      401,
      'PAIRING_CODE_INVALID',
      "Le code d'association est invalide ou expiré.",
    );
  }
  pendingPairing = null;
  const deviceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  sqlite
    .prepare(
      'INSERT INTO tablet_devices(id, name, token_hash, telemetry, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(deviceId, name, hash(token), '{}', now, now);
  return { deviceId, token };
}

export function authenticateTablet(deviceId: string, token: string): void {
  const row = sqlite.prepare('SELECT token_hash FROM tablet_devices WHERE id = ?').get(deviceId) as
    { token_hash: string } | undefined;
  if (!row || row.token_hash !== hash(token)) {
    throw new AppError(401, 'TABLET_UNAUTHORIZED', 'Jeton tablette invalide.');
  }
}

export function saveTabletTelemetry(deviceId: string, telemetry: TabletTelemetry): void {
  const result = sqlite
    .prepare('UPDATE tablet_devices SET telemetry = ?, last_seen_at = ? WHERE id = ?')
    .run(JSON.stringify(telemetry), new Date().toISOString(), deviceId);
  if (result.changes === 0) throw new AppError(404, 'TABLET_NOT_FOUND', 'Tablette introuvable.');
}

export function listTablets(): TabletDevice[] {
  const rows = sqlite
    .prepare(
      'SELECT id, name, telemetry, last_seen_at, created_at FROM tablet_devices ORDER BY created_at',
    )
    .all() as Array<{
    id: string;
    name: string;
    telemetry: string;
    last_seen_at: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    telemetry: JSON.parse(row.telemetry) as TabletTelemetry,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  }));
}

export function removeTablet(deviceId: string): void {
  const result = sqlite.prepare('DELETE FROM tablet_devices WHERE id = ?').run(deviceId);
  if (result.changes === 0) throw new AppError(404, 'TABLET_NOT_FOUND', 'Tablette introuvable.');
}

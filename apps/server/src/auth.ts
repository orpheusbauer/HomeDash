import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';

const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const adminSessions = new Map<string, number>();

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneAdminSessions(now = Date.now()): void {
  for (const [token, expiresAt] of adminSessions) {
    if (expiresAt <= now) adminSessions.delete(token);
  }
}

export function createAdminSession(pin: string): { token: string; expiresAt: string } {
  if (!constantTimeEquals(pin, config.HOMEDASH_ADMIN_PIN)) {
    throw new AppError(401, 'ADMIN_PIN_INVALID', 'Code PIN administrateur incorrect.');
  }
  const now = Date.now();
  pruneAdminSessions(now);
  const token = randomBytes(32).toString('hex');
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  adminSessions.set(token, expiresAt);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.headers['x-homedash-admin'];
  const now = Date.now();
  pruneAdminSessions(now);
  if (typeof token !== 'string' || (adminSessions.get(token) ?? 0) <= now) {
    throw new AppError(
      401,
      'ADMIN_AUTH_REQUIRED',
      'Une session administrateur valide est requise.',
    );
  }
}

export async function requireSensorToken(request: FastifyRequest): Promise<void> {
  const sensorHeader = request.headers['x-homedash-sensor'];
  const token =
    typeof sensorHeader === 'string'
      ? sensorHeader
      : request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !constantTimeEquals(token, config.HOMEDASH_SENSOR_INGEST_TOKEN)) {
    throw new AppError(401, 'SENSOR_AUTH_REQUIRED', 'Jeton capteur invalide.');
  }
}

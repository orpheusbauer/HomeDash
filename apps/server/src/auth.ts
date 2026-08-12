import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function requireAdmin(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.headers['x-homedash-admin'];
  if (typeof token !== 'string' || !constantTimeEquals(token, config.HOMEDASH_ADMIN_TOKEN)) {
    throw new AppError(
      401,
      'ADMIN_AUTH_REQUIRED',
      'Une authentification administrateur est requise.',
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

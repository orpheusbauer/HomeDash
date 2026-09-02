import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOMEDASH_HOST: z.string().default('0.0.0.0'),
  HOMEDASH_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  HOMEDASH_DATABASE_PATH: z.string().default('./data/homedash.db'),
  HOMEDASH_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  HOMEDASH_TIMEZONE: z.string().default('Europe/Paris'),
  HOMEDASH_ADMIN_PIN: z
    .string()
    .regex(/^\d{4}$/)
    .default('0000'),
  HOMEDASH_SENSOR_INGEST_TOKEN: z.string().min(12).default('development-sensor-token'),
  HOMEDASH_ENCRYPTION_KEY: z.string().optional(),
  HOMEDASH_GITHUB_REPOSITORY: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .default('example/HomeDash'),
  HOMEDASH_GITHUB_TOKEN_FILE: z.string().optional(),
  HOMEDASH_ANDROID_UPDATE_CACHE: z.string().default('./data/android-updates'),
  HOMEDASH_UPDATER_SOCKET: z.string().default('/run/homedash-updater/updater.sock'),
  HOMEDASH_UPDATER_TOKEN: z.string().optional(),
  HOMEDASH_UPDATER_TOKEN_FILE: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  HOMEDASH_SYSTEM_METRICS_INTERVAL_MS: z.coerce.number().int().min(5_000).default(10_000),
  HOMEDASH_ENABLE_MOCK_SENSORS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

function readVersion(): string {
  const candidates = [resolve(process.cwd(), 'VERSION'), resolve(process.cwd(), '../../VERSION')];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8').trim();
    } catch {
      // The image can inject HOMEDASH_VERSION when VERSION is not beside the process.
    }
  }
  return process.env.HOMEDASH_VERSION ?? '0.4.0';
}

export const config = {
  ...envSchema.parse(process.env),
  version: readVersion(),
};

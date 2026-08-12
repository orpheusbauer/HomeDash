import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

const backupDirectory = resolve(dirname(resolve(config.HOMEDASH_DATABASE_PATH)), 'backups');

export function createBackup(): { filename: string; size: number; createdAt: string } {
  mkdirSync(backupDirectory, { recursive: true });
  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const filename = `homedash-${stamp}.db`;
  const path = resolve(backupDirectory, filename);
  const sqlPath = path.replace(/'/g, "''");
  sqlite.exec(`VACUUM INTO '${sqlPath}'`);
  const stat = statSync(path);
  return { filename: basename(path), size: stat.size, createdAt: createdAt.toISOString() };
}

export function listBackups(): Array<{ filename: string; size: number; createdAt: string }> {
  mkdirSync(backupDirectory, { recursive: true });
  return readdirSync(backupDirectory)
    .filter((name) => /^homedash-[0-9TZ-]+\.db$/.test(name))
    .map((filename) => {
      const stat = statSync(resolve(backupDirectory, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

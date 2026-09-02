import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { migrations } from './migrations.js';

if (config.NODE_ENV === 'production') process.umask(0o007);
const databasePath = resolve(config.HOMEDASH_DATABASE_PATH);
mkdirSync(dirname(databasePath), { recursive: true });

class HomeDashDatabase extends DatabaseSync {
  pragma(statement: string): void {
    this.exec(`PRAGMA ${statement}`);
  }

  transaction<TArgs extends unknown[], TResult>(
    callback: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs) => {
      this.exec('BEGIN IMMEDIATE');
      try {
        const result = callback(...args);
        this.exec('COMMIT');
        return result;
      } catch (error) {
        this.exec('ROLLBACK');
        throw error;
      }
    };
  }
}

export const sqlite = new HomeDashDatabase(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export function migrateDatabase(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    sqlite
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const insertMigration = sqlite.prepare(
    'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, new Date().toISOString());
    })();
  }
  sqlite.pragma('optimize');
}

export function seedDatabase(): void {
  const pageCount = (
    sqlite.prepare('SELECT COUNT(*) AS count FROM pages').get() as { count: number }
  ).count;
  if (pageCount > 0) return;

  const now = new Date().toISOString();
  const pageId = randomUUID();
  const noteId = randomUUID();
  const insertWidget = sqlite.prepare(`
    INSERT INTO widget_instances
      (id, page_id, widget_id, title, config, x, y, w, h, revision, created_at, updated_at)
    VALUES
      (@id, @pageId, @widgetId, @title, @config, @x, @y, @w, @h, 0, @now, @now)
  `);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        'INSERT INTO pages(id, name, slug, position, layout_revision, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)',
      )
      .run(pageId, 'Accueil', 'accueil', now, now);
    sqlite
      .prepare('INSERT INTO notes(id, content, revision, updated_at) VALUES (?, ?, 0, ?)')
      .run(
        noteId,
        'Bienvenue dans HomeDash. Touchez « Modifier » pour personnaliser cette page.',
        now,
      );
    const widgets: Array<{
      widgetId: string;
      x: number;
      y: number;
      w: number;
      h: number;
      config: Record<string, unknown>;
    }> = [
      {
        widgetId: 'clock',
        x: 0,
        y: 0,
        w: 12,
        h: 12,
        config: { format: '24h', showSeconds: false, timezone: config.HOMEDASH_TIMEZONE },
      },
      {
        widgetId: 'weather.current',
        x: 12,
        y: 0,
        w: 16,
        h: 16,
        config: { location: 'Paris', latitude: 48.8566, longitude: 2.3522 },
      },
      { widgetId: 'system', x: 28, y: 0, w: 20, h: 16, config: {} },
      { widgetId: 'notes', x: 0, y: 16, w: 16, h: 16, config: { noteId } },
      {
        widgetId: 'weather.forecast',
        x: 16,
        y: 16,
        w: 32,
        h: 16,
        config: { location: 'Paris', latitude: 48.8566, longitude: 2.3522 },
      },
    ];
    widgets.forEach((widget) =>
      insertWidget.run({
        id: randomUUID(),
        pageId,
        widgetId: widget.widgetId,
        title: null,
        config: JSON.stringify(widget.config),
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        now,
      }),
    );
    sqlite
      .prepare(
        `
        INSERT INTO sensors(id, name, type, location, value, unit, timestamp, status, source, created_at, updated_at)
        VALUES (?, ?, 'temperature', ?, ?, '°C', ?, 'online', 'mock', ?, ?)
      `,
      )
      .run('mock-indoor-temperature', 'Salon (simulation)', 'indoor', 21.4, now, now, now);
    sqlite
      .prepare(
        `
        INSERT INTO sensors(id, name, type, location, value, unit, timestamp, status, source, created_at, updated_at)
        VALUES (?, ?, 'temperature', ?, ?, '°C', ?, 'online', 'mock', ?, ?)
      `,
      )
      .run('mock-outdoor-temperature', 'Extérieur (simulation)', 'outdoor', 14.8, now, now, now);
  })();
}

export function initializeDatabase(): void {
  migrateDatabase();
  seedDatabase();
}

export function closeDatabase(): void {
  sqlite.close();
}

// ESM evaluates route modules before index.ts can execute its body. Initializing here ensures
// prepared statements in repositories always see a fully migrated schema.
initializeDatabase();

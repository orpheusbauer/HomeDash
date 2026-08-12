import { randomUUID } from 'node:crypto';
import type {
  BootstrapData,
  DashboardPage,
  LayoutItem,
  Note,
  Sensor,
  WidgetInstance,
} from '@homedash/contracts';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';
import { AppError } from '../errors.js';
import { getWidgetManifest, widgetCatalog } from '../widget-catalog.js';

interface PageRow {
  id: string;
  name: string;
  slug: string;
  position: number;
  layout_revision: number;
  created_at: string;
  updated_at: string;
}

interface WidgetRow {
  id: string;
  page_id: string;
  widget_id: string;
  title: string | null;
  config: string;
  x: number;
  y: number;
  w: number;
  h: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface NoteRow {
  id: string;
  content: string;
  revision: number;
  updated_at: string;
}

interface SensorRow {
  id: string;
  name: string;
  type: Sensor['type'];
  location: Sensor['location'];
  value: number | null;
  unit: string;
  timestamp: string | null;
  status: Sensor['status'];
  source: Sensor['source'];
}

const listPagesStatement = sqlite.prepare('SELECT * FROM pages ORDER BY position, created_at');
const listWidgetsStatement = sqlite.prepare(
  'SELECT * FROM widget_instances ORDER BY page_id, y, x',
);

function mapPage(row: PageRow): DashboardPage {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWidget(row: WidgetRow): WidgetInstance {
  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(row.config) as Record<string, unknown>;
  } catch {
    // A corrupted widget config is isolated to this instance.
  }
  return {
    id: row.id,
    pageId: row.page_id,
    widgetId: row.widget_id,
    title: row.title,
    config: parsedConfig,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  return slug || 'page';
}

function uniqueSlug(name: string, exceptPageId?: string): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  const statement = exceptPageId
    ? sqlite.prepare('SELECT 1 FROM pages WHERE slug = ? AND id != ?')
    : sqlite.prepare('SELECT 1 FROM pages WHERE slug = ?');
  while (exceptPageId ? statement.get(candidate, exceptPageId) : statement.get(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

export function getBootstrap(): BootstrapData {
  const pageRows = listPagesStatement.all() as unknown as PageRow[];
  return {
    version: config.version,
    pages: pageRows.map(mapPage),
    widgets: widgetCatalog,
    instances: (listWidgetsStatement.all() as unknown as WidgetRow[]).map(mapWidget),
    layoutRevision: Object.fromEntries(pageRows.map((page) => [page.id, page.layout_revision])),
    serverTime: new Date().toISOString(),
  };
}

export function createPage(name: string): DashboardPage {
  const now = new Date().toISOString();
  const id = randomUUID();
  const position = (
    sqlite.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM pages').get() as {
      next: number;
    }
  ).next;
  const slug = uniqueSlug(name);
  sqlite
    .prepare(
      'INSERT INTO pages(id, name, slug, position, layout_revision, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    )
    .run(id, name, slug, position, now, now);
  return { id, name, slug, position, createdAt: now, updatedAt: now };
}

export function updatePage(pageId: string, name: string): DashboardPage {
  const now = new Date().toISOString();
  const result = sqlite
    .prepare('UPDATE pages SET name = ?, slug = ?, updated_at = ? WHERE id = ?')
    .run(name, uniqueSlug(name, pageId), now, pageId);
  if (result.changes === 0) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page introuvable.');
  return mapPage(
    sqlite.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) as unknown as PageRow,
  );
}

export function deletePage(pageId: string): void {
  const count = (sqlite.prepare('SELECT COUNT(*) AS count FROM pages').get() as { count: number })
    .count;
  if (count <= 1)
    throw new AppError(409, 'LAST_PAGE', 'La dernière page ne peut pas être supprimée.');
  const result = sqlite.prepare('DELETE FROM pages WHERE id = ?').run(pageId);
  if (result.changes === 0) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page introuvable.');
}

export function createWidgetInstance(
  pageId: string,
  widgetId: string,
  configInput: Record<string, unknown>,
): WidgetInstance {
  const manifest = getWidgetManifest(widgetId);
  if (!manifest) throw new AppError(400, 'UNKNOWN_WIDGET', 'Type de widget inconnu.');
  if (!sqlite.prepare('SELECT 1 FROM pages WHERE id = ?').get(pageId)) {
    throw new AppError(404, 'PAGE_NOT_FOUND', 'Page introuvable.');
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const maxY = (
    sqlite
      .prepare('SELECT COALESCE(MAX(y + h), 0) AS maxY FROM widget_instances WHERE page_id = ?')
      .get(pageId) as { maxY: number }
  ).maxY;
  const configValue = { ...configInput };
  if (widgetId === 'notes' && typeof configValue.noteId !== 'string') {
    const noteId = randomUUID();
    sqlite
      .prepare('INSERT INTO notes(id, content, revision, updated_at) VALUES (?, ?, 0, ?)')
      .run(noteId, '', now);
    configValue.noteId = noteId;
  }
  if (widgetId.startsWith('weather.')) {
    configValue.location ??= 'Strasbourg';
    configValue.latitude ??= 48.5734;
    configValue.longitude ??= 7.7521;
  }
  if (widgetId === 'clock') {
    configValue.format ??= '24h';
    configValue.showSeconds ??= false;
    configValue.timezone ??= config.HOMEDASH_TIMEZONE;
  }
  sqlite
    .prepare(
      `
      INSERT INTO widget_instances
        (id, page_id, widget_id, title, config, x, y, w, h, revision, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?, 0, ?, ?)
    `,
    )
    .run(
      id,
      pageId,
      widgetId,
      JSON.stringify(configValue),
      maxY,
      manifest.size.default.w,
      manifest.size.default.h,
      now,
      now,
    );
  return mapWidget(
    sqlite.prepare('SELECT * FROM widget_instances WHERE id = ?').get(id) as unknown as WidgetRow,
  );
}

export function updateWidgetInstance(
  instanceId: string,
  input: { title?: string | null; config?: Record<string, unknown> },
): WidgetInstance {
  const current = sqlite.prepare('SELECT * FROM widget_instances WHERE id = ?').get(instanceId) as
    WidgetRow | undefined;
  if (!current) throw new AppError(404, 'WIDGET_NOT_FOUND', 'Widget introuvable.');
  const title = input.title === undefined ? current.title : input.title;
  const widgetConfig = input.config === undefined ? current.config : JSON.stringify(input.config);
  const now = new Date().toISOString();
  sqlite
    .prepare(
      'UPDATE widget_instances SET title = ?, config = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
    )
    .run(title, widgetConfig, now, instanceId);
  return mapWidget(
    sqlite
      .prepare('SELECT * FROM widget_instances WHERE id = ?')
      .get(instanceId) as unknown as WidgetRow,
  );
}

export function deleteWidgetInstance(instanceId: string): void {
  const current = sqlite
    .prepare('SELECT widget_id, config FROM widget_instances WHERE id = ?')
    .get(instanceId) as { widget_id: string; config: string } | undefined;
  if (!current) throw new AppError(404, 'WIDGET_NOT_FOUND', 'Widget introuvable.');
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM widget_instances WHERE id = ?').run(instanceId);
    if (current.widget_id === 'notes') {
      const noteId = (JSON.parse(current.config) as { noteId?: unknown }).noteId;
      if (typeof noteId === 'string') sqlite.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    }
  })();
}

export function saveLayout(pageId: string, expectedRevision: number, items: LayoutItem[]): number {
  return sqlite.transaction(() => {
    const page = sqlite.prepare('SELECT layout_revision FROM pages WHERE id = ?').get(pageId) as
      { layout_revision: number } | undefined;
    if (!page) throw new AppError(404, 'PAGE_NOT_FOUND', 'Page introuvable.');
    if (page.layout_revision !== expectedRevision) {
      throw new AppError(409, 'LAYOUT_CONFLICT', 'La disposition a changé sur un autre appareil.', {
        currentRevision: page.layout_revision,
      });
    }
    const existing = sqlite
      .prepare('SELECT id, x, y, w, h FROM widget_instances WHERE page_id = ? ORDER BY id')
      .all(pageId) as Array<LayoutItem>;
    const knownIds = new Set(existing.map((item) => item.id));
    if (items.some((item) => !knownIds.has(item.id))) {
      throw new AppError(400, 'INVALID_LAYOUT', 'La disposition contient un widget inconnu.');
    }
    const now = new Date().toISOString();
    sqlite
      .prepare(
        'INSERT INTO layout_revisions(id, page_id, snapshot, revision, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), pageId, JSON.stringify(existing), page.layout_revision, now);
    const update = sqlite.prepare(
      'UPDATE widget_instances SET x = ?, y = ?, w = ?, h = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND page_id = ?',
    );
    items.forEach((item) => update.run(item.x, item.y, item.w, item.h, now, item.id, pageId));
    const nextRevision = page.layout_revision + 1;
    sqlite
      .prepare('UPDATE pages SET layout_revision = ?, updated_at = ? WHERE id = ?')
      .run(nextRevision, now, pageId);
    sqlite
      .prepare(
        `
      DELETE FROM layout_revisions
      WHERE page_id = ? AND id NOT IN (
        SELECT id FROM layout_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT 20
      )
    `,
      )
      .run(pageId, pageId);
    return nextRevision;
  })();
}

export function undoLayout(pageId: string): { revision: number; items: LayoutItem[] } {
  return sqlite.transaction(() => {
    const snapshotRow = sqlite
      .prepare(
        'SELECT id, snapshot FROM layout_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(pageId) as { id: string; snapshot: string } | undefined;
    if (!snapshotRow)
      throw new AppError(409, 'NO_LAYOUT_HISTORY', 'Aucune disposition précédente.');
    const snapshot = JSON.parse(snapshotRow.snapshot) as LayoutItem[];
    const now = new Date().toISOString();
    const update = sqlite.prepare(
      'UPDATE widget_instances SET x = ?, y = ?, w = ?, h = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND page_id = ?',
    );
    snapshot.forEach((item) => update.run(item.x, item.y, item.w, item.h, now, item.id, pageId));
    sqlite.prepare('DELETE FROM layout_revisions WHERE id = ?').run(snapshotRow.id);
    sqlite
      .prepare(
        'UPDATE pages SET layout_revision = layout_revision + 1, updated_at = ? WHERE id = ?',
      )
      .run(now, pageId);
    const revision = (
      sqlite.prepare('SELECT layout_revision AS revision FROM pages WHERE id = ?').get(pageId) as {
        revision: number;
      }
    ).revision;
    return { revision, items: snapshot };
  })();
}

export function getNote(noteId: string): Note {
  const row = sqlite.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as NoteRow | undefined;
  if (!row) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note introuvable.');
  return { id: row.id, content: row.content, revision: row.revision, updatedAt: row.updated_at };
}

export function updateNote(noteId: string, content: string, expectedRevision: number): Note {
  const now = new Date().toISOString();
  const result = sqlite
    .prepare(
      'UPDATE notes SET content = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
    )
    .run(content, now, noteId, expectedRevision);
  if (result.changes === 0) {
    if (!sqlite.prepare('SELECT 1 FROM notes WHERE id = ?').get(noteId)) {
      throw new AppError(404, 'NOTE_NOT_FOUND', 'Note introuvable.');
    }
    throw new AppError(
      409,
      'NOTE_CONFLICT',
      'Cette note a été modifiée sur un autre appareil.',
      getNote(noteId),
    );
  }
  return getNote(noteId);
}

function mapSensor(row: SensorRow): Sensor {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    location: row.location,
    value: row.value,
    unit: row.unit,
    timestamp: row.timestamp,
    status: row.status,
    source: row.source,
  };
}

export function listSensors(): Sensor[] {
  const rows = sqlite
    .prepare('SELECT * FROM sensors ORDER BY location, name')
    .all() as unknown as SensorRow[];
  const staleCutoff = Date.now() - 5 * 60_000;
  return rows.map((row) => {
    if (row.timestamp && Date.parse(row.timestamp) < staleCutoff && row.source !== 'mock')
      row.status = 'stale';
    return mapSensor(row);
  });
}

export function getSensor(sensorId: string): Sensor {
  const row = sqlite.prepare('SELECT * FROM sensors WHERE id = ?').get(sensorId) as
    SensorRow | undefined;
  if (!row) throw new AppError(404, 'SENSOR_NOT_FOUND', 'Capteur introuvable.');
  return mapSensor(row);
}

export function upsertSensor(input: {
  id: string;
  name?: string;
  type: Sensor['type'];
  location: Sensor['location'];
  value: number;
  unit: string;
  timestamp?: string;
  source?: Sensor['source'];
}): Sensor {
  const now = new Date().toISOString();
  const timestamp = input.timestamp ?? now;
  sqlite
    .prepare(
      `
      INSERT INTO sensors(id, name, type, location, value, unit, timestamp, status, source, created_at, updated_at)
      VALUES (@id, @name, @type, @location, @value, @unit, @timestamp, 'online', @source, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        location = excluded.location,
        value = excluded.value,
        unit = excluded.unit,
        timestamp = excluded.timestamp,
        status = 'online',
        source = excluded.source,
        updated_at = excluded.updated_at
    `,
    )
    .run({
      ...input,
      name: input.name ?? input.id,
      source: input.source ?? 'http',
      timestamp,
      now,
    });
  return getSensor(input.id);
}

export function tickMockSensors(): Sensor[] {
  const mockSensors = sqlite
    .prepare("SELECT id, value FROM sensors WHERE source = 'mock'")
    .all() as Array<{
    id: string;
    value: number;
  }>;
  return mockSensors.map((sensor) =>
    upsertSensor({
      id: sensor.id,
      name: getSensor(sensor.id).name,
      type: getSensor(sensor.id).type,
      location: getSensor(sensor.id).location,
      unit: getSensor(sensor.id).unit,
      value: Math.round((sensor.value + (Math.random() - 0.5) * 0.3) * 10) / 10,
      source: 'mock',
    }),
  );
}

export function getCache<T>(
  key: string,
): { payload: T; fetchedAt: string; expired: boolean } | undefined {
  const row = sqlite.prepare('SELECT * FROM external_cache WHERE key = ?').get(key) as
    { payload: string; fetched_at: string; expires_at: string } | undefined;
  if (!row) return undefined;
  try {
    return {
      payload: JSON.parse(row.payload) as T,
      fetchedAt: row.fetched_at,
      expired: Date.parse(row.expires_at) <= Date.now(),
    };
  } catch {
    return undefined;
  }
}

export function setCache(key: string, payload: unknown, ttlMs: number): void {
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + ttlMs);
  sqlite
    .prepare(
      `
      INSERT INTO external_cache(key, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
    `,
    )
    .run(key, JSON.stringify(payload), fetchedAt.toISOString(), expiresAt.toISOString());
}

export function deleteCacheByPrefix(prefix: string): void {
  sqlite
    .prepare("DELETE FROM external_cache WHERE key LIKE ? ESCAPE '\\'")
    .run(`${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
}

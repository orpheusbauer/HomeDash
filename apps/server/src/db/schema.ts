import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
    layoutRevision: integer('layout_revision').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_pages_slug').on(table.slug),
    index('idx_pages_position').on(table.position),
  ],
);

export const widgetInstances = sqliteTable(
  'widget_instances',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    widgetId: text('widget_id').notNull(),
    title: text('title'),
    config: text('config').notNull().default('{}'),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    w: integer('w').notNull(),
    h: integer('h').notNull(),
    revision: integer('revision').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_widget_instances_page').on(table.pageId)],
);

export const layoutRevisions = sqliteTable(
  'layout_revisions',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    snapshot: text('snapshot').notNull(),
    revision: integer('revision').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_layout_revisions_page_created').on(table.pageId, table.createdAt)],
);

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  content: text('content').notNull().default(''),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const sensors = sqliteTable(
  'sensors',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    location: text('location').notNull(),
    value: real('value'),
    unit: text('unit').notNull(),
    timestamp: text('timestamp'),
    status: text('status').notNull(),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_sensors_type_location').on(table.type, table.location)],
);

export const externalCache = sqliteTable('external_cache', {
  key: text('key').primaryKey(),
  payload: text('payload').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tabletDevices = sqliteTable('tablet_devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  telemetry: text('telemetry').notNull().default('{}'),
  lastSeenAt: text('last_seen_at'),
  createdAt: text('created_at').notNull(),
});

export const schema = {
  pages,
  widgetInstances,
  layoutRevisions,
  notes,
  sensors,
  externalCache,
  settings,
  tabletDevices,
};

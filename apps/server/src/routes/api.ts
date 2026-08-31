import { z } from 'zod';
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { ingestSensorSchema, saveLayoutSchema, updateNoteSchema } from '@homedash/contracts';
import { createAdminSession, requireAdmin, requireSensorToken } from '../auth.js';
import { config } from '../config.js';
import { tabletTelemetrySchema } from '@homedash/contracts';
import { AppError } from '../errors.js';
import {
  createPage,
  createWidgetInstance,
  deletePage,
  deleteWidgetInstance,
  getBootstrap,
  getNote,
  getSensor,
  listSensors,
  saveLayout,
  tickMockSensors,
  undoLayout,
  updateNote,
  updatePage,
  updateWidgetInstance,
  upsertSensor,
} from '../repositories/dashboard.js';
import { broadcast, realtimeClientCount } from '../realtime.js';
import {
  calendarStatus,
  createEvent,
  deleteEvent,
  listCalendars,
  listEvents,
  updateEvent,
} from '../services/calendar.js';
import { readNetworkMetrics, readSystemMetrics } from '../services/system.js';
import { getWeather } from '../services/weather.js';
import { createBackup, listBackups } from '../services/backup.js';
import {
  checkForUpdates,
  installUpdate,
  prepareAndroidApk,
  updaterRequest,
} from '../services/updates.js';
import {
  authenticateTablet,
  createPairingCode,
  listTablets,
  pairTablet,
  removeTablet,
  saveTabletTelemetry,
} from '../services/devices.js';

const idParams = z.object({ id: z.string().uuid() });
const androidUpdateParams = idParams.extend({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });
const pageBody = z.object({ name: z.string().trim().min(1).max(60) });
const widgetBody = z.object({
  widgetId: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
const updateWidgetBody = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', version: config.version }));
  app.get('/health/ready', async () => ({
    status: 'ready',
    realtimeClients: realtimeClientCount(),
  }));

  app.get('/api/v1/bootstrap', async () => getBootstrap());

  app.post('/api/v1/pages', { preHandler: requireAdmin }, async (request, reply) => {
    const body = pageBody.parse(request.body);
    const page = createPage(body.name);
    return reply.code(201).send(page);
  });
  app.patch('/api/v1/pages/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    return updatePage(id, pageBody.parse(request.body).name);
  });
  app.delete('/api/v1/pages/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    deletePage(id);
    return reply.code(204).send();
  });

  app.post('/api/v1/pages/:id/widgets', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = widgetBody.parse(request.body);
    const widget = createWidgetInstance(id, body.widgetId, body.config);
    broadcast({ type: 'dashboard.changed', payload: { pageId: id } });
    return reply.code(201).send(widget);
  });
  app.patch('/api/v1/widgets/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateWidgetBody.parse(request.body);
    return updateWidgetInstance(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
    });
  });
  app.delete('/api/v1/widgets/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    deleteWidgetInstance(id);
    return reply.code(204).send();
  });

  app.put('/api/v1/pages/:id/layout', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = saveLayoutSchema.parse(request.body);
    const revision = saveLayout(id, body.expectedRevision, body.items);
    broadcast({ type: 'dashboard.changed', payload: { pageId: id } });
    return { revision };
  });
  app.post('/api/v1/pages/:id/layout/undo', { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const result = undoLayout(id);
    broadcast({ type: 'dashboard.changed', payload: { pageId: id } });
    return result;
  });

  app.get('/api/v1/notes/:id', async (request) => getNote(idParams.parse(request.params).id));
  app.put('/api/v1/notes/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = updateNoteSchema.parse(request.body);
    return updateNote(id, body.content, body.expectedRevision);
  });

  app.get('/api/v1/system', async () => readSystemMetrics());
  app.get('/api/v1/network', async () => readNetworkMetrics());
  app.get('/api/v1/weather', async (request) => {
    const query = z
      .object({
        location: z.string().trim().min(1).max(120).default('Strasbourg'),
        latitude: z.coerce.number().min(-90).max(90),
        longitude: z.coerce.number().min(-180).max(180),
      })
      .parse(request.query);
    return getWeather(query.location, query.latitude, query.longitude);
  });

  app.get('/api/v1/sensors', async () => listSensors());
  app.get('/api/v1/sensors/:id', async (request) => {
    const id = z.object({ id: z.string().min(1).max(80) }).parse(request.params).id;
    return getSensor(id);
  });
  app.post('/api/v1/sensors/ingest', { preHandler: requireSensorToken }, async (request, reply) => {
    const body = ingestSensorSchema.parse(request.body);
    const sensor = upsertSensor({
      id: body.id,
      type: body.type,
      location: body.location,
      value: body.value,
      unit: body.unit,
      source: 'http',
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.timestamp !== undefined ? { timestamp: body.timestamp } : {}),
    });
    broadcast({ type: 'sensor.updated', payload: sensor });
    return reply.code(202).send(sensor);
  });
  app.post('/api/v1/sensors/mock/tick', { preHandler: requireAdmin }, async () => {
    const sensors = tickMockSensors();
    sensors.forEach((sensor) => broadcast({ type: 'sensor.updated', payload: sensor }));
    return sensors;
  });

  app.get('/api/v1/calendar/status', async () => calendarStatus());
  app.get('/api/v1/calendar/calendars', async () => listCalendars());
  app.get('/api/v1/calendar/events', async (request) => {
    const query = z
      .object({
        calendarIds: z.string().default('primary'),
        days: z.coerce.number().int().min(1).max(90).default(14),
      })
      .parse(request.query);
    return listEvents(query.calendarIds.split(',').filter(Boolean), query.days);
  });
  app.post('/api/v1/calendar/events', { preHandler: requireAdmin }, async (request, reply) => {
    const body = z
      .object({ calendarId: z.string(), event: z.record(z.string(), z.unknown()) })
      .parse(request.body);
    return reply.code(201).send(await createEvent(body.calendarId, body.event));
  });
  app.patch('/api/v1/calendar/events/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ calendarId: z.string(), event: z.record(z.string(), z.unknown()) })
      .parse(request.body);
    return updateEvent(body.calendarId, id, body.event);
  });
  app.delete(
    '/api/v1/calendar/events/:id',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const query = z.object({ calendarId: z.string() }).parse(request.query);
      await deleteEvent(query.calendarId, id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/admin/unlock',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const { pin } = z.object({ pin: z.string().regex(/^\d{4}$/) }).parse(request.body);
      return createAdminSession(pin);
    },
  );
  app.get('/api/v1/admin/verify', { preHandler: requireAdmin }, async () => ({
    authenticated: true,
  }));
  app.post('/api/v1/devices/pairing', { preHandler: requireAdmin }, async () =>
    createPairingCode(),
  );
  app.post('/api/v1/devices/pair', async (request, reply) => {
    const body = z
      .object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(80) })
      .parse(request.body);
    return reply.code(201).send(pairTablet(body.code, body.name));
  });
  app.post('/api/v1/devices/:id/telemetry', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const token = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    authenticateTablet(id, token);
    saveTabletTelemetry(id, tabletTelemetrySchema.parse(request.body));
    return reply.code(204).send();
  });
  app.get('/api/v1/devices/:id/updates/android/:version/apk', async (request, reply) => {
    const { id, version } = androidUpdateParams.parse(request.params);
    const token = String(request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    authenticateTablet(id, token);
    const apk = await prepareAndroidApk(version);
    reply
      .header('Content-Type', 'application/vnd.android.package-archive')
      .header('Content-Length', String(apk.size))
      .header('Content-Disposition', `attachment; filename="${apk.fileName}"`)
      .header('X-HomeDash-SHA256', apk.digest)
      .header('Cache-Control', 'private, no-store');
    return reply.send(createReadStream(apk.path));
  });
  app.get('/api/v1/devices', { preHandler: requireAdmin }, async () => listTablets());
  app.delete('/api/v1/devices/:id', { preHandler: requireAdmin }, async (request, reply) => {
    removeTablet(idParams.parse(request.params).id);
    return reply.code(204).send();
  });
  app.get('/api/v1/updates/check', { preHandler: requireAdmin }, async () => checkForUpdates());
  app.get('/api/v1/updates/status', { preHandler: requireAdmin }, async () =>
    updaterRequest('/status'),
  );
  app.post('/api/v1/updates/install', { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({ manifest: z.record(z.string(), z.unknown()) }).parse(request.body);
    return reply.code(202).send(await installUpdate(body.manifest));
  });
  app.get('/api/v1/backups', { preHandler: requireAdmin }, async () => listBackups());
  app.post('/api/v1/backups', { preHandler: requireAdmin }, async (request, reply) =>
    reply.code(201).send(createBackup()),
  );
  app.get('/api/v1/meta', async () => ({
    version: config.version,
    timezone: config.HOMEDASH_TIMEZONE,
    githubRepository: config.HOMEDASH_GITHUB_REPOSITORY,
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: error.issues },
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Erreur interne HomeDash.' } });
  });
}

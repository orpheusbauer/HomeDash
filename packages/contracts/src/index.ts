import { z } from 'zod';

export const widgetStatusSchema = z.enum(['loading', 'ready', 'stale', 'offline', 'error']);
export type WidgetStatus = z.infer<typeof widgetStatusSchema>;

export const gridSizeSchema = z.object({
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(96),
});

export const widgetCapabilitySchema = z.enum([
  'network',
  'storage',
  'sensors',
  'calendar',
  'system',
  'realtime',
]);

export const widgetManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(240),
  category: z.string().min(1).max(60),
  icon: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  size: z.object({
    min: gridSizeSchema,
    default: gridSizeSchema,
    max: gridSizeSchema.optional(),
  }),
  capabilities: z.array(widgetCapabilitySchema).default([]),
  configSchema: z.record(z.string(), z.unknown()),
  refreshSeconds: z.number().int().min(0).max(86400).default(0),
  configSchemaVersion: z.number().int().min(1).default(1),
});
export type WidgetManifest = z.infer<typeof widgetManifestSchema>;

export const pageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(80),
  position: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DashboardPage = z.infer<typeof pageSchema>;

export const widgetInstanceSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  widgetId: z.string(),
  title: z.string().max(80).nullable(),
  config: z.record(z.string(), z.unknown()),
  x: z.number().int().min(0).max(47),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(96),
  revision: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;

export const layoutItemSchema = z
  .object({
    id: z.string().uuid(),
    x: z.number().int().min(0).max(47),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(48),
    h: z.number().int().min(1).max(96),
  })
  .refine((item) => item.x + item.w <= 48, { message: 'Widget outside the 48-column grid' });
export type LayoutItem = z.infer<typeof layoutItemSchema>;

export const saveLayoutSchema = z.object({
  expectedRevision: z.number().int().min(0),
  items: z.array(layoutItemSchema).max(100),
});
export type SaveLayoutInput = z.infer<typeof saveLayoutSchema>;

export const noteSchema = z.object({
  id: z.string().uuid(),
  content: z.string().max(20_000),
  revision: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});
export type Note = z.infer<typeof noteSchema>;

export const updateNoteSchema = z.object({
  content: z.string().max(20_000),
  expectedRevision: z.number().int().min(0),
});

export const sensorSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  type: z.enum(['temperature', 'humidity', 'pressure', 'air-quality', 'generic']),
  location: z.enum(['indoor', 'outdoor', 'other']),
  value: z.number().nullable(),
  unit: z.string().max(16),
  timestamp: z.string().datetime().nullable(),
  status: z.enum(['online', 'stale', 'offline', 'unknown']),
  source: z.enum(['mock', 'http', 'mqtt', 'esphome', 'manual']),
});
export type Sensor = z.infer<typeof sensorSchema>;

export const ingestSensorSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120).optional(),
  type: sensorSchema.shape.type.default('generic'),
  location: sensorSchema.shape.location.default('other'),
  value: z.number().finite(),
  unit: z.string().min(1).max(16),
  timestamp: z.string().datetime().optional(),
});
export type IngestSensorInput = z.infer<typeof ingestSensorSchema>;

export const systemMetricsSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memoryUsedBytes: z.number().nonnegative(),
  memoryTotalBytes: z.number().positive(),
  storageUsedBytes: z.number().nonnegative().nullable(),
  storageTotalBytes: z.number().positive().nullable(),
  cpuTemperatureCelsius: z.number().nullable(),
  uptimeSeconds: z.number().nonnegative(),
  hostname: z.string(),
  platform: z.string(),
  updatedAt: z.string().datetime(),
});
export type SystemMetrics = z.infer<typeof systemMetricsSchema>;

export const networkMetricsSchema = z.object({
  online: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  localAddresses: z.array(z.string()),
  hostname: z.string(),
  updatedAt: z.string().datetime(),
});
export type NetworkMetrics = z.infer<typeof networkMetricsSchema>;

export const weatherSchema = z.object({
  location: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  current: z.object({
    temperature: z.number(),
    apparentTemperature: z.number().nullable(),
    humidity: z.number().nullable(),
    windSpeed: z.number().nullable(),
    weatherCode: z.number().int(),
    isDay: z.boolean(),
    time: z.string(),
  }),
  hourly: z.array(
    z.object({
      time: z.string(),
      temperature: z.number(),
      humidity: z.number().nullable(),
      weatherCode: z.number().int(),
      precipitationProbability: z.number().nullable(),
    }),
  ),
  daily: z.array(
    z.object({
      date: z.string(),
      temperatureMin: z.number(),
      temperatureMax: z.number(),
      weatherCode: z.number().int(),
      precipitationProbability: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string().datetime(),
  stale: z.boolean(),
});
export type WeatherData = z.infer<typeof weatherSchema>;

export const calendarEventSchema = z.object({
  id: z.string(),
  calendarId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  status: z.string(),
  htmlLink: z.string().url().nullable(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const tabletTelemetrySchema = z.object({
  batteryPercent: z.number().min(0).max(100).nullable().optional(),
  charging: z.boolean().optional(),
  screenOn: z.boolean().optional(),
  appVersion: z.string().max(40).optional(),
  presenceState: z.enum(['present', 'absent', 'unknown']).optional(),
});
export type TabletTelemetry = z.infer<typeof tabletTelemetrySchema>;

export const tabletDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  telemetry: tabletTelemetrySchema,
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type TabletDevice = z.infer<typeof tabletDeviceSchema>;

export const realtimeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sensor.updated'), payload: sensorSchema }),
  z.object({ type: z.literal('system.updated'), payload: systemMetricsSchema }),
  z.object({
    type: z.literal('dashboard.changed'),
    payload: z.object({ pageId: z.string().uuid() }),
  }),
  z.object({ type: z.literal('server.hello'), payload: z.object({ version: z.string() }) }),
]);
export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;

export const bootstrapSchema = z.object({
  version: z.string(),
  pages: z.array(pageSchema),
  widgets: z.array(widgetManifestSchema),
  instances: z.array(widgetInstanceSchema),
  layoutRevision: z.record(z.string(), z.number().int().nonnegative()),
  serverTime: z.string().datetime(),
});
export type BootstrapData = z.infer<typeof bootstrapSchema>;

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

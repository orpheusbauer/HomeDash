import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/index.js';
import { broadcast } from './realtime.js';
import { readSystemMetrics } from './services/system.js';

const app = await createApp();

const mockTimer = config.HOMEDASH_ENABLE_MOCK_SENSORS
  ? setInterval(() => {
      void import('./repositories/dashboard.js').then(({ tickMockSensors }) => {
        tickMockSensors().forEach((sensor) =>
          broadcast({ type: 'sensor.updated', payload: sensor }),
        );
      });
    }, 30_000)
  : undefined;
mockTimer?.unref();

const systemTimer = setInterval(() => {
  void readSystemMetrics().then((metrics) =>
    broadcast({ type: 'system.updated', payload: metrics }),
  );
}, config.HOMEDASH_SYSTEM_METRICS_INTERVAL_MS);
systemTimer.unref();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'HomeDash stopping');
  if (mockTimer) clearInterval(mockTimer);
  clearInterval(systemTimer);
  await app.close();
  closeDatabase();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOMEDASH_HOST, port: config.HOMEDASH_PORT });
  app.log.info({ version: config.version }, 'HomeDash server started');
} catch (error) {
  app.log.fatal(error);
  closeDatabase();
  process.exit(1);
}

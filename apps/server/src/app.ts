import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { addRealtimeClient } from './realtime.js';
import { registerApiRoutes } from './routes/api.js';
import { registerWebAssets } from './web-assets.js';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'development'
        ? { level: 'info', transport: { target: 'pino-pretty' } }
        : { level: 'info' },
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });

  await app.register(cors, {
    origin:
      config.NODE_ENV === 'development'
        ? [config.HOMEDASH_PUBLIC_URL, 'http://localhost:5173']
        : false,
  });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute' });
  await app.register(websocket);

  app.get('/api/v1/realtime', { websocket: true }, (socket) => {
    addRealtimeClient(socket);
    socket.send(JSON.stringify({ type: 'server.hello', payload: { version: config.version } }));
  });

  await registerApiRoutes(app);
  const staticCandidates = [
    resolve(process.cwd(), 'apps/web/dist'),
    resolve(process.cwd(), 'public'),
  ];
  const staticRoot = staticCandidates.find((candidate) =>
    existsSync(resolve(candidate, 'index.html')),
  );
  if (staticRoot) {
    await registerWebAssets(app, staticRoot);
  }
  return app;
}

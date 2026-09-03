import { extname } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export async function registerWebAssets(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders(response, path) {
      // The entry point and worker must never refer to a previous release's bundles.
      if (path.endsWith('.html') || path.endsWith('sw.js')) {
        response.header('Cache-Control', 'no-store');
      }
    },
  });
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      pathname.startsWith('/api/') ||
      pathname.startsWith('/health/') ||
      pathname.startsWith('/assets/') ||
      extname(pathname)
    ) {
      return reply
        .code(404)
        .header('Cache-Control', 'no-store')
        .send({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
    }
    return reply.header('Cache-Control', 'no-store').sendFile('index.html');
  });
}

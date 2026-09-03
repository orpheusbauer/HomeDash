import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerWebAssets } from './web-assets.js';

const directory = mkdtempSync(join(tmpdir(), 'homedash-web-assets-'));
let app: FastifyInstance;
beforeAll(async () => {
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'index.html'), '<html>HomeDash</html>');
  writeFileSync(join(directory, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  writeFileSync(join(directory, 'assets/index-current.js'), 'window.dashboard = true;');
  app = Fastify();
  await registerWebAssets(app, directory);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('fichiers Web entre deux releases', () => {
  it.each(['/', '/index.html', '/sw.js', '/dashboard'])(
    'ne garde pas %s dans le cache HTTP',
    async (url) => {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );
  it.each([
    '/assets/index-old.js',
    '/assets/index-old.css',
    '/missing.js',
    '/api/missing',
    '/health/missing',
  ])('renvoie une vraie erreur pour %s, jamais la page HTML', async (url) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).not.toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('sert toujours les scripts de la version courante', async () => {
    const response = await app.inject({ url: '/assets/index-current.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.body).toContain('window.dashboard');
  });
});

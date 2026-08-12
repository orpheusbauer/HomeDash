#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const secretPath = process.argv[2];
if (!secretPath)
  throw new Error('Usage: node scripts/google-oauth-helper.mjs chemin/client_secret.json');
const document = JSON.parse(readFileSync(secretPath, 'utf8'));
const client = document.installed ?? document.web;
if (!client?.client_id || !client?.client_secret)
  throw new Error(
    'Fichier OAuth Google invalide. Utilisez un client de type Application de bureau.',
  );
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(24).toString('hex');

const server = createServer(async (request, response) => {
  const current = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (current.pathname !== '/oauth/callback') return response.end('HomeDash OAuth');
  if (current.searchParams.get('state') !== state) {
    response.statusCode = 400;
    return response.end('État OAuth invalide.');
  }
  const code = current.searchParams.get('code');
  if (!code) {
    response.statusCode = 400;
    return response.end('Autorisation refusée.');
  }
  const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const tokens = await tokenResponse.json();
  response.end('Autorisation reçue. Revenez dans le terminal puis fermez cet onglet.');
  console.log('\nCopiez ces valeurs dans /etc/homedash/homedash.env :');
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${client.client_id}`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${client.client_secret}`);
  console.log(
    `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token ?? 'ABSENT_REVOQUEZ_L_ACCES_ET_REESSAYEZ'}`,
  );
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).forEach(([key, value]) => auth.searchParams.set(key, value));
  console.log(`Ouvrez cette adresse si le navigateur ne démarre pas :\n${auth}`);
  const command =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', String(auth)]]
      : process.platform === 'darwin'
        ? ['open', [String(auth)]]
        : ['xdg-open', [String(auth)]];
  spawn(command[0], command[1], { detached: true, stdio: 'ignore' }).unref();
});

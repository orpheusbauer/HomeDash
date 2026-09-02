#!/usr/local/bin/node
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

const socketPath = '/run/homedash-updater/updater.sock';
const tokenFile = '/etc/homedash/updater-token';
const updater = '/usr/local/sbin/homedash-update-native';
const statusFile = '/var/lib/homedash/data/update-status.json';
const logFile = '/var/lib/homedash/data/native-update.log';
const homedashGroupId = Number(process.env.HOMEDASH_GROUP_ID || 0);

let running = false;
let status = readStatus();

function readStatus() {
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    return { kind: 'native', state: 'idle', updatedAt: new Date().toISOString() };
  }
}

function updateStatus(next) {
  status = { kind: 'native', ...status, ...next, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(statusFile), { recursive: true });
  const temporary = `${statusFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(status, null, 2), { mode: 0o640 });
  if (homedashGroupId > 0) chownSync(temporary, 0, homedashGroupId);
  renameSync(temporary, statusFile);
}

function json(response, code, body) {
  response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  if (!existsSync(tokenFile)) return false;
  const expected = readFileSync(tokenFile, 'utf8').trim();
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validatedVersion(input) {
  if (!input || typeof input !== 'object' || input.kind !== 'native') {
    throw new Error('Manifeste natif manquant');
  }
  const version = String(input.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version invalide');
  const expectedArchive = `homedash-native-${version}.tar.gz`;
  if (
    input.tag !== `v${version}` ||
    input.archive !== expectedArchive ||
    input.checksum !== `${expectedArchive}.sha256`
  ) {
    throw new Error('Assets de release invalides');
  }
  return version;
}

function runUpdate(version, jobId) {
  running = true;
  updateStatus({ state: 'installing', jobId, targetVersion: version, error: null });
  const log = openSync(logFile, 'a', 0o640);
  const child = spawn(updater, [`v${version}`], {
    shell: false,
    stdio: ['ignore', log, log],
    env: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'C.UTF-8',
    },
  });
  closeSync(log);
  child.once('error', (error) => {
    running = false;
    updateStatus({ state: 'failed', error: String(error) });
  });
  child.once('exit', (code, signal) => {
    running = false;
    updateStatus(
      code === 0
        ? { state: 'complete', installedVersion: version, completedAt: new Date().toISOString() }
        : {
            state: 'failed',
            error: `homedash-update-native terminé avec code ${code ?? 'inconnu'}${signal ? ` (${signal})` : ''}`,
          },
    );
  });
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    if (request.method === 'GET' && request.url === '/status') return json(response, 200, status);
    if (request.method === 'POST' && request.url === '/install') {
      if (running)
        return json(response, 409, { error: 'update already running', jobId: status.jobId });
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 16 * 1024) throw new Error('Requête trop volumineuse');
      }
      const version = validatedVersion(JSON.parse(raw || '{}'));
      const jobId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      json(response, 202, { accepted: true, jobId });
      runUpdate(version, jobId);
      return;
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 400, { error: String(error) });
  }
});

mkdirSync(dirname(socketPath), { recursive: true });
if (existsSync(socketPath)) rmSync(socketPath, { force: true });
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o660);
  if (homedashGroupId > 0) chownSync(socketPath, 0, homedashGroupId);
  updateStatus(status.state === 'installing' ? { state: 'interrupted' } : {});
});

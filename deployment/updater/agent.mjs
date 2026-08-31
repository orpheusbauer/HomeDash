#!/usr/bin/env node
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.env.HOMEDASH_ROOT || '/opt/homedash');
const dataDirectory = resolve(process.env.HOMEDASH_DATA_DIR || '/var/lib/homedash/data');
const databasePath = resolve(dataDirectory, 'homedash.db');
const backupDirectory = resolve(dataDirectory, 'backups');
const composeFile = resolve(root, 'deployment/docker/compose.yml');
const releaseEnv = resolve(dataDirectory, 'release.env');
const socketPath = resolve(
  process.env.HOMEDASH_UPDATER_SOCKET || '/run/homedash-updater/updater.sock',
);
const tokenFile = resolve(process.env.HOMEDASH_UPDATER_TOKEN_FILE || '/etc/homedash/updater-token');
const allowedImage = process.env.HOMEDASH_ALLOWED_IMAGE || 'ghcr.io/example/homedash';
const statusFile = resolve(dataDirectory, 'update-status.json');

let running = false;
let status = readStatus();

function readStatus() {
  try {
    return JSON.parse(readFileSync(statusFile, 'utf8'));
  } catch {
    return { state: 'idle', updatedAt: new Date().toISOString() };
  }
}

function updateStatus(next) {
  status = { ...status, ...next, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(statusFile), { recursive: true });
  const temporary = `${statusFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(status, null, 2), { mode: 0o640 });
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

function validateManifest(input) {
  if (!input || typeof input !== 'object') throw new Error('Manifest missing');
  const { version, image, digest } = input;
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error('Invalid version');
  if (image !== allowedImage) throw new Error('Image is not allowlisted');
  if (!/^sha256:[a-f0-9]{64}$/.test(String(digest))) throw new Error('Invalid digest');
  return { version: String(version), image: String(image), digest: String(digest) };
}

function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 10 * 60_000 });
  if (!allowFailure && result.status !== 0)
    throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result;
}

function compose(args, allowFailure = false) {
  return docker(['compose', '--env-file', releaseEnv, '-f', composeFile, ...args], allowFailure);
}

function backupDatabase(jobId) {
  mkdirSync(backupDirectory, { recursive: true });
  const path = resolve(backupDirectory, `pre-update-${jobId}.db`);
  if (!existsSync(databasePath)) return null;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA wal_checkpoint(FULL)');
    database.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
  return path;
}

function readCurrentImage() {
  try {
    const line = readFileSync(releaseEnv, 'utf8')
      .split(/\r?\n/)
      .find((value) => value.startsWith('HOMEDASH_IMAGE='));
    return line?.slice('HOMEDASH_IMAGE='.length) || null;
  } catch {
    return null;
  }
}

function writeReleaseImage(image) {
  const current = existsSync(releaseEnv)
    ? readFileSync(releaseEnv, 'utf8')
    : 'HOMEDASH_HOSTNAME=homedash.home.arpa\n';
  const lines = current
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('HOMEDASH_IMAGE='));
  lines.unshift(`HOMEDASH_IMAGE=${image}`);
  const temporary = `${releaseEnv}.tmp`;
  writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o640 });
  renameSync(temporary, releaseEnv);
}

async function waitForHealth(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4100/health/ready', {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return true;
    } catch {
      // Container may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2500));
  }
  return false;
}

async function performUpdate(manifest, jobId) {
  const previousImage = readCurrentImage();
  const backupPath = backupDatabase(jobId);
  let candidateActivated = false;
  updateStatus({
    state: 'pulling',
    jobId,
    targetVersion: manifest.version,
    previousImage,
    backupPath,
  });
  const candidateImage = `${manifest.image}@${manifest.digest}`;
  try {
    docker(['pull', candidateImage]);
    updateStatus({ state: 'restarting', candidateImage });
    writeReleaseImage(candidateImage);
    candidateActivated = true;
    compose(['up', '-d', '--remove-orphans']);
    updateStatus({ state: 'health-check' });
    if (!(await waitForHealth())) throw new Error('Candidate health check failed');
    updateStatus({
      state: 'complete',
      installedVersion: manifest.version,
      completedAt: new Date().toISOString(),
    });
    return;
  } catch (error) {
    if (!candidateActivated) {
      updateStatus({ state: 'failed', error: String(error) });
      return;
    }
    updateStatus({ state: 'rolling-back', error: String(error) });
  }

  compose(['down'], true);
  if (backupPath && existsSync(backupPath)) {
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    copyFileSync(backupPath, databasePath);
  }
  if (previousImage) writeReleaseImage(previousImage);
  compose(['up', '-d', '--remove-orphans'], true);
  const rollbackHealthy = await waitForHealth(60_000);
  updateStatus({
    state: rollbackHealthy ? 'rolled-back' : 'rollback-failed',
    error: rollbackHealthy
      ? 'Candidate failed health check; previous version restored.'
      : 'Manual recovery required.',
  });
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error('Payload too large');
  }
  return JSON.parse(raw || '{}');
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) return json(response, 401, { error: 'unauthorized' });
    if (request.method === 'GET' && request.url === '/status') return json(response, 200, status);
    if (request.method === 'POST' && request.url === '/install') {
      if (running)
        return json(response, 409, { error: 'update already running', jobId: status.jobId });
      const manifest = validateManifest(await readBody(request));
      const jobId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      running = true;
      updateStatus({ state: 'accepted', jobId, targetVersion: manifest.version, error: null });
      json(response, 202, { accepted: true, jobId });
      void performUpdate(manifest, jobId)
        .catch((error) => updateStatus({ state: 'failed', error: String(error) }))
        .finally(() => {
          running = false;
        });
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
  updateStatus({ state: status.state === 'running' ? 'interrupted' : status.state });
});

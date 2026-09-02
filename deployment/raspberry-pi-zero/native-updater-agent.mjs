#!/usr/local/bin/node
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const socketPath = '/run/homedash-updater/updater.sock';
const tokenFile = '/etc/homedash/updater-token';
const updater = '/usr/local/sbin/homedash-update-native';
const statusFile = '/var/lib/homedash/data/update-status.json';
const logFile = '/var/lib/homedash/data/native-update.log';
const homedashGroupId = Number(process.env.HOMEDASH_GROUP_ID || 0);

let running = false;
let status;

// Read only this job's output, with bounded memory even after many updates.
export function readUpdateLogTail(path, startOffset, maxBytes = 16 * 1024) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    const start = Math.max(startOffset, size - maxBytes);
    const buffer = Buffer.alloc(Math.max(0, size - start));
    const count = readSync(descriptor, buffer, 0, buffer.length, start);
    return buffer.subarray(0, count).toString('utf8');
  } catch {
    return '';
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function updateFailureSummary(code, signal, output) {
  const summary = `homedash-update-native terminé avec code ${code ?? 'inconnu'}${signal ? ` (${signal})` : ''}`;
  // npm's cleanup warnings are secondary; retain the actual error instead.
  const npmErrors = output.split(/\r?\n/).filter((line) => /^npm (error|ERR!)(\s|$)/.test(line));
  const detail = npmErrors.slice(0, 8).join('\n').slice(0, 1800);
  return `${summary}${detail ? ` :\n${detail}` : ''}\nJournal : ${logFile}`;
}

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
  updateStatus({
    state: 'installing',
    jobId,
    targetVersion: version,
    error: null,
    installedVersion: undefined,
    completedAt: undefined,
    exitCode: null,
    signal: null,
  });
  let log;
  let settled = false;
  const failed = (error, extra = {}) => {
    if (settled) return;
    settled = true;
    running = false;
    updateStatus({ state: 'failed', error: String(error), ...extra });
    console.error(`Échec de la mise à jour ${version} (${jobId}) : ${error}`);
  };
  try {
    log = openSync(logFile, 'a', 0o640);
    const startOffset = fstatSync(log).size;
    writeFileSync(log, `\n[${new Date().toISOString()}] HomeDash v${version} — ${jobId}\n`);
    console.info(`Installation de HomeDash ${version} (${jobId}), journal : ${logFile}`);
    const child = spawn(updater, [`v${version}`], {
      shell: false,
      stdio: ['ignore', log, log],
      env: {
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        LANG: 'C.UTF-8',
      },
    });
    child.once('error', (error) => failed(error));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        failed(updateFailureSummary(code, signal, readUpdateLogTail(logFile, startOffset)), {
          exitCode: code,
          signal,
        });
        return;
      }
      settled = true;
      running = false;
      updateStatus({
        state: 'complete',
        installedVersion: version,
        completedAt: new Date().toISOString(),
        error: null,
        exitCode: 0,
        signal: null,
      });
      console.info(`HomeDash ${version} installé (${jobId}).`);
    });
  } catch (error) {
    failed(error);
  } finally {
    if (log !== undefined) closeSync(log);
  }
}

// Importable for regression tests without opening the privileged socket.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  status = readStatus();
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
}

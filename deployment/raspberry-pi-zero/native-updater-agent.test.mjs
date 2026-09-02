import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readUpdateLogTail, updateFailureSummary } from './native-updater-agent.mjs';

test('reports the npm cache failure instead of secondary cleanup warnings', () => {
  const output = [
    'npm warn cleanup ENOTEMPTY /opt/homedash/releases/.install-0.4.4/node_modules',
    'npm error code ENOENT',
    'npm error syscall mkdir',
    'npm error path /root/.npm',
    'npm error errno -2',
    "npm error enoent ENOENT: no such file or directory, mkdir '/root/.npm'",
  ].join('\n');
  const summary = updateFailureSummary(254, null, output);
  assert.match(summary, /code 254/);
  assert.match(summary, /npm error code ENOENT/);
  assert.match(summary, /npm error path \/root\/\.npm/);
  assert.doesNotMatch(summary, /ENOTEMPTY/);
  assert.match(summary, /native-update\.log/);
});

test('reports signals and a log location even without npm output', () => {
  assert.match(updateFailureSummary(null, 'SIGTERM', ''), /code inconnu \(SIGTERM\)/);
  assert.match(updateFailureSummary(1, null, ''), /native-update\.log/);
});

test('bounds the diagnostic included in the status response', () => {
  const summary = updateFailureSummary(1, null, `npm ERR! ${'x'.repeat(50_000)}`);
  assert.match(summary, /npm ERR! xxx/);
  assert.ok(summary.length < 2000);
});

test('reads only the current job and a bounded tail, not a previous failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homedash-updater-log-test-'));
  try {
    const path = join(directory, 'update.log');
    const previous = 'npm error previous job\n';
    writeFileSync(path, `${previous}current job\n`);
    assert.equal(readUpdateLogTail(path, Buffer.byteLength(previous)), 'current job\n');
    writeFileSync(path, `${'x'.repeat(50_000)}npm error code ENOENT\n`);
    const tail = readUpdateLogTail(path, 0, 1024);
    assert.equal(Buffer.byteLength(tail), 1024);
    assert.match(tail, /npm error code ENOENT/);
    assert.equal(readUpdateLogTail(path, 100_000), '');
    assert.equal(readUpdateLogTail(join(directory, 'missing'), 0), '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

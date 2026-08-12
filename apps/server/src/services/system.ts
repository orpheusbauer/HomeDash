import { readFile } from 'node:fs/promises';
import { networkInterfaces, cpus, freemem, hostname, platform, totalmem, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import type { NetworkMetrics, SystemMetrics } from '@homedash/contracts';

let previousCpu = cpuSnapshot();

function cpuSnapshot(): { idle: number; total: number } {
  return cpus().reduce(
    (totals, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
      totals.idle += cpu.times.idle;
      totals.total += total;
      return totals;
    },
    { idle: 0, total: 0 },
  );
}

function cpuUsage(): number {
  const current = cpuSnapshot();
  const totalDelta = current.total - previousCpu.total;
  const idleDelta = current.idle - previousCpu.idle;
  previousCpu = current;
  return totalDelta <= 0
    ? 0
    : Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
}

async function cpuTemperature(): Promise<number | null> {
  try {
    const raw = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value / 1000 : null;
  } catch {
    return null;
  }
}

async function storageMetrics(): Promise<{ used: number | null; total: number | null }> {
  try {
    const stats = await statfs(process.cwd());
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return { total, used: total - free };
  } catch {
    return { total: null, used: null };
  }
}

export async function readSystemMetrics(): Promise<SystemMetrics> {
  const storage = await storageMetrics();
  return {
    cpuPercent: Math.round(cpuUsage() * 10) / 10,
    memoryUsedBytes: totalmem() - freemem(),
    memoryTotalBytes: totalmem(),
    storageUsedBytes: storage.used,
    storageTotalBytes: storage.total,
    cpuTemperatureCelsius: await cpuTemperature(),
    uptimeSeconds: uptime(),
    hostname: hostname(),
    platform: platform(),
    updatedAt: new Date().toISOString(),
  };
}

export async function readNetworkMetrics(): Promise<NetworkMetrics> {
  const addresses = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
  const startedAt = performance.now();
  const online = await fetch('https://clients3.google.com/generate_204', {
    method: 'HEAD',
    signal: AbortSignal.timeout(3000),
  })
    .then((response) => response.ok)
    .catch(() => false);
  const latencyMs = online ? Math.round(performance.now() - startedAt) : null;
  return {
    online,
    latencyMs,
    localAddresses: addresses,
    hostname: hostname(),
    updatedAt: new Date().toISOString(),
  };
}

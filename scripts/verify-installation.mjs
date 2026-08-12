#!/usr/bin/env node
const base = (process.argv[2] || 'http://127.0.0.1:4100').replace(/\/$/, '');
const checks = ['/health/live', '/health/ready', '/api/v1/bootstrap', '/api/v1/system'];
let failed = false;
for (const path of checks) {
  try {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
    console.log(`${response.ok ? 'OK' : 'ERREUR'} ${response.status} ${path}`);
    if (!response.ok) failed = true;
  } catch (error) {
    failed = true;
    console.error(`ERREUR ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exitCode = failed ? 1 : 0;

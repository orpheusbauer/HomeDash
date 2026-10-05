import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
let cached: { active: boolean; at: number } | undefined;
let pending: Promise<boolean> | undefined;

export async function nightlyRebootStatus() {
  const schedule = { time: '03:00', timezone: 'Europe/Paris' };
  if (process.platform !== 'linux') return { ...schedule, active: false };
  if (cached && Date.now() - cached.at < 60_000) return { ...schedule, active: cached.active };
  pending ??= run('systemctl', ['is-active', 'homedash-nightly-reboot.timer'], { timeout: 3_000 })
    .then(({ stdout }) => stdout.trim() === 'active')
    .catch(() => false);
  try {
    const active = await pending;
    cached = { active, at: Date.now() };
    return { ...schedule, active };
  } finally {
    pending = undefined;
  }
}

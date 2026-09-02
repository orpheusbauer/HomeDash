import { existsSync } from 'node:fs';
import { config } from '../config.js';
import { checkForUpdates, installUpdate, updaterRequest } from './updates.js';

export type NativeUpdateStatus = {
  state: string;
  targetVersion?: string;
  jobId?: string;
  error?: string | null;
};
type UpdateLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

/** Uses the existing restricted native installer; never executes release text. */
export function startAutomaticUpdates(
  logger: UpdateLogger,
  dependencies = {
    check: checkForUpdates,
    status: () => updaterRequest<NativeUpdateStatus>('/status'),
    install: installUpdate,
    available: () => existsSync(config.HOMEDASH_UPDATER_SOCKET),
  },
  options = {
    enabled: config.NODE_ENV === 'production' && config.HOMEDASH_AUTO_UPDATE,
    intervalMs: config.HOMEDASH_AUTO_UPDATE_INTERVAL_MS,
    initialDelayMs: 60_000,
  },
): () => void {
  if (!options.enabled) return () => {};
  let stopped = false;
  let warnedJob: string | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const blockedByFailure = (status: NativeUpdateStatus, version: string): boolean => {
    if (!['failed', 'interrupted'].includes(status.state) || status.targetVersion !== version)
      return false;
    const job = `${version}:${status.jobId ?? status.state}`;
    if (warnedJob !== job) {
      warnedJob = job;
      logger.warn(
        `Mise à jour automatique ${version} suspendue après échec ; une nouvelle release ou une relance manuelle est nécessaire. ${status.error ?? 'Consultez /var/lib/homedash/data/native-update.log.'}`,
      );
    }
    return true;
  };
  const check = async () => {
    try {
      if (!dependencies.available()) return;
      const status = await dependencies.status();
      if (status.state === 'installing' || stopped) return;
      const release = await dependencies.check();
      if (stopped || !release.updateAvailable || !release.installable || !release.manifest) return;
      // The root agent persists failures across application restarts/rollbacks.
      // Do not reinstall a broken release in a loop; a manual retry stays possible.
      if (blockedByFailure(status, release.manifest.version)) return;
      // Re-read after the network request: a manual installation may have started.
      const latestStatus = await dependencies.status();
      if (
        stopped ||
        latestStatus.state === 'installing' ||
        blockedByFailure(latestStatus, release.manifest.version)
      )
        return;
      logger.info(`Installation automatique de HomeDash ${release.manifest.version}`);
      await dependencies.install(release.manifest);
    } catch (error) {
      logger.warn(
        `Vérification automatique indisponible, nouvel essai au prochain passage : ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void check(), options.intervalMs);
        timer.unref();
      }
    }
  };
  timer = setTimeout(() => void check(), options.initialDelayMs);
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

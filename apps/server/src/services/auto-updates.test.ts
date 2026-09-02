import { afterEach, describe, expect, it, vi } from 'vitest';
import { startAutomaticUpdates, type NativeUpdateStatus } from './auto-updates.js';
import type { checkForUpdates } from './updates.js';

function setup() {
  vi.useFakeTimers();
  const release: Awaited<ReturnType<typeof checkForUpdates>> = {
    installedVersion: '0.4.2',
    availableVersion: '0.4.3',
    updateAvailable: true,
    installable: true,
    name: null,
    changelog: null,
    publishedAt: null,
    url: null,
    android: { version: '0.4.3', downloadAvailable: true },
    automatic: { enabled: true, intervalMinutes: 10 },
    manifest: {
      kind: 'native',
      version: '0.4.3',
      tag: 'v0.4.3',
      archive: 'homedash-native-0.4.3.tar.gz',
      checksum: 'homedash-native-0.4.3.tar.gz.sha256',
    },
  };
  const deps = {
    check: vi.fn(async () => release),
    status: vi.fn(async (): Promise<NativeUpdateStatus> => ({ state: 'idle' })),
    install: vi.fn(async () => ({ accepted: true, jobId: 'job' })),
    available: vi.fn(() => true),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const options = { enabled: true, intervalMs: 600_000, initialDelayMs: 60_000 };
  return { deps, logger, options, release };
}

afterEach(() => vi.useRealTimers());

describe('installation automatique du Pi', () => {
  it('vérifie après une minute puis toutes les dix minutes sans tablette', async () => {
    const { deps, logger, options, release } = setup();
    const stop = startAutomaticUpdates(logger, deps, options);
    expect(deps.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.install).toHaveBeenCalledExactlyOnceWith(release.manifest);
    deps.status.mockResolvedValue({ state: 'installing' });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(deps.install).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(deps.status).toHaveBeenCalledTimes(3);
  });

  it.each(['failed', 'interrupted'])(
    'ne boucle pas sur une release en état %s après rollback',
    async (state) => {
      const { deps, logger, options } = setup();
      deps.status.mockResolvedValue({ state, targetVersion: '0.4.3' });
      const stop = startAutomaticUpdates(logger, deps, options);
      await vi.advanceTimersByTimeAsync(660_000);
      expect(deps.install).not.toHaveBeenCalled();
      deps.status.mockResolvedValue({ state, targetVersion: '0.4.2' });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(deps.install).toHaveBeenCalledTimes(1);
      stop();
    },
  );

  it('revérifie le verrou après GitHub si une installation manuelle a commencé', async () => {
    const { deps, logger, options } = setup();
    deps.status.mockResolvedValueOnce({ state: 'idle' }).mockResolvedValue({ state: 'installing' });
    const stop = startAutomaticUpdates(logger, deps, options);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.install).not.toHaveBeenCalled();
    stop();
  });

  it('explique une suspension une fois par tentative échouée, sans inonder le journal', async () => {
    const { deps, logger, options } = setup();
    deps.status.mockResolvedValue({
      state: 'failed',
      targetVersion: '0.4.3',
      jobId: 'first',
      error: 'npm error path /root/.npm',
    });
    const stop = startAutomaticUpdates(logger, deps, options);
    await vi.advanceTimersByTimeAsync(1_260_000);
    expect(deps.install).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/root/.npm'));
    deps.status.mockResolvedValue({
      state: 'failed',
      targetVersion: '0.4.3',
      jobId: 'manual-retry',
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('détecte aussi un échec survenu pendant la requête GitHub', async () => {
    const { deps, logger, options } = setup();
    deps.status.mockResolvedValueOnce({ state: 'idle' }).mockResolvedValue({
      state: 'failed',
      targetVersion: '0.4.3',
    });
    const stop = startAutomaticUpdates(logger, deps, options);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deps.install).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('réessaie après une coupure réseau sans installations concurrentes', async () => {
    const { deps, logger, options } = setup();
    deps.check.mockRejectedValueOnce(new Error('offline'));
    const stop = startAutomaticUpdates(logger, deps, options);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(deps.install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(deps.install).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each(['disabled', 'no-agent', 'up-to-date', 'incomplete'])(
    'ne modifie rien : %s',
    async (mode) => {
      const { deps, logger, options, release } = setup();
      if (mode === 'disabled') options.enabled = false;
      if (mode === 'no-agent') deps.available.mockReturnValue(false);
      if (mode === 'up-to-date') release.updateAvailable = false;
      if (mode === 'incomplete') release.manifest = null;
      const stop = startAutomaticUpdates(logger, deps, options);
      await vi.advanceTimersByTimeAsync(660_000);
      expect(deps.install).not.toHaveBeenCalled();
      stop();
    },
  );

  it('annule une vérification en cours lors de l’arrêt du serveur', async () => {
    const { deps, logger, options, release } = setup();
    let resolveCheck!: (value: typeof release) => void;
    deps.check.mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const stop = startAutomaticUpdates(logger, deps, options);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    resolveCheck(release);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.check).toHaveBeenCalledTimes(1);
  });
});

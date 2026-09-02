import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  BatteryCharging,
  CalendarDays,
  Camera,
  Download,
  ExternalLink,
  Link2,
  RefreshCw,
  ShieldCheck,
  Tablet,
  Trash2,
} from 'lucide-react';
import type { TabletDevice } from '@homedash/contracts';
import {
  getDashboardOrientation,
  getAndroidAppVersion,
  getMotionWakeStatus,
  hasAndroidBridge,
  installAndroidUpdate,
  openAndroidPermissionSettings,
  openAndroidAppSettings,
  openBatteryOptimizationSettings,
  requestMotionWakePermission,
  setDashboardOrientation,
  setMotionWakeEnabled,
  supportsAndroidUpdates,
  supportsMotionWake,
  type DashboardOrientation,
  type MotionWakeStatus,
} from '../android-bridge';
import { api } from '../api';

type Backup = { filename: string; size: number; createdAt: string };
type UpdateInfo = {
  installedVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  installable: boolean;
  manifest: Record<string, unknown> | null;
  android: { version: string | null; downloadAvailable: boolean };
  automatic?: { enabled: boolean; intervalMinutes: number };
};
type CalendarStatus = { configured: boolean; connected: boolean; message: string };
type UpdateStatus = {
  state: 'idle' | 'installing' | 'complete' | 'failed' | 'interrupted';
  targetVersion?: string;
  error?: string | null;
};
type AndroidUpdateStatus = {
  state: 'downloading' | 'permission-required' | 'installer-opened' | 'failed';
  message?: string;
};

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

function versionParts(value: string): [number, number, number] {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

function isNewerVersion(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  return left.some(
    (part, index) => part > right[index]! && left.slice(0, index).every((v, i) => v === right[i]),
  );
}

export function SettingsCenter({
  authenticated,
  onRequestUnlock,
}: {
  authenticated: boolean;
  onRequestUnlock: () => void;
}) {
  const client = useQueryClient();
  const isAndroidApp = hasAndroidBridge();
  const androidAppVersion = isAndroidApp ? getAndroidAppVersion() : null;
  const androidUpdaterSupported = isAndroidApp && supportsAndroidUpdates();
  const motionWakeSupported = isAndroidApp && supportsMotionWake();
  const [orientation, setOrientation] = useState<DashboardOrientation | null>(null);
  const [motionWake, setMotionWake] = useState<MotionWakeStatus | null>(null);
  const [androidUpdateStarted, setAndroidUpdateStarted] = useState(false);
  const [androidUpdateStatus, setAndroidUpdateStatus] = useState<AndroidUpdateStatus | null>(null);
  const [serverUpdateStarted, setServerUpdateStarted] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const updates = useQuery({
    queryKey: ['admin', 'updates'],
    queryFn: () => api<UpdateInfo>('/api/v1/updates/check', {}, true),
    enabled: authenticated,
    retry: false,
  });
  const backups = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => api<Backup[]>('/api/v1/backups', {}, true),
    enabled: authenticated,
  });
  const devices = useQuery({
    queryKey: ['admin', 'devices'],
    queryFn: () => api<TabletDevice[]>('/api/v1/devices', {}, true),
    enabled: authenticated,
    refetchInterval: 30_000,
  });
  const calendar = useQuery({
    queryKey: ['calendar', 'status'],
    queryFn: () => api<CalendarStatus>('/api/v1/calendar/status'),
  });
  const createBackup = useMutation({
    mutationFn: () => api<Backup>('/api/v1/backups', { method: 'POST' }, true),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'backups'] }),
  });
  const createPairing = useMutation({
    mutationFn: () =>
      api<{ code: string; expiresAt: string }>('/api/v1/devices/pairing', { method: 'POST' }, true),
    onSuccess: setPairing,
  });
  const removeDevice = useMutation({
    mutationFn: (deviceId: string) =>
      api(`/api/v1/devices/${deviceId}`, { method: 'DELETE' }, true),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  });
  const install = useMutation({
    mutationFn: (manifest: Record<string, unknown>) =>
      api('/api/v1/updates/install', { method: 'POST', body: JSON.stringify({ manifest }) }, true),
    onSuccess: () => {
      client.setQueryData<UpdateStatus>(['admin', 'updates', 'status'], { state: 'installing' });
      setServerUpdateStarted(true);
    },
  });
  const updateStatus = useQuery({
    queryKey: ['admin', 'updates', 'status'],
    queryFn: () => api<UpdateStatus>('/api/v1/updates/status', {}, true),
    enabled: authenticated && serverUpdateStarted,
    retry: true,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (isAndroidApp) setOrientation(getDashboardOrientation());
  }, [isAndroidApp]);

  useEffect(() => {
    if (!motionWakeSupported) return;
    const refresh = () => setMotionWake(getMotionWakeStatus());
    refresh();
    const diagnosticTimer = window.setInterval(refresh, 2_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('homedash:motion-wake-status', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(diagnosticTimer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('homedash:motion-wake-status', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [motionWakeSupported]);

  useEffect(() => {
    if (!isAndroidApp) return;
    const refresh = (event: Event) => {
      const status = (event as CustomEvent<AndroidUpdateStatus>).detail;
      if (!status?.state) return;
      setAndroidUpdateStatus(status);
      setAndroidUpdateStarted(status.state !== 'failed');
    };
    window.addEventListener('homedash:android-update-status', refresh);
    return () => window.removeEventListener('homedash:android-update-status', refresh);
  }, [isAndroidApp]);

  useEffect(() => {
    if (updateStatus.data?.state !== 'complete') return;
    const timer = window.setTimeout(() => window.location.reload(), 1_500);
    return () => window.clearTimeout(timer);
  }, [updateStatus.data?.state]);

  function changeOrientation(value: DashboardOrientation) {
    setOrientation(value);
    setDashboardOrientation(value);
  }

  function changeMotionWake(enabled: boolean) {
    setMotionWakeEnabled(enabled);
    setMotionWake((current) => (current ? { ...current, enabled } : current));
  }

  const androidReleaseVersion = updates.data?.android.version ?? null;
  const androidUpdateAvailable = Boolean(
    androidReleaseVersion &&
    updates.data?.android.downloadAvailable &&
    (androidAppVersion
      ? isNewerVersion(androidReleaseVersion, androidAppVersion)
      : !androidUpdaterSupported),
  );

  function startAndroidUpdate() {
    if (!androidReleaseVersion) return;
    setAndroidUpdateStarted(true);
    setAndroidUpdateStatus({ state: 'downloading' });
    installAndroidUpdate(androidReleaseVersion);
  }

  if (!authenticated)
    return (
      <div className="settings-gate">
        <ShieldCheck size={36} />
        <h3>Administration protégée</h3>
        <p>Déverrouillez HomeDash pour gérer sauvegardes, mises à jour et tablettes.</p>
        <button className="button button--primary" onClick={onRequestUnlock}>
          Déverrouiller
        </button>
      </div>
    );

  return (
    <div className="settings-sections">
      {isAndroidApp && (
        <section className="settings-section settings-section--tablet-display">
          <div className="settings-section__title">
            <Tablet size={20} />
            <div>
              <h3>Affichage tablette</h3>
              <p>
                Choisissez le sens du dashboard. Les cartes et la navigation se réorganisent
                automatiquement.
              </p>
            </div>
          </div>
          <div
            className="orientation-selector"
            role="group"
            aria-label="Orientation de la tablette"
          >
            <button
              className={orientation === 'landscape' ? 'is-active' : ''}
              onClick={() => changeOrientation('landscape')}
            >
              <span className="orientation-preview orientation-preview--landscape" />
              Paysage
            </button>
            <button
              className={orientation === 'portrait' ? 'is-active' : ''}
              onClick={() => changeOrientation('portrait')}
            >
              <span className="orientation-preview orientation-preview--portrait" />
              Portrait
            </button>
          </div>
          <div className="motion-wake-card">
            <div className="motion-wake-card__heading">
              <Camera size={20} />
              <div>
                <strong>Réveil de l’écran par mouvement</strong>
                <p>
                  La caméra frontale compare des images en basse résolution sur la tablette. Aucune
                  image n’est enregistrée ni envoyée au Raspberry Pi.
                </p>
              </div>
            </div>
            {!motionWakeSupported && (
              <p className="form-hint">
                Installez la prochaine version de l’application Android pour activer cette fonction.
              </p>
            )}
            {motionWakeSupported && motionWake && !motionWake.supported && (
              <p className="text-danger">
                Aucune caméra frontale n’a été détectée sur cette tablette.
              </p>
            )}
            {motionWakeSupported && motionWake?.supported && (
              <>
                <button
                  className={`button ${motionWake.enabled ? 'button--ghost' : 'button--primary'}`}
                  aria-pressed={motionWake.enabled}
                  onClick={() => changeMotionWake(!motionWake.enabled)}
                >
                  <Camera size={17} />
                  {motionWake.enabled
                    ? 'Désactiver le réveil par mouvement'
                    : 'Activer le réveil par mouvement'}
                </button>
                <div className="motion-wake-status" aria-label="État des autorisations Android">
                  <span className={motionWake.cameraGranted ? 'is-ready' : 'is-warning'}>
                    Caméra {motionWake.cameraGranted ? 'autorisée' : 'à autoriser'}
                  </span>
                  <span
                    className={motionWake.batteryOptimizationsIgnored ? 'is-ready' : 'is-warning'}
                  >
                    Batterie{' '}
                    {motionWake.batteryOptimizationsIgnored ? 'sans restriction' : 'à configurer'}
                  </span>
                  <span className={motionWake.notificationGranted ? 'is-ready' : 'is-warning'}>
                    Notification {motionWake.notificationGranted ? 'autorisée' : 'masquée'}
                  </span>
                </div>
                {motionWake.enabled && typeof motionWake.receivingFrames === 'boolean' && (
                  <div role="status">
                    <p className={motionWake.receivingFrames ? 'form-hint' : 'text-danger'}>
                      {motionWake.receivingFrames
                        ? 'Caméra opérationnelle : les images arrivent et sont analysées localement.'
                        : motionWake.serviceRunning
                          ? 'Service démarré, mais aucune image récente reçue. Reprise automatique en cours.'
                          : 'Le service caméra est arrêté. Rouvrez HomeDash ou touchez Réessayer.'}
                    </p>
                    {motionWake.cameraError && (
                      <p className="text-danger">{motionWake.cameraError}</p>
                    )}
                    {motionWake.lastMotionAgeSeconds != null && (
                      <p className="form-hint">
                        Dernier mouvement détecté il y a {motionWake.lastMotionAgeSeconds} s.
                      </p>
                    )}
                    {!motionWake.receivingFrames && (
                      <button
                        className="button button--ghost"
                        onClick={requestMotionWakePermission}
                      >
                        Réessayer la caméra
                      </button>
                    )}
                  </div>
                )}
                {!motionWake.cameraGranted && (
                  <div className="button-row">
                    {motionWake.enabled && (
                      <button
                        className="button button--primary"
                        onClick={requestMotionWakePermission}
                      >
                        Autoriser la caméra
                      </button>
                    )}
                    <button
                      className="button button--ghost"
                      onClick={openAndroidPermissionSettings}
                    >
                      Autorisations Android
                    </button>
                  </div>
                )}
                {motionWake.enabled && !motionWake.batteryOptimizationsIgnored && (
                  <button
                    className="button button--ghost motion-wake-card__battery"
                    onClick={openBatteryOptimizationSettings}
                  >
                    <BatteryCharging size={17} />
                    Autoriser l’activité sans restriction
                  </button>
                )}
                {motionWake.enabled && !motionWake.notificationGranted && (
                  <button className="button button--ghost" onClick={openAndroidPermissionSettings}>
                    Autoriser la notification permanente
                  </button>
                )}
                <details className="motion-wake-guide" open={!motionWake.enabled}>
                  <summary>Configuration conseillée sur la tablette</summary>
                  <ol>
                    <li>
                      Dans Android, choisissez le délai souhaité sous{' '}
                      <strong>Affichage &gt; Veille</strong> et désactivez « écran toujours allumé
                      pendant la charge ».
                    </li>
                    <li>
                      Activez l’option ci-dessus, puis accordez la caméra et la notification du
                      service.
                    </li>
                    <li>
                      Passez la batterie de HomeDash à <strong>Sans restriction</strong> et
                      autorisez son démarrage automatique si le fabricant propose ce réglage.
                    </li>
                    <li>
                      Un code, un schéma ou un verrouillage immédiat reste prioritaire : HomeDash
                      rallume la dalle mais ne contourne jamais l’écran de verrouillage Android.
                    </li>
                  </ol>
                </details>
                {motionWake.enabled && (
                  <p className="form-hint">
                    Le voyant confidentialité d’Android et une notification restent visibles pendant
                    l’utilisation de la caméra. Cette fonction augmente la consommation électrique ;
                    elle est conçue pour une tablette murale branchée.
                  </p>
                )}
              </>
            )}
          </div>
          <button className="button button--ghost" onClick={openAndroidAppSettings}>
            <ExternalLink size={17} />
            Adresse du serveur et association
          </button>
          <p className="form-hint">
            Pour quitter HomeDash, utilisez le bouton Android dans la barre supérieure ou le bouton
            Retour de la tablette.
          </p>
        </section>
      )}
      <section className="settings-section">
        <div className="settings-section__title">
          <Download size={20} />
          <div>
            <h3>Mises à jour</h3>
            <p>Versions du serveur Raspberry Pi et de l’application tablette.</p>
          </div>
        </div>
        {updates.isLoading && <p className="form-hint">Recherche d’une version…</p>}
        {updates.isError && (
          <p className="form-hint">
            GitHub Releases est indisponible ou aucune release n’existe encore.
          </p>
        )}
        {updates.data && (
          <div className="settings-list">
            <div>
              <span>Serveur Raspberry Pi</span>
              <strong>{updates.data.installedVersion}</strong>
            </div>
            <div>
              <span>Dernière version</span>
              <strong>{updates.data.availableVersion ?? 'Aucune release'}</strong>
            </div>
            {updates.data.automatic && (
              <div>
                <span>Installation automatique du Pi</span>
                <strong>
                  {updates.data.automatic.enabled
                    ? `Toutes les ${updates.data.automatic.intervalMinutes} minutes`
                    : 'Désactivée ou agent absent'}
                </strong>
              </div>
            )}
            <div>
              <span>État</span>
              <strong>{updates.data.updateAvailable ? 'Mise à jour disponible' : 'À jour'}</strong>
            </div>
            {isAndroidApp && (
              <div>
                <span>Application tablette</span>
                <strong>{androidAppVersion ?? 'Ancienne version'}</strong>
              </div>
            )}
          </div>
        )}
        <div className="button-row">
          <button
            className="button button--ghost"
            disabled={updates.isFetching}
            aria-busy={updates.isFetching}
            onClick={() => void updates.refetch()}
          >
            <RefreshCw className={updates.isFetching ? 'spin' : undefined} size={17} />
            {updates.isFetching ? 'Vérification…' : 'Vérifier'}
          </button>
          {updates.data?.updateAvailable && updates.data.installable && updates.data.manifest && (
            <button
              className="button button--primary"
              disabled={
                install.isPending ||
                (serverUpdateStarted &&
                  !['failed', 'interrupted'].includes(updateStatus.data?.state ?? 'installing'))
              }
              onClick={() => install.mutate(updates.data.manifest!)}
            >
              Installer {updates.data.availableVersion}
            </button>
          )}
        </div>
        {updates.data?.automatic?.enabled && (
          <p className="form-hint">
            Le Pi installe les nouvelles releases même si la tablette est éteinte. Le délai de
            vérification n’inclut pas le téléchargement et l’installation. L’APK Android reste à
            confirmer ici après la mise à jour du serveur.
          </p>
        )}
        {updates.data?.updateAvailable && !updates.data.installable && (
          <p className="form-hint">
            Le Raspberry Pi Zero se met à jour par la commande SSH sécurisée décrite dans le guide
            de mise à jour.
          </p>
        )}
        {serverUpdateStarted && updateStatus.data?.state !== 'failed' && (
          <p className="text-success">
            {updateStatus.data?.state === 'complete'
              ? 'Mise à jour terminée. Rechargement de HomeDash…'
              : 'Mise à jour en cours. HomeDash va redémarrer automatiquement ; ne coupez pas le Raspberry Pi.'}
          </p>
        )}
        {updateStatus.data?.state === 'failed' && (
          <p className="form-hint">
            Échec de la mise à jour serveur. La version précédente reste active. Consultez le guide
            de mise à jour{updateStatus.data.error ? ` (${updateStatus.data.error})` : ''}.
          </p>
        )}
        {isAndroidApp &&
          androidUpdateAvailable &&
          androidUpdaterSupported &&
          !updates.data?.updateAvailable && (
            <button
              className="button button--primary"
              disabled={androidUpdateStarted}
              onClick={startAndroidUpdate}
            >
              <Download size={17} />
              Installer l’application {androidReleaseVersion}
            </button>
          )}
        {isAndroidApp &&
          androidUpdateAvailable &&
          !androidUpdaterSupported &&
          !updates.data?.updateAvailable && (
            <p className="form-hint">
              Cette ancienne APK ne contient pas encore l’installateur intégré. Installez
              manuellement la version {androidReleaseVersion} une dernière fois ; les versions
              suivantes se mettront à jour depuis ce bouton sans effacer la configuration.
            </p>
          )}
        {isAndroidApp && androidUpdateStarted && (
          <p className="text-success">
            {androidUpdateStatus?.state === 'downloading'
              ? `Téléchargement et vérification de HomeDash ${androidReleaseVersion}…`
              : (androidUpdateStatus?.message ??
                'Suivez les écrans Android : autorisez cette source si demandé, puis confirmez l’installation. HomeDash conserve son adresse et son association.')}
          </p>
        )}
        {isAndroidApp && androidUpdateStatus?.state === 'failed' && (
          <p className="text-danger">
            {androidUpdateStatus.message ??
              'La préparation de la mise à jour Android a échoué. Vérifiez le Wi-Fi puis réessayez.'}
          </p>
        )}
      </section>
      <section className="settings-section">
        <div className="settings-section__title">
          <Archive size={20} />
          <div>
            <h3>Sauvegardes</h3>
            <p>Copies cohérentes de la base SQLite locale.</p>
          </div>
        </div>
        <button
          className="button button--ghost"
          disabled={createBackup.isPending}
          onClick={() => createBackup.mutate()}
        >
          <Archive size={17} />
          Créer une sauvegarde
        </button>
        <div className="compact-list">
          {backups.data?.slice(0, 4).map((backup) => (
            <div key={backup.filename}>
              <span>{new Date(backup.createdAt).toLocaleString('fr-FR')}</span>
              <small>{formatBytes(backup.size)}</small>
            </div>
          ))}
          {!backups.data?.length && <p className="form-hint">Aucune sauvegarde manuelle.</p>}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section__title">
          <Tablet size={20} />
          <div>
            <h3>Tablettes</h3>
            <p>Association locale à jeton unique.</p>
          </div>
        </div>
        <button className="button button--ghost" onClick={() => createPairing.mutate()}>
          <Link2 size={17} />
          Associer une tablette
        </button>
        {pairing && (
          <div className="pairing-code">
            <span>Code valable 10 minutes</span>
            <strong>{pairing.code}</strong>
          </div>
        )}
        <div className="compact-list">
          {devices.data?.map((device) => (
            <div key={device.id}>
              <span>
                <strong>{device.name}</strong>
                <small>
                  {device.telemetry.batteryPercent != null
                    ? `${device.telemetry.batteryPercent}% · `
                    : ''}
                  {device.lastSeenAt
                    ? `Vue ${new Date(device.lastSeenAt).toLocaleString('fr-FR')}`
                    : 'Jamais connectée'}
                </small>
              </span>
              <button
                className="compact-list__delete"
                aria-label={`Révoquer ${device.name}`}
                onClick={() => {
                  if (window.confirm(`Révoquer « ${device.name} » ?`))
                    removeDevice.mutate(device.id);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!devices.data?.length && <p className="form-hint">Aucune tablette associée.</p>}
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section__title">
          <CalendarDays size={20} />
          <div>
            <h3>Google Calendar</h3>
            <p>{calendar.data?.message ?? 'Vérification…'}</p>
          </div>
        </div>
        <strong className={calendar.data?.connected ? 'text-success' : ''}>
          {calendar.data?.connected ? 'Connecté' : 'À configurer sur le Raspberry Pi'}
        </strong>
      </section>
    </div>
  );
}

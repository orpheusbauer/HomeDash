import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
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
  hasAndroidBridge,
  installAndroidUpdate,
  openAndroidAppSettings,
  setDashboardOrientation,
  supportsAndroidUpdates,
  type DashboardOrientation,
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
};
type CalendarStatus = { configured: boolean; connected: boolean; message: string };
type UpdateStatus = {
  state: 'idle' | 'installing' | 'complete' | 'failed' | 'interrupted';
  targetVersion?: string;
  error?: string | null;
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
  const [orientation, setOrientation] = useState<DashboardOrientation | null>(null);
  const [androidUpdateStarted, setAndroidUpdateStarted] = useState(false);
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
    onSuccess: () => setServerUpdateStarted(true),
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
    if (updateStatus.data?.state !== 'complete') return;
    const timer = window.setTimeout(() => window.location.reload(), 1_500);
    return () => window.clearTimeout(timer);
  }, [updateStatus.data?.state]);

  function changeOrientation(value: DashboardOrientation) {
    setOrientation(value);
    setDashboardOrientation(value);
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
          <button className="button button--ghost" onClick={() => void updates.refetch()}>
            <RefreshCw size={17} />
            Vérifier
          </button>
          {updates.data?.updateAvailable && updates.data.installable && updates.data.manifest && (
            <button
              className="button button--primary"
              disabled={install.isPending || serverUpdateStarted}
              onClick={() => install.mutate(updates.data.manifest!)}
            >
              Installer {updates.data.availableVersion}
            </button>
          )}
        </div>
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
            Suivez les écrans Android : autorisez cette source si demandé, puis confirmez
            l’installation. HomeDash conserve son adresse et son association.
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

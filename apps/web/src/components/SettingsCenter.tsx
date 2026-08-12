import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
  Download,
  Link2,
  RefreshCw,
  ShieldCheck,
  Tablet,
  Trash2,
} from 'lucide-react';
import type { TabletDevice } from '@homedash/contracts';
import { api } from '../api';

type Backup = { filename: string; size: number; createdAt: string };
type UpdateInfo = {
  installedVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  installable: boolean;
  manifest: Record<string, unknown> | null;
};
type CalendarStatus = { configured: boolean; connected: boolean; message: string };

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

export function SettingsCenter({
  authenticated,
  onRequestUnlock,
}: {
  authenticated: boolean;
  onRequestUnlock: () => void;
}) {
  const client = useQueryClient();
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
  });

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
      <section className="settings-section">
        <div className="settings-section__title">
          <Download size={20} />
          <div>
            <h3>Mises à jour</h3>
            <p>Image vérifiée, sauvegarde puis rollback automatique.</p>
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
              <span>Version installée</span>
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
              disabled={install.isPending}
              onClick={() => install.mutate(updates.data.manifest!)}
            >
              Installer {updates.data.availableVersion}
            </button>
          )}
        </div>
        {updates.data?.updateAvailable && !updates.data.installable && (
          <p className="form-hint">
            La release existe, mais l’agent de mise à jour du Raspberry Pi n’est pas joignable.
          </p>
        )}
        {install.isSuccess && (
          <p className="text-success">Mise à jour acceptée. HomeDash va redémarrer.</p>
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

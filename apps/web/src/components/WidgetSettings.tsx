import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Sensor, WidgetInstance, WidgetManifest } from '@homedash/contracts';
import { api } from '../api';
import { Modal } from './Modal';

export function WidgetSettings({
  instance,
  manifest,
  onSave,
  onClose,
}: {
  instance: WidgetInstance;
  manifest?: WidgetManifest;
  onSave: (title: string | null, config: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(instance.title ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(instance.config);
  const sensors = useQuery({
    queryKey: ['sensors'],
    queryFn: () => api<Sensor[]>('/api/v1/sensors'),
  });
  const set = (key: string, value: unknown) =>
    setConfig((current) => ({ ...current, [key]: value }));
  const textConfig = (key: string, fallback: string) =>
    typeof config[key] === 'string' ? config[key] : fallback;

  return (
    <Modal
      title={`Configurer ${manifest?.name ?? instance.widgetId}`}
      onClose={onClose}
      footer={
        <>
          <button className="button button--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onSave(title.trim() || null, config)}
          >
            Enregistrer
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>Titre personnalisé</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={manifest?.name}
          />
        </label>

        {instance.widgetId === 'clock' && (
          <>
            <label className="field">
              <span>Format</span>
              <select
                value={textConfig('format', '24h')}
                onChange={(event) => set('format', event.target.value)}
              >
                <option value="24h">24 heures</option>
                <option value="12h">12 heures</option>
              </select>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={config.showSeconds === true}
                onChange={(event) => set('showSeconds', event.target.checked)}
              />
              <span>Afficher les secondes</span>
            </label>
            <label className="field">
              <span>Fuseau horaire IANA</span>
              <input
                value={textConfig('timezone', 'Europe/Paris')}
                onChange={(event) => set('timezone', event.target.value)}
              />
            </label>
          </>
        )}

        {instance.widgetId.startsWith('weather.') && (
          <>
            <label className="field">
              <span>Localisation</span>
              <input
                value={textConfig('location', '')}
                onChange={(event) => set('location', event.target.value)}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Latitude</span>
                <input
                  type="number"
                  step="0.0001"
                  value={Number(config.latitude ?? 0)}
                  onChange={(event) => set('latitude', Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  type="number"
                  step="0.0001"
                  value={Number(config.longitude ?? 0)}
                  onChange={(event) => set('longitude', Number(event.target.value))}
                />
              </label>
            </div>
          </>
        )}

        {instance.widgetId === 'sensor.temperature' && (
          <label className="field">
            <span>Capteur</span>
            <select
              value={textConfig('sensorId', 'mock-indoor-temperature')}
              onChange={(event) => set('sensorId', event.target.value)}
            >
              {sensors.data?.map((sensor) => (
                <option value={sensor.id} key={sensor.id}>
                  {sensor.name} — {sensor.location}
                </option>
              ))}
            </select>
          </label>
        )}

        {instance.widgetId === 'calendar' && (
          <label className="field">
            <span>Identifiants de calendriers</span>
            <input
              value={Array.isArray(config.calendarIds) ? config.calendarIds.join(', ') : 'primary'}
              onChange={(event) =>
                set(
                  'calendarIds',
                  event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                )
              }
            />
            <small>Utilisez « primary » ou séparez plusieurs identifiants par des virgules.</small>
          </label>
        )}

        {['notes', 'system', 'network'].includes(instance.widgetId) && (
          <p className="form-hint">Ce widget ne nécessite aucun autre réglage pour le moment.</p>
        )}
      </div>
    </Modal>
  );
}

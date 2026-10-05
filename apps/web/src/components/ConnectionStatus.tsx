import { CloudOff, RefreshCw, TriangleAlert, Wifi } from 'lucide-react';
import { Modal } from './Modal';
import { dataTimestamp } from './DataFreshness';
import type { useConnectionHealth } from '../connection-health';
import type { RealtimeConnection } from '../realtime';

type Health = ReturnType<typeof useConnectionHealth>;

export function ConnectionBadge({ health, onClick }: { health: Health; onClick: () => void }) {
  const { level, label } = health.summary;
  return (
    <button
      type="button"
      className={`connection-pill connection-pill--${level}`}
      aria-label="État de connexion et des données"
      title={label}
      onClick={onClick}
    >
      {level === 'online' ? (
        <Wifi size={16} />
      ) : level === 'warning' ? (
        <TriangleAlert size={16} />
      ) : (
        <CloudOff size={16} />
      )}
      <span>{label}</span>
    </button>
  );
}

export function ConnectionBanner({ health, onClick }: { health: Health; onClick: () => void }) {
  const { message, level } = health.summary;
  if (!message) return null;
  return (
    <div
      className={`connection-banner connection-banner--${level}`}
      role="status"
      aria-live="polite"
    >
      <TriangleAlert size={18} aria-hidden="true" />
      <button type="button" onClick={onClick}>
        <strong>{health.summary.label}</strong>
        <span>{message}</span>
      </button>
    </div>
  );
}

export function ConnectionDetails({
  health,
  realtime,
  onClose,
}: {
  health: Health;
  realtime: RealtimeConnection;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Connexion et fraîcheur des données"
      onClose={onClose}
      description="État observé depuis cette tablette et dernières collectes du Raspberry Pi."
    >
      <div className="form-stack connection-details">
        <div>
          <strong>{health.summary.label}</strong>
          <p>
            {health.summary.message ||
              (health.summary.level === 'connecting'
                ? 'Vérification de la liaison avec le Raspberry Pi en cours.'
                : 'La tablette échange normalement avec le Raspberry Pi.')}
          </p>
        </div>
        <div className="settings-list">
          <div>
            <span>Dernière réponse du Pi</span>
            <strong>
              {dataTimestamp(
                health.dataUpdatedAt ? new Date(health.dataUpdatedAt).toISOString() : null,
              )}
            </strong>
          </div>
          <div>
            <span>Liaison temps réel</span>
            <strong>{realtime === 'online' ? 'Connectée' : 'Reconnexion en cours'}</strong>
          </div>
          <div>
            <span>Vérification de la liaison</span>
            <strong>Toutes les 30 secondes et au réveil</strong>
          </div>
        </div>
        {health.isError && health.data && (
          <p className="form-hint">
            Les états des fournisseurs ci-dessous proviennent de la dernière réponse du Pi ; ils
            seront revérifiés au retour de la connexion.
          </p>
        )}
        {health.data?.integrations.map((item) => (
          <article className={`integration-health integration-health--${item.state}`} key={item.id}>
            <strong>{item.label}</strong>
            <span>
              {
                {
                  ready: 'Données à jour',
                  stale: 'Dernières données conservées',
                  error: 'Aucune donnée disponible',
                  pending: 'Première collecte en cours',
                  unconfigured: 'Intégration à configurer',
                }[item.state]
              }
            </span>
            <p>
              Dernière collecte réussie : {dataTimestamp(item.fetchedAt)}
              <br />
              Dernière tentative : {dataTimestamp(item.lastAttemptAt)}
              <br />
              Actualisation sur le Pi : toutes les {item.refreshIntervalMs / 60_000} minutes
            </p>
            {item.lastError && <p className="text-danger">{item.lastError}</p>}
          </article>
        ))}
        {health.data && (
          <p className="form-hint">
            {health.data.nightlyReboot.active
              ? 'Redémarrage quotidien du Pi activé à 03:00 (Europe/Paris).'
              : 'Redémarrage quotidien à installer ou à activer sur le Pi : voir le guide de mise à jour 0.4.11.'}
          </p>
        )}
        <button
          type="button"
          className="button button--secondary"
          disabled={health.isFetching}
          onClick={() => {
            window.dispatchEvent(new Event('homedash:resume'));
            void health.refetch();
          }}
        >
          <RefreshCw size={16} />
          Vérifier et actualiser maintenant
        </button>
      </div>
    </Modal>
  );
}

import { Bell, Check, CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { Modal } from './Modal';
import { dataTimestamp } from './DataFreshness';
import type { useConnectionHealth } from '../connection-health';
import type { RealtimeConnection } from '../realtime';
import { useWidgetNotifications } from '../notifications';

type Health = Pick<
  ReturnType<typeof useConnectionHealth>,
  'summary' | 'data' | 'dataUpdatedAt' | 'isError' | 'isFetching' | 'refetch'
>;

export function ConnectionBadge({ health, onClick }: { health: Health; onClick: () => void }) {
  const { level, label } = health.summary;
  return (
    <button
      type="button"
      className={`icon-button connection-button connection-button--${level}`}
      aria-label="État de connexion et des données"
      aria-haspopup="dialog"
      title={label}
      onClick={onClick}
    >
      {level === 'connecting' ? (
        <RefreshCw size={18} aria-hidden="true" />
      ) : level === 'offline' ? (
        <CloudOff size={18} aria-hidden="true" />
      ) : (
        <Wifi size={18} aria-hidden="true" />
      )}
    </button>
  );
}

export function NotificationButton({ health, onClick }: { health: Health; onClick: () => void }) {
  const notifications = useWidgetNotifications();
  const { message, level } = health.summary;
  const count = notifications.length + (message ? 1 : 0);
  const severity =
    level === 'offline' || notifications.some((item) => item.level === 'offline')
      ? 'offline'
      : count
        ? 'warning'
        : 'ready';
  const label = count ? `Notifications : ${count} alerte${count > 1 ? 's' : ''}` : 'Notifications';
  return (
    <button
      type="button"
      className={`icon-button notification-button notification-button--${severity}`}
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
    >
      <Bell size={19} aria-hidden="true" />
      {count > 0 && (
        <span className="notification-button__count" aria-hidden="true">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
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
  const notifications = useWidgetNotifications();
  return (
    <Modal
      title="Notifications"
      onClose={onClose}
      description="Connexion de la tablette, état du Raspberry Pi et dernières données conservées."
    >
      <div className="form-stack connection-details">
        {!health.summary.message &&
          notifications.length === 0 &&
          health.summary.level === 'online' && (
            <p className="notification-empty">
              <Check size={18} aria-hidden="true" />
              Aucune alerte en cours.
            </p>
          )}
        <div>
          <strong>{health.summary.label}</strong>
          <p>
            {health.summary.message ||
              (health.summary.level === 'connecting'
                ? 'Vérification de la liaison avec le Raspberry Pi en cours.'
                : 'La tablette échange normalement avec le Raspberry Pi.')}
          </p>
        </div>
        {notifications.length > 0 && (
          <div className="notification-list" aria-label="Alertes des widgets">
            {notifications.map((item) => (
              <article
                className={`notification-item notification-item--${item.level}`}
                key={item.id}
              >
                <strong>{item.title}</strong>
                <p>{item.message}</p>
              </article>
            ))}
          </div>
        )}
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
              : 'Redémarrage quotidien à installer ou à activer sur le Pi : voir le guide de mise à jour.'}
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

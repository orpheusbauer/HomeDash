import { ApiError } from '../api';
import { useCurrentTime } from '../use-current-time';
import { StatusBadge } from './StatusBadge';

export function dataTimestamp(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'jamais reçues';
}

export function DataFreshness({
  fetchedAt,
  stale,
  error,
  interval,
  source,
}: {
  fetchedAt: string;
  stale: boolean;
  error: Error | null;
  interval: number;
  source: string;
}) {
  const now = useCurrentTime();
  const outdated = now.getTime() - Date.parse(fetchedAt) >= interval;
  const status = error ? 'offline' : stale || outdated ? 'stale' : 'ready';
  const cause = error
    ? error instanceof ApiError
      ? 'Récupération impossible'
      : 'Liaison tablette → Pi interrompue'
    : `${source} : actualisation en attente`;
  return (
    <StatusBadge status={status} label={`${cause} · données du ${dataTimestamp(fetchedAt)}`} />
  );
}

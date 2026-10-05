import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { connectionHealthSchema, type ConnectionHealth } from '@homedash/contracts';
import { api, ApiError } from './api';
import { useCurrentTime } from './use-current-time';
import type { RealtimeConnection } from './realtime';

export function connectionSummary({
  networkOnline,
  error,
  checkedAt,
  now,
  data,
  realtime,
}: {
  networkOnline: boolean;
  error: Error | null;
  checkedAt: number;
  now: number;
  data: ConnectionHealth | undefined;
  realtime: RealtimeConnection;
}) {
  if (error) {
    if (!networkOnline)
      return {
        level: 'offline',
        label: 'Tablette hors réseau',
        message:
          'La tablette signale une perte de réseau. Vérifiez son Wi-Fi ; les dernières données restent affichées.',
      };
    if (error instanceof ApiError)
      return {
        level: 'offline',
        label: 'HomeDash en erreur',
        message: `Le Pi répond, mais HomeDash renvoie une erreur (${error.status}). Nouvelle tentative automatique.`,
      };
    return {
      level: 'offline',
      label: 'Pi inaccessible',
      message:
        'La tablette ne reçoit plus de réponse du Raspberry Pi. Le réseau du Pi ou son serveur peut être en cause. Reconnexion automatique en cours.',
    };
  }
  if (!data || now - checkedAt > 75_000)
    return { level: 'connecting', label: 'Vérification du Pi', message: '' };
  const problems = data.integrations.filter((item) =>
    ['stale', 'error', 'unconfigured'].includes(item.state),
  );
  if (problems.length) {
    const names = [
      ...new Set(problems.map((item) => (item.kind === 'weather' ? 'météo' : 'calendrier'))),
    ].join(' et ');
    return {
      level: 'warning',
      label: 'Pi connecté · données en attente',
      message: `Le Pi répond. ${names.charAt(0).toUpperCase() + names.slice(1)} : ${problems.some((item) => item.state === 'unconfigured') ? 'connexion au fournisseur à configurer' : 'collecte en retard ou fournisseur inaccessible'}. Les dates et le diagnostic des collectes figurent ci-dessous.`,
    };
  }
  if (realtime !== 'online')
    return {
      level: 'warning',
      label: 'Pi connecté · liaison en reprise',
      message:
        'Le Pi répond aux requêtes, mais la liaison temps réel se reconnecte. Les widgets continuent leur actualisation régulière.',
    };
  return { level: 'online', label: 'Pi connecté', message: '' };
}

export function useConnectionHealth(realtime: RealtimeConnection) {
  const client = useQueryClient();
  const [networkOnline, setNetworkOnline] = useState(navigator.onLine);
  const failed = useRef(false);
  const now = useCurrentTime();
  useEffect(() => {
    const update = () => setNetworkOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const query = useQuery({
    queryKey: ['connection-health'],
    queryFn: async ({ signal }) =>
      connectionHealthSchema.parse(
        await api<ConnectionHealth>(
          '/api/v1/connection',
          { signal, cache: 'no-store' },
          false,
          8_000,
        ),
      ),
    retry: false,
    networkMode: 'always',
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (query.isError) failed.current = true;
    else if (query.isSuccess && failed.current) {
      failed.current = false;
      for (const key of ['bootstrap', 'weather', 'calendar-status', 'calendar-events']) {
        void client.invalidateQueries({ queryKey: [key] }, { cancelRefetch: false });
      }
    }
  }, [client, query.isError, query.isSuccess]);
  return {
    ...query,
    summary: connectionSummary({
      networkOnline,
      error: query.error,
      checkedAt: query.dataUpdatedAt,
      now: now.getTime(),
      data: query.data,
      realtime,
    }),
  };
}

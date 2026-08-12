import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, Clock3, Router, Wifi } from 'lucide-react';
import type { NetworkMetrics } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import type { WidgetComponentProps } from './types';

export function NetworkWidget(_props: WidgetComponentProps) {
  const query = useQuery({
    queryKey: ['network'],
    queryFn: () => api<NetworkMetrics>('/api/v1/network'),
    refetchInterval: 15_000,
  });
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  const data = query.data;
  return (
    <div className="network-widget">
      <div
        className={`network-status ${data.online ? 'network-status--online' : 'network-status--offline'}`}
      >
        {data.online ? <CircleCheck size={28} /> : <CircleX size={28} />}
        <div>
          <strong>{data.online ? 'Internet disponible' : 'Internet indisponible'}</strong>
          <span>Le réseau local reste opérationnel</span>
        </div>
      </div>
      <div className="network-grid">
        <span>
          <Clock3 size={18} />
          <strong>{data.latencyMs == null ? '—' : `${data.latencyMs} ms`}</strong>
          <small>Latence</small>
        </span>
        <span>
          <Router size={18} />
          <strong>{data.hostname}</strong>
          <small>Serveur</small>
        </span>
        <span>
          <Wifi size={18} />
          <strong>{data.localAddresses[0] ?? '—'}</strong>
          <small>Adresse locale</small>
        </span>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Clock3, Radio, Thermometer } from 'lucide-react';
import type { Sensor } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import type { WidgetComponentProps } from './types';

export function SensorWidget({ instance }: WidgetComponentProps) {
  const sensorId =
    typeof instance.config.sensorId === 'string'
      ? instance.config.sensorId
      : 'mock-indoor-temperature';
  const query = useQuery({
    queryKey: ['sensor', sensorId],
    queryFn: () => api<Sensor>(`/api/v1/sensors/${encodeURIComponent(sensorId)}`),
    refetchInterval: 10_000,
  });
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  const sensor = query.data;
  return (
    <div className="sensor-widget">
      <div className="sensor-widget__value">
        <Thermometer size={42} />
        <strong>
          {sensor.value == null ? '—' : sensor.value.toFixed(1)}
          <sup>{sensor.unit}</sup>
        </strong>
      </div>
      <h3>{sensor.name}</h3>
      <div className="sensor-widget__meta">
        <span>
          <Radio size={15} />
          {sensor.source}
        </span>
        <span>
          <Clock3 size={15} />
          {sensor.timestamp
            ? new Date(sensor.timestamp).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : 'Jamais'}
        </span>
      </div>
      <StatusBadge
        status={
          sensor.status === 'online' ? 'ready' : sensor.status === 'stale' ? 'stale' : 'offline'
        }
      />
    </div>
  );
}

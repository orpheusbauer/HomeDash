import { useQuery } from '@tanstack/react-query';
import { Cpu, Database, HardDrive, MemoryStick, Timer, Thermometer } from 'lucide-react';
import type { SystemMetrics } from '@homedash/contracts';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { formatBytes, formatDuration } from './shared';
import type { WidgetComponentProps } from './types';

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <span className="metric-meter">
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      <small>{label}</small>
    </span>
  );
}

export function SystemWidget(_props: WidgetComponentProps) {
  const query = useQuery({
    queryKey: ['system'],
    queryFn: () => api<SystemMetrics>('/api/v1/system'),
    refetchInterval: 5000,
  });
  if (!query.data)
    return (
      <div className="widget-centered">
        <StatusBadge status={query.isError ? 'error' : 'loading'} />
      </div>
    );
  const data = query.data;
  const memoryPercent = (data.memoryUsedBytes / data.memoryTotalBytes) * 100;
  const storagePercent =
    data.storageUsedBytes != null && data.storageTotalBytes
      ? (data.storageUsedBytes / data.storageTotalBytes) * 100
      : 0;
  return (
    <div className="system-widget">
      <div className="metric-row">
        <Cpu size={20} />
        <div>
          <strong>{data.cpuPercent.toFixed(0)} %</strong>
          <Meter value={data.cpuPercent} label="Processeur" />
        </div>
      </div>
      <div className="metric-row">
        <MemoryStick size={20} />
        <div>
          <strong>{formatBytes(data.memoryUsedBytes)}</strong>
          <Meter value={memoryPercent} label={`sur ${formatBytes(data.memoryTotalBytes)}`} />
        </div>
      </div>
      <div className="metric-row">
        <HardDrive size={20} />
        <div>
          <strong>
            {data.storageUsedBytes == null ? '—' : formatBytes(data.storageUsedBytes)}
          </strong>
          <Meter
            value={storagePercent}
            label={
              data.storageTotalBytes == null
                ? 'Stockage indisponible'
                : `sur ${formatBytes(data.storageTotalBytes)}`
            }
          />
        </div>
      </div>
      <div className="system-widget__footer">
        <span>
          <Thermometer size={17} />
          {data.cpuTemperatureCelsius == null
            ? 'N/D'
            : `${data.cpuTemperatureCelsius.toFixed(1)} °C`}
        </span>
        <span>
          <Timer size={17} />
          {formatDuration(data.uptimeSeconds)}
        </span>
        <span>
          <Database size={17} />
          {data.hostname}
        </span>
      </div>
    </div>
  );
}

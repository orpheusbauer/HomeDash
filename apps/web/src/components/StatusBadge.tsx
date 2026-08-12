import { CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { WidgetStatus } from '@homedash/contracts';

export function StatusBadge({ status, label }: { status: WidgetStatus; label?: string }) {
  if (status === 'ready') return null;
  const content = {
    loading: { icon: <LoaderCircle className="spin" size={14} />, text: label ?? 'Chargement' },
    stale: { icon: <CloudOff size={14} />, text: label ?? 'Données en cache' },
    offline: { icon: <CloudOff size={14} />, text: label ?? 'Hors ligne' },
    error: { icon: <TriangleAlert size={14} />, text: label ?? 'Indisponible' },
    ready: { icon: null, text: '' },
  }[status];
  return (
    <span className={`status-badge status-badge--${status}`}>
      {content.icon}
      {content.text}
    </span>
  );
}

import { LoaderCircle } from 'lucide-react';
import type { WidgetStatus } from '@homedash/contracts';
import { useWidgetNotification } from '../notifications';

export function StatusBadge({ status, label }: { status: WidgetStatus; label?: string }) {
  const message = {
    stale: 'Les dernières données sont conservées en attendant leur actualisation.',
    offline:
      'La source de données ne répond plus. Une nouvelle tentative sera faite automatiquement.',
    error:
      'Les données ne peuvent pas être récupérées. Une nouvelle tentative sera faite automatiquement.',
    loading: null,
    ready: null,
  }[status];
  useWidgetNotification(
    message ? (label ?? message) : null,
    status === 'offline' ? 'offline' : 'warning',
  );
  if (status !== 'loading') return null;
  return (
    <span className="status-badge status-badge--loading">
      <LoaderCircle className="spin" size={14} />
      {label ?? 'Chargement'}
    </span>
  );
}

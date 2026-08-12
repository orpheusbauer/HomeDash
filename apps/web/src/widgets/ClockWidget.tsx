import { useEffect, useMemo, useState } from 'react';
import { fr } from 'date-fns/locale';
import { format } from 'date-fns';
import type { WidgetComponentProps } from './types';

export function ClockWidget({ instance }: WidgetComponentProps) {
  const [now, setNow] = useState(new Date());
  const showSeconds = instance.config.showSeconds === true;
  const hour12 = instance.config.format === '12h';
  const timezone =
    typeof instance.config.timezone === 'string' ? instance.config.timezone : 'Europe/Paris';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), showSeconds ? 1000 : 10_000);
    return () => window.clearInterval(timer);
  }, [showSeconds]);

  const time = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        ...(showSeconds ? { second: '2-digit' as const } : {}),
        hour12,
        timeZone: timezone,
      }).format(now),
    [hour12, now, showSeconds, timezone],
  );

  return (
    <div className="clock-widget">
      <time className={`clock-widget__time ${showSeconds ? 'clock-widget__time--seconds' : ''}`}>
        {time}
      </time>
      <p className="clock-widget__date">{format(now, 'EEEE d MMMM', { locale: fr })}</p>
      <span className="clock-widget__year">{format(now, 'yyyy')}</span>
    </div>
  );
}

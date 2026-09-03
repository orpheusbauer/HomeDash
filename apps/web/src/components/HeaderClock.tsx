import { useEffect, useState } from 'react';

export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 1_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const fullDate = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return (
    <time className="header-clock" dateTime={now.toISOString()} title={fullDate}>
      <span className="header-clock__time">
        {now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="header-clock__date">{fullDate}</span>
      <span className="header-clock__compact-date" aria-hidden="true">
        {now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
      </span>
    </time>
  );
}

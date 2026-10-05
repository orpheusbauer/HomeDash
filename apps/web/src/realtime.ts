import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeMessage, Sensor, SystemMetrics } from '@homedash/contracts';
import { realtimeUrl } from './api';

export type RealtimeConnection = 'online' | 'offline' | 'connecting';

export function listenForRealtime(
  client: QueryClient,
  onState: (state: RealtimeConnection) => void,
) {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let opened = false;
  let lastSeen = Date.now();

  const invalidate = (key: string) =>
    void client.invalidateQueries({ queryKey: [key] }, { cancelRefetch: false });
  const connect = () => {
    if (disposed) return;
    if (retry) clearTimeout(retry);
    opened = false;
    lastSeen = Date.now();
    onState('connecting');
    let current: WebSocket;
    try {
      current = new WebSocket(realtimeUrl());
    } catch {
      onState('offline');
      retry = setTimeout(connect, 3_000);
      return;
    }
    socket = current;
    current.addEventListener('open', () => {
      if (disposed || socket !== current) return;
      opened = true;
      lastSeen = Date.now();
      onState('online');
      for (const key of ['bootstrap', 'weather', 'calendar-events', 'connection-health'])
        invalidate(key);
    });
    current.addEventListener('message', (event) => {
      if (disposed || socket !== current) return;
      lastSeen = Date.now();
      try {
        const message = JSON.parse(String(event.data)) as RealtimeMessage;
        if (message.type === 'sensor.updated') {
          client.setQueryData<Sensor>(['sensor', message.payload.id], message.payload);
          invalidate('sensors');
        }
        if (message.type === 'system.updated')
          client.setQueryData<SystemMetrics>(['system'], message.payload);
        if (message.type === 'dashboard.changed') invalidate('bootstrap');
        if (message.type === 'integration.updated') {
          invalidate(message.payload.kind === 'weather' ? 'weather' : 'calendar-events');
          invalidate('connection-health');
        }
      } catch {
        /* Ignore incompatible future messages. */
      }
    });
    current.addEventListener('close', () => {
      if (disposed || socket !== current) return;
      opened = false;
      onState('offline');
      retry = setTimeout(connect, 3_000);
    });
    current.addEventListener('error', () => {
      if (disposed || socket !== current) return;
      socket = undefined;
      opened = false;
      current.close();
      onState('offline');
      // An immediate retry can spin continuously while the Pi/network is down.
      retry = setTimeout(connect, 3_000);
    });
  };
  const reconnect = () => {
    const previous = socket;
    socket = undefined;
    previous?.close();
    connect();
  };
  const check = () => {
    if (Date.now() - lastSeen > (opened ? 45_000 : 15_000)) reconnect();
  };
  const resume = () => {
    if (!opened || Date.now() - lastSeen > 20_000) reconnect();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') resume();
  };
  connect();
  const watchdog = setInterval(check, 10_000);
  for (const event of ['online', 'homedash:resume', 'pageshow'])
    window.addEventListener(event, resume);
  document.addEventListener('visibilitychange', visible);
  return () => {
    disposed = true;
    clearInterval(watchdog);
    if (retry) clearTimeout(retry);
    for (const event of ['online', 'homedash:resume', 'pageshow'])
      window.removeEventListener(event, resume);
    document.removeEventListener('visibilitychange', visible);
    socket?.close();
  };
}

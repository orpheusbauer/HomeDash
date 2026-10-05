import type { RealtimeMessage } from '@homedash/contracts';
import type { WebSocket } from 'ws';

const clients = new Set<WebSocket>();
const alive = new WeakSet<WebSocket>();
let heartbeat: ReturnType<typeof setInterval> | undefined;

function forget(socket: WebSocket): void {
  clients.delete(socket);
  if (clients.size === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

export function addRealtimeClient(socket: WebSocket): void {
  clients.add(socket);
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  socket.on('close', () => forget(socket));
  socket.on('error', () => forget(socket));
  heartbeat ??= setInterval(() => {
    for (const client of clients) {
      if (!alive.has(client)) {
        forget(client);
        client.terminate();
        continue;
      }
      alive.delete(client);
      if (client.readyState === client.OPEN) {
        try {
          client.ping();
        } catch {
          forget(client);
          client.terminate();
        }
      }
    }
    broadcast({ type: 'server.heartbeat', payload: { serverTime: new Date().toISOString() } });
  }, 20_000);
  heartbeat.unref();
}

export function broadcast(message: RealtimeMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      try {
        client.send(payload);
      } catch {
        forget(client);
        client.terminate();
      }
    }
  }
}

export function realtimeClientCount(): number {
  return clients.size;
}

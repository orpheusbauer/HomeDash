import type { RealtimeMessage } from '@homedash/contracts';
import type { WebSocket } from 'ws';

const clients = new Set<WebSocket>();

export function addRealtimeClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

export function broadcast(message: RealtimeMessage): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

export function realtimeClientCount(): number {
  return clients.size;
}

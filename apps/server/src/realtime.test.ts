import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRealtimeClient, realtimeClientCount } from './realtime.js';

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  ping = vi.fn();
  send = vi.fn<(payload: string) => void>();
  terminate = vi.fn(() => this.emit('close'));
}
let socket: Socket;
beforeEach(() => {
  vi.useFakeTimers();
  socket = new Socket();
  addRealtimeClient(socket as unknown as WebSocket);
});
afterEach(() => {
  socket.emit('close');
  vi.useRealTimers();
});
describe('heartbeat du serveur', () => {
  it('émet des messages et vérifie les réponses pong sans accumuler des clients morts', async () => {
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.ping).toHaveBeenCalledOnce();
    expect((JSON.parse(socket.send.mock.calls[0]?.[0] as string) as { type: string }).type).toBe(
      'server.heartbeat',
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(realtimeClientCount()).toBe(0);
  });
  it('maintient un client qui répond', async () => {
    await vi.advanceTimersByTimeAsync(20_000);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(realtimeClientCount()).toBe(1);
  });
});

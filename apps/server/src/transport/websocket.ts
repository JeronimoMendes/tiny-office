import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { clientMessageSchema, type ServerMessage } from '@office/shared';
import type { Store } from '../persistence/store';
import type { Peer, World } from '../world/tick';
import { hashSecret } from '../auth/secrets';

export function websocketTransport(
  app: FastifyInstance,
  store: Store,
  world: World,
  origin: string,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  app.server.on('upgrade', (req, socket, head) => {
    void (async () => {
      socket.on('error', () => {});
      if (req.url !== '/ws' || req.headers.origin !== origin) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const token = app.parseCookie(req.headers.cookie ?? '').office_session ?? '';
      const session = await store.identity(token);
      if (!session || session.workspaceId !== world.workspace.id) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        let alive = true;
        const peer: Peer = {
          send(message: ServerMessage) {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (ws.bufferedAmount > 256 * 1024) {
              ws.terminate();
              return;
            }
            ws.send(JSON.stringify(message));
          },
          close(code, reason) {
            ws.close(code, reason);
          },
        };
        world.attach(session.userId, peer, session.expiresAt.getTime(), hashSecret(token));
        ws.on('pong', () => {
          alive = true;
        });
        const ping = setInterval(() => {
          if (!alive) return ws.terminate();
          alive = false;
          ws.ping();
        }, 15000);
        ws.on('message', (data) => {
          try {
            const input = clientMessageSchema.parse(JSON.parse(data.toString()));
            world.input(session.userId, peer, input);
          } catch {
            ws.close(4002, 'Invalid message');
            world.detach(session.userId, peer);
          }
        });
        ws.on('error', (error) => app.log.warn(error));
        ws.on('close', () => {
          clearInterval(ping);
          world.detach(session.userId, peer);
          void world
            .flush()
            .catch((error) => app.log.error(error, 'Disconnect persistence failed; will retry'));
        });
      });
    })().catch((error) => {
      app.log.error(error);
      socket.destroy();
    });
  });
  return async () => {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };
}

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { STEP_MS } from '@office/shared';
import type { Store } from './persistence/store';
import { World } from './world/tick';
import { httpRoutes } from './transport/http';
import { websocketTransport } from './transport/websocket';
import { LiveKitMedia, type MediaRoomService } from './media/livekit';
import { createMailer, type Mailer } from './auth/mailer';

export async function createApp(
  store: Store,
  options: {
    workspaceId: string;
    origin: string;
    bootstrapSecret: string;
    logger?: boolean;
    livekit?: { apiUrl?: string; wsUrl?: string; apiKey?: string; apiSecret?: string };
    mediaService?: MediaRoomService;
    mailer?: Mailer;
  },
) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 10_000_000,
    requestTimeout: 10000,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  const world = new World(
    await store.workspace(options.workspaceId),
    await store.members(options.workspaceId),
    store,
  );
  const media = new LiveKitMedia(world, options.livekit ?? {}, options.mediaService);
  world.setMediaPolicyChangeHandler(media.schedule);
  media.start();
  httpRoutes(
    app,
    store,
    world,
    options.origin,
    options.bootstrapSecret,
    media,
    options.mailer ?? createMailer(),
  );
  const stopSockets = websocketTransport(app, store, world, options.origin);
  await app.register(fastifyStatic, {
    root: resolve('assets'),
    prefix: '/assets/',
    decorateReply: true,
  });
  if (existsSync('dist/client')) {
    await app.register(fastifyStatic, {
      root: resolve('dist/client'),
      prefix: '/',
      decorateReply: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.includes('.'))
        return reply.sendFile('index.html', resolve('dist/client'));
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  const tick = setInterval(() => world.tick(), STEP_MS);
  const flush = setInterval(
    () =>
      void world
        .flush()
        .catch((e) => app.log.error(e, 'Position flush failed; retaining dirty state')),
    2000,
  );
  const cleanup = setInterval(
    () => void store.cleanup().catch((e) => app.log.error(e)),
    60 * 60000,
  );
  app.addHook('preClose', async () => {
    clearInterval(tick);
    clearInterval(flush);
    clearInterval(cleanup);
    media.stop();
    await stopSockets();
    await world.flush();
  });
  return { app, world };
}

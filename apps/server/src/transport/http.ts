import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { inviteSchema, profileSchema, statusSchema } from '@office/shared';
import { equalSecret, hashSecret } from '../auth/secrets';
import type { Store, Identity } from '../persistence/store';
import type { World } from '../world/tick';
import type { LiveKitMedia } from '../media/livekit';

export function httpRoutes(
  app: FastifyInstance,
  store: Store,
  world: World,
  origin: string,
  bootstrapSecret: string,
  media: LiveKitMedia,
) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: origin.startsWith('https:'),
    path: '/',
    maxAge: 30 * 86400,
  };
  const refresh = async () =>
    world.updateMembers(
      await store.members(world.workspace.id),
      await store.desks(world.workspace.id),
    );
  async function identity(req: FastifyRequest, owner = false): Promise<Identity> {
    const user = await store.identity(req.cookies.office_session ?? '');
    if (!user || user.workspaceId !== world.workspace.id)
      throw Object.assign(new Error('Please sign in'), { statusCode: 401 });
    if (owner && user.role !== 'owner')
      throw Object.assign(new Error('Owner access required'), { statusCode: 403 });
    return user;
  }
  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie('office_session', token, cookieOptions).send({ ok: true });
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin)
      return reply.code(403).send({ error: 'Invalid origin' });
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
  });
  app.get('/api/health', async () => {
    await store.pool.query('SELECT 1');
    return { ok: true };
  });
  app.get('/api/bootstrap', async () => ({
    required: !(await store.hasOwner(world.workspace.id)),
  }));
  app.post(
    '/api/bootstrap',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = inviteSchema.extend({ secret: z.string().min(1).max(256) }).parse(req.body);
      if (!equalSecret(body.secret, bootstrapSecret))
        return reply.code(403).send({ error: 'Invalid bootstrap secret' });
      if (await store.hasOwner(world.workspace.id))
        return reply.code(409).send({ error: 'Workspace already claimed' });
      const token = await store.bootstrap(
        world.workspace.id,
        body.email,
        body.displayName,
        world.workspace.map,
      );
      await refresh();
      return setSession(reply, token);
    },
  );
  app.post(
    '/api/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = z
        .object({ token: z.string().min(32).max(128) })
        .strict()
        .parse(req.body);
      const session = await store.redeem(token);
      if (!session)
        return reply.code(401).send({
          error: 'This link is expired or has already been used. Ask the owner for a new one.',
        });
      return setSession(reply, session);
    },
  );
  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies.office_session ?? '';
    await store.logout(token);
    world.revokeSession(hashSecret(token));
    await world.flush();
    return reply.clearCookie('office_session', cookieOptions).send({ ok: true });
  });
  app.get('/api/session', async (req) => {
    const session = await identity(req);
    const members = [...world.members.values()].map(({ x, y, ...m }) => m);
    return {
      user: members.find((m) => m.id === session.userId),
      workspace: world.workspace,
      members,
    };
  });
  app.post('/api/invites', async (req) => {
    await identity(req, true);
    const { email, displayName } = inviteSchema.parse(req.body);
    const token = await store.invite(world.workspace.id, email, displayName, world.workspace.map);
    await refresh();
    return { url: `${origin}/#login=${token}`, expiresInHours: 24 };
  });
  app.patch('/api/profile', async (req) => {
    const session = await identity(req),
      body = profileSchema.parse(req.body);
    await store.profile(session.userId, body.displayName, body.character, body.appearance);
    await refresh();
    return { ok: true };
  });
  app.patch('/api/status', async (req) => {
    const session = await identity(req);
    const { status } = z.object({ status: statusSchema }).strict().parse(req.body);
    await store.status(world.workspace.id, session.userId, status);
    await refresh();
    media.schedule();
    return { ok: true };
  });
  app.get('/api/media/token', async (req) => {
    const session = await identity(req);
    return media.token(session.userId);
  });
  app.put('/api/desks/:zoneId', async (req) => {
    await identity(req, true);
    const { zoneId } = z.object({ zoneId: z.string() }).parse(req.params);
    const { userId } = z.object({ userId: z.string().uuid().nullable() }).strict().parse(req.body);
    if (
      !world.map.zones.some((z) => z.id === zoneId && z.kind === 'desk') ||
      (userId && !world.members.has(userId))
    )
      throw Object.assign(new Error('Unknown desk or member'), { statusCode: 400 });
    await store.assignDesk(world.workspace.id, zoneId, userId);
    await refresh();
    return { ok: true };
  });
  app.post('/api/desks/:zoneId/claim', async (req) => {
    const session = await identity(req);
    const { zoneId } = z.object({ zoneId: z.string() }).parse(req.params);
    if (!world.map.zones.some((z) => z.id === zoneId && z.kind === 'desk'))
      throw Object.assign(new Error('Unknown desk'), { statusCode: 400 });
    if (world.connections.get(session.userId)?.player.zoneId !== zoneId)
      throw Object.assign(new Error('Walk into this desk before claiming it'), { statusCode: 409 });
    if (!(await store.claimDesk(world.workspace.id, zoneId, session.userId)))
      throw Object.assign(new Error('Someone else just took this desk'), { statusCode: 409 });
    await refresh();
    return { ok: true };
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: 'Invalid request',
        details: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    const status =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (status >= 500) req.log.error(error);
    return reply.code(status).send({
      error:
        status >= 500 || !(error instanceof Error)
          ? 'Server error; please try again'
          : error.message,
    });
  });
}

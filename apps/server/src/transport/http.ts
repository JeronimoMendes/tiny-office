import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  canStand,
  customStatusSchema,
  inviteSchema,
  parseMap,
  profileSchema,
  statusSchema,
} from '@office/shared';
import { equalSecret, hashSecret } from '../auth/secrets';
import { signInMail, type Mailer } from '../auth/mailer';
import { LOGIN_TOKEN_HOURS, type Store, type Identity } from '../persistence/store';
import type { World } from '../world/tick';
import type { LiveKitMedia } from '../media/livekit';

export function httpRoutes(
  app: FastifyInstance,
  store: Store,
  world: World,
  origin: string,
  bootstrapSecret: string,
  media: LiveKitMedia,
  mailer: Mailer,
) {
  const loginUrl = (token: string) => `${origin}/#login=${token}`;
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
    emailSignIn: mailer.enabled,
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
  // Members recover on their own; the reply never reveals who is a member.
  app.post(
    '/api/sign-in',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email } = z
        .object({ email: z.string().email().max(254) })
        .strict()
        .parse(req.body);
      if (!mailer.enabled)
        return reply
          .code(503)
          .send({ error: 'Email sign-in is not set up here. Ask the owner for a link.' });
      const issued = await store.loginToken(world.workspace.id, email);
      if (issued && issued !== 'throttled')
        try {
          await mailer.send({
            to: email,
            ...signInMail(world.workspace.name, loginUrl(issued.token), LOGIN_TOKEN_HOURS),
          });
        } catch (error) {
          req.log.error(error, 'Sign-in email failed to send');
        }
      return { ok: true };
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
  app.get('/api/editor/workspaces', async (req) => {
    await identity(req, true);
    return {
      workspaces: [
        {
          id: world.workspace.id,
          name: world.workspace.name,
          mapRevision: world.workspace.mapRevision,
        },
      ],
    };
  });
  app.get('/api/editor/workspaces/:workspaceId', async (req) => {
    const session = await identity(req, true);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    if (workspaceId !== session.workspaceId)
      throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
    return { workspace: world.workspace };
  });
  app.put('/api/editor/workspaces/:workspaceId/map', async (req) => {
    const session = await identity(req, true);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    if (workspaceId !== session.workspaceId)
      throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
    const body = z
      .object({ expectedRevision: z.string().length(64), map: z.unknown() })
      .strict()
      .parse(req.body);
    try {
      const map = parseMap(body.map);
      if (!canStand(map, map.spawn.x, map.spawn.y)) throw new Error('Spawn must be walkable');
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw Object.assign(error instanceof Error ? error : new Error('Invalid map'), {
        statusCode: 400,
      });
    }
    await world.flush();
    await store.updateMap(workspaceId, body.expectedRevision, body.map);
    const workspace = await store.workspace(workspaceId);
    world.applyWorkspaceMap(workspace);
    return { workspace };
  });
  app.put('/api/desks/mine/map', async (req) => {
    const session = await identity(req);
    const body = z
      .object({ expectedRevision: z.string().length(64), map: z.unknown() })
      .strict()
      .parse(req.body);
    await world.flush();
    await store.updateMap(session.workspaceId, body.expectedRevision, body.map, session.userId);
    const workspace = await store.workspace(session.workspaceId);
    world.applyWorkspaceMap(workspace);
    return { workspace };
  });
  app.post('/api/invites', async (req) => {
    await identity(req, true);
    const { email, displayName } = inviteSchema.parse(req.body);
    const token = await store.invite(world.workspace.id, email, displayName, world.workspace.map);
    await refresh();
    let emailed = false;
    if (mailer.enabled)
      try {
        await mailer.send({
          to: email,
          ...signInMail(world.workspace.name, loginUrl(token), LOGIN_TOKEN_HOURS),
        });
        emailed = true;
      } catch (error) {
        req.log.error(error, 'Invite email failed to send');
      }
    return { url: loginUrl(token), expiresInHours: LOGIN_TOKEN_HOURS, emailed };
  });
  app.patch('/api/profile', async (req) => {
    const session = await identity(req),
      body = profileSchema.parse(req.body);
    await store.profile(session.userId, body.displayName, body.character, body.appearance);
    await refresh();
    return { ok: true };
  });
  app.patch('/api/custom-status', async (req) => {
    const session = await identity(req);
    const body = customStatusSchema.parse(req.body);
    await store.customStatus(world.workspace.id, session.userId, body);
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
  app.delete('/api/desks/mine', async (req) => {
    const session = await identity(req);
    if (!(await store.releaseDesk(world.workspace.id, session.userId)))
      throw Object.assign(new Error('You have no desk to leave'), { statusCode: 409 });
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

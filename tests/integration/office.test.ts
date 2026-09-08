import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Store, DEFAULT_WORKSPACE_ID } from '../../apps/server/src/persistence/store';
import { createApp } from '../../apps/server/src/app';
import { World } from '../../apps/server/src/world/tick';
import type { MediaRoomService } from '../../apps/server/src/media/livekit';
import type { Mail, Mailer } from '../../apps/server/src/auth/mailer';
import {
  TrackSource,
  type ParticipantInfo,
  type ParticipantPermission,
  type Room as LiveKitRoom,
} from 'livekit-server-sdk';
import { presetAppearance, type ServerMessage, type Status } from '@office/shared';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'Set TEST_DATABASE_URL to a PostgreSQL database; tests use an isolated temporary schema.',
  );
const admin = new Pool({ connectionString: url });
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
const store = new Store(pool),
  id = DEFAULT_WORKSPACE_ID;
const raw = JSON.parse(readFileSync('maps/office.tmj', 'utf8'));
const origin = 'http://office.test';
let office: Awaited<ReturnType<typeof createApp>>;
const mailbox: Mail[] = [];
const mailer: Mailer = {
  enabled: true,
  async send(mail) {
    mailbox.push(mail);
  },
};
const linkToken = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('login')!;
let ownerCookie: string, ownerId: string;
const cookieOf = (response: { headers: Record<string, unknown> }) =>
  String(response.headers['set-cookie']).split(';')[0];
const headers = (cookie = ownerCookie) => ({ origin, cookie });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await store.migrate();
  await store.ensureWorkspace(id, raw);
  office = await createApp(store, {
    workspaceId: id,
    origin,
    bootstrapSecret: 'bootstrap-test',
    logger: false,
    mailer,
  });
  await office.app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await office?.app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it('requires the bootstrap secret and protects origin, then claims the owner once', async () => {
  const payload = { email: 'owner@example.test', displayName: 'Owner', secret: 'bootstrap-test' };
  expect(
    (await office.app.inject({ method: 'POST', url: '/api/bootstrap', payload })).statusCode,
  ).toBe(403);
  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/bootstrap',
        headers: { origin },
        payload: { ...payload, secret: 'wrong' },
      })
    ).statusCode,
  ).toBe(403);
  const response = await office.app.inject({
    method: 'POST',
    url: '/api/bootstrap',
    headers: { origin },
    payload,
  });
  expect(response.statusCode).toBe(200);
  ownerCookie = cookieOf(response);
  expect(response.headers['set-cookie']).toContain('HttpOnly');
  expect(response.headers['set-cookie']).toContain('SameSite=Strict');
  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/bootstrap',
        headers: { origin },
        payload,
      })
    ).statusCode,
  ).toBe(409);
  const session = await office.app.inject({ url: '/api/session', headers: headers() });
  expect(session.statusCode).toBe(200);
  ownerId = session.json().user.id;
  expect(session.json().user.role).toBe('owner');
});

it('persists, broadcasts and clears custom status without changing availability', async () => {
  const before = (await store.members(id)).find((member) => member.id === ownerId)!;
  const customStatus = { text: 'Writing docs', emoji: '📝' };
  const response = await office.app.inject({
    method: 'PATCH',
    url: '/api/custom-status',
    headers: headers(),
    payload: customStatus,
  });
  expect(response.statusCode).toBe(200);
  expect((await store.members(id)).find((member) => member.id === ownerId)).toMatchObject({
    customStatus,
    status: before.status,
  });
  const session = await office.app.inject({ url: '/api/session', headers: headers() });
  expect(session.json().user.customStatus).toEqual(customStatus);
  expect(
    session.json().members.find((member: { id: string }) => member.id === ownerId).customStatus,
  ).toEqual(customStatus);
  expect(
    (
      await office.app.inject({
        method: 'PATCH',
        url: '/api/custom-status',
        headers: { origin },
        payload: customStatus,
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await office.app.inject({
        method: 'PATCH',
        url: '/api/custom-status',
        headers: headers(),
        payload: { text: 'x'.repeat(101), emoji: null },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await office.app.inject({
        method: 'PATCH',
        url: '/api/custom-status',
        headers: headers(),
        payload: { text: '', emoji: null },
      })
    ).statusCode,
  ).toBe(200);
  expect((await store.members(id)).find((member) => member.id === ownerId)).toMatchObject({
    customStatus: null,
    status: before.status,
  });
});

it('atomically redeems personal links once and enforces owner/member permissions', async () => {
  const response = await office.app.inject({
    method: 'POST',
    url: '/api/invites',
    headers: headers(),
    payload: { email: 'member@example.test', displayName: 'Member' },
  });
  const token = linkToken(response.json().url);
  expect(response.json().emailed).toBe(true);
  expect(mailbox.at(-1)?.to).toBe('member@example.test');
  const results = await Promise.all([store.redeem(token), store.redeem(token)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const cookie = `office_session=${results.find(Boolean)}`;
  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/invites',
        headers: headers(cookie),
        payload: { email: 'bad@example.test', displayName: 'Bad' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await office.app.inject({
        method: 'PUT',
        url: '/api/desks/desk-1',
        headers: headers(cookie),
        payload: { userId: ownerId },
      })
    ).statusCode,
  ).toBe(403);
  expect((await office.app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(401);
  const revoked = await store.invite(id, 'member@example.test', 'Member', raw);
  await store.invite(id, 'member@example.test', 'Member', raw);
  expect(await store.redeem(revoked)).toBeNull();
  const expired = await store.invite(id, 'expired@example.test', 'Expired', raw);
  await pool.query("UPDATE login_tokens SET expires_at=now()-interval '1 second'");
  expect(await store.redeem(expired)).toBeNull();
});

it('emails a member their own sign-in link without revealing who is a member', async () => {
  const signIn = (email: string) =>
    office.app.inject({
      method: 'POST',
      url: '/api/sign-in',
      headers: { origin },
      payload: { email },
    });
  const emailedLink = (mail: Mail) =>
    linkToken(mail.text.split('\n').find((line) => line.startsWith(origin))!);
  const ageTokens = () =>
    pool.query("UPDATE login_tokens SET created_at=now()-interval '5 minutes'");
  await office.app.inject({
    method: 'POST',
    url: '/api/invites',
    headers: headers(),
    payload: { email: 'lost@example.test', displayName: 'Lost' },
  });
  await ageTokens();
  mailbox.length = 0;

  const stranger = await signIn('nobody@example.test');
  expect(stranger.statusCode).toBe(200);
  expect(stranger.json()).toEqual({ ok: true });
  expect(mailbox).toHaveLength(0);

  // Case-insensitive, so a member is not locked out by how they type their address.
  expect((await signIn('LOST@example.test')).statusCode).toBe(200);
  expect(mailbox).toHaveLength(1);
  expect(mailbox[0].to).toBe('LOST@example.test');
  expect(mailbox[0].subject).toContain(office.world.workspace.name);

  // An immediate repeat cannot flood the inbox, and once the cooldown passes the
  // extra link never retires the one already on its way to them.
  const repeat = await signIn('lost@example.test');
  expect(repeat.statusCode).toBe(200);
  expect(repeat.json()).toEqual({ ok: true });
  expect(mailbox).toHaveLength(1);
  await ageTokens();
  expect((await signIn('lost@example.test')).statusCode).toBe(200);
  expect(mailbox).toHaveLength(2);

  const login = await office.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { token: emailedLink(mailbox[0]) },
  });
  expect(login.statusCode).toBe(200);
  const session = await office.app.inject({
    url: '/api/session',
    headers: headers(cookieOf(login)),
  });
  expect(session.json().user.email).toBe('lost@example.test');
});

it('refuses self-service sign-in when email delivery is not configured', async () => {
  const bare = await createApp(store, {
    workspaceId: id,
    origin,
    bootstrapSecret: 'no-mail',
    logger: false,
  });
  try {
    expect((await bare.app.inject({ url: '/api/bootstrap' })).json().emailSignIn).toBe(false);
    const response = await bare.app.inject({
      method: 'POST',
      url: '/api/sign-in',
      headers: { origin },
      payload: { email: 'lost@example.test' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('Ask the owner');
  } finally {
    await bare.app.close();
  }
});

it('lets members claim an available desk while standing in it, and leave it again', async () => {
  const token = await store.invite(id, 'member@example.test', 'Member', raw);
  const session = await store.redeem(token);
  const cookie = `office_session=${session}`;
  const memberId = (await store.members(id)).find(
    (member) => member.email === 'member@example.test',
  )!.id;
  office.world.updateMembers(await store.members(id), await store.desks(id));

  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/desks/desk-2/claim',
        headers: headers(cookie),
        payload: {},
      })
    ).statusCode,
  ).toBe(409);

  const connection = connect(cookie);
  await until(() => office.world.connections.has(memberId), 'Member did not connect');
  const desk = office.world.map.zones.find((zone) => zone.id === 'desk-2')!;
  Object.assign(office.world.connections.get(memberId)!.player, {
    x: desk.x + desk.width / 2,
    y: desk.y + desk.height / 2,
    zoneId: desk.id,
  });
  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/desks/desk-2/claim',
        headers: headers(cookie),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await store.workspace(id)).desks['desk-2']).toBe(memberId);

  const leave = () =>
    office.app.inject({
      method: 'DELETE',
      url: '/api/desks/mine',
      headers: headers(cookie),
      payload: {},
    });
  expect((await leave()).statusCode).toBe(200);
  expect((await store.workspace(id)).desks['desk-2']).toBeUndefined();
  expect(office.world.workspace.desks['desk-2']).toBeUndefined();
  expect((await leave()).statusCode).toBe(409);
  await office.app.inject({
    method: 'POST',
    url: '/api/desks/desk-2/claim',
    headers: headers(cookie),
    payload: {},
  });

  await office.app.inject({
    method: 'PUT',
    url: '/api/desks/desk-3',
    headers: headers(),
    payload: { userId: memberId },
  });
  expect((await store.workspace(id)).desks).toMatchObject({ 'desk-3': memberId });
  expect((await store.workspace(id)).desks['desk-2']).toBeUndefined();
  await store.assignDesk(id, 'desk-3', null);
  await office.world.flush();
  connection.socket.close();
});

it('persists profile and desk assignments and denies unknown members/zones', async () => {
  await store.migrate(); // Applying the wardrobe migration twice is safe.
  expect(
    (
      await office.app.inject({
        method: 'PATCH',
        url: '/api/profile',
        headers: headers(),
        payload: { displayName: 'Alice', character: 3 },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await office.app.inject({
        method: 'PUT',
        url: '/api/desks/desk-1',
        headers: headers(),
        payload: { userId: ownerId },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await office.app.inject({
        method: 'PUT',
        url: '/api/desks/cedar',
        headers: headers(),
        payload: { userId: ownerId },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await office.app.inject({
        method: 'PUT',
        url: '/api/desks/desk-2',
        headers: headers(),
        payload: { userId: randomUUID() },
      })
    ).statusCode,
  ).toBe(400);
  expect((await store.workspace(id)).desks).toEqual({ 'desk-1': ownerId });
  expect((await store.members(id)).find((m) => m.id === ownerId)).toMatchObject({
    displayName: 'Alice',
    character: 3,
  });
});

function connect(cookie: string) {
  const address = office.app.server.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    origin,
    headers: { cookie },
  });
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return {
    socket,
    messages,
    next: (predicate: (m: ServerMessage) => boolean) =>
      new Promise<ServerMessage>((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        const timeout = setTimeout(() => {
          socket.off('message', listener);
          reject(new Error('Timed out waiting for socket message'));
        }, 5000);
        const listener = (data: Buffer) => {
          const message = JSON.parse(data.toString());
          if (predicate(message)) {
            clearTimeout(timeout);
            socket.off('message', listener);
            resolve(message);
          }
        };
        socket.on('message', listener);
      }),
  };
}

it('moves via real WebSockets, flushes on disconnect and restores after an empty server restart', async () => {
  const one = connect(ownerCookie);
  const welcome = await one.next((m) => m.type === 'welcome');
  if (welcome.type !== 'welcome') throw new Error('Expected welcome');
  const start = welcome.players.find((p) => p.id === ownerId)!;
  for (let seq = 1; seq <= 4; seq++) {
    one.socket.send(JSON.stringify({ type: 'input', seq, heading: 'right' }));
    await one.next((m) => m.type === 'delta' && m.ack === seq);
  }
  const moved = await one.next((m) => m.type === 'delta' && m.ack === 4);
  expect(moved.type === 'delta' && moved.changedPlayers.find((p) => p.id === ownerId)?.x).toBe(
    start.x + 32,
  );
  const closed = new Promise((resolve) => one.socket.once('close', resolve));
  one.socket.close();
  await closed;
  await office.app.close();
  expect((await store.members(id)).find((m) => m.id === ownerId)!.x).toBe(start.x + 32);
  // Status isn't editable until phase 3; ensure existing status is never reset by a position save.
  await pool.query(
    "UPDATE memberships SET status='do-not-disturb' WHERE workspace_id=$1 AND user_id=$2",
    [id, ownerId],
  );
  office = await createApp(store, {
    workspaceId: id,
    origin,
    bootstrapSecret: 'different-secret',
    logger: false,
  });
  await office.app.listen({ port: 0, host: '127.0.0.1' });
  expect(office.world.connections.size).toBe(0);
  expect(office.world.members.size).toBeGreaterThan(1);
  const two = connect(ownerCookie),
    restored = await two.next((m) => m.type === 'welcome');
  expect(
    restored.type === 'welcome' && restored.players.find((p) => p.id === ownerId),
  ).toMatchObject({
    x: start.x + 32,
    y: start.y,
    displayName: 'Alice',
    character: 3,
    status: 'do-not-disturb',
  });
  const replaced = new Promise<number>((resolve) =>
    two.socket.once('close', (code) => resolve(code)),
  );
  const three = connect(ownerCookie);
  await three.next((m) => m.type === 'welcome');
  expect(await replaced).toBe(4001);
  expect(office.world.connections.size).toBe(1);
  three.socket.close();
});

it('restores the durable map rather than overwriting it from disk and imports explicit revisions', async () => {
  const original = await store.workspace(id),
    edited = structuredClone(raw);
  edited.layers.find((l: any) => l.name === 'zones').objects[0].name = 'Renamed room';
  await store.ensureWorkspace(id, edited);
  expect((await store.workspace(id)).mapRevision).toBe(original.mapRevision);
  await store.importMap(id, edited);
  const restored = await store.workspace(id);
  expect(restored.mapRevision).not.toBe(original.mapRevision);
  expect(restored.desks).toEqual({ 'desk-1': ownerId });
  const invalid = structuredClone(edited);
  invalid.layers.find((l: any) => l.name === 'collision').data = [];
  await expect(store.importMap(id, invalid)).rejects.toThrow();
  expect((await store.workspace(id)).mapRevision).toBe(restored.mapRevision);
  const removed = structuredClone(edited);
  const zones = removed.layers.find((l: any) => l.name === 'zones');
  zones.objects = zones.objects.filter(
    (o: any) => !o.properties.some((p: any) => p.name === 'zoneId' && p.value === 'desk-1'),
  );
  await store.importMap(id, removed);
  expect((await store.workspace(id)).desks).toEqual({});
  const members = await store.members(id);
  members[0].x = -10;
  const world = new World(restored, members, store);
  await world.flush();
  expect(world.members.get(members[0].id)!.x).toBe(world.map.spawn.x);
});

it('serves authoritative changes to 30 concurrent authenticated players', async () => {
  const tokens: string[] = [];
  for (let i = 0; i < 30; i++) {
    const link = await store.invite(id, `load-${i}@example.test`, `Player ${i}`, raw);
    tokens.push((await store.redeem(link))!);
  }
  office.world.updateMembers(await store.members(id), await store.desks(id));
  const clients = tokens.map((token) => connect(`office_session=${token}`));
  try {
    const welcomes = await Promise.all(clients.map((c) => c.next((m) => m.type === 'welcome')));
    expect(office.world.connections.size).toBe(30);
    for (let seq = 1; seq <= 4; seq++) {
      for (const client of clients)
        client.socket.send(JSON.stringify({ type: 'input', seq, heading: 'right' }));
      await Promise.all(clients.map((c) => c.next((m) => m.type === 'delta' && m.ack === seq)));
    }
    const deltas = await Promise.all(
      clients.map((c) => c.next((m) => m.type === 'delta' && m.ack === 4)),
    );
    for (let i = 0; i < clients.length; i++) {
      const welcome = welcomes[i],
        delta = deltas[i];
      if (welcome.type !== 'welcome' || delta.type !== 'delta')
        throw new Error('Unexpected protocol');
      const start = welcome.players.find((p) => p.id === welcome.selfId)!;
      expect(office.world.connections.get(start.id)!.player.x).toBe(start.x + 32);
      expect(delta.changedPlayers.length).toBeGreaterThan(1);
    }
  } finally {
    await Promise.all(
      clients.map(
        (c) =>
          new Promise<void>((resolve) => {
            c.socket.once('close', () => resolve());
            c.socket.close();
          }),
      ),
    );
  }
});

it('rejects unauthenticated/cross-origin socket upgrades and revokes a live socket on logout', async () => {
  const address = office.app.server.address() as { port: number };
  const rejected = (cookie: string, requestOrigin: string) =>
    new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        origin: requestOrigin,
        headers: { cookie },
      });
      ws.on('error', reject);
      ws.on('unexpected-response', (request, response) => {
        resolve(response.statusCode!);
        response.resume();
        request.destroy();
      });
    });
  expect(await rejected('', origin)).toBe(401);
  expect(await rejected(ownerCookie, 'http://attacker.test')).toBe(403);
  const token = (await store.redeem(
    await store.invite(id, 'logout@example.test', 'Logout test', raw),
  ))!;
  office.world.updateMembers(await store.members(id), await store.desks(id));
  const cookie = `office_session=${token}`,
    client = connect(cookie);
  await client.next((m) => m.type === 'welcome');
  const closed = new Promise<number>((resolve) =>
    client.socket.once('close', (code) => resolve(code)),
  );
  expect(
    (
      await office.app.inject({
        method: 'POST',
        url: '/api/logout',
        headers: headers(cookie),
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(await closed).toBe(4003);
  expect(await store.identity(token)).toBeNull();
});

it('authorizes workspace membership, not just a valid session', async () => {
  const other = randomUUID();
  await store.ensureWorkspace(other, raw);
  const token = await store.bootstrap(other, 'outsider@example.test', 'Outsider', raw);
  expect(
    (await office.app.inject({ url: '/api/session', headers: headers(`office_session=${token}`) }))
      .statusCode,
  ).toBe(401);
});

class FakeSfu implements MediaRoomService {
  rooms = new Map<string, ParticipantInfo[]>();
  removed: Array<{ room: string; identity: string }> = [];
  join(room: string, identity: string, permission: Partial<ParticipantPermission>) {
    this.rooms.set(room, [
      ...(this.rooms.get(room) ?? []),
      { identity, sid: `PA_${identity}`, name: '', permission } as ParticipantInfo,
    ]);
  }
  present(room: string, identity: string) {
    return (this.rooms.get(room) ?? []).some((p) => p.identity === identity);
  }
  async listRooms() {
    return [...this.rooms.keys()].map((name) => ({ name }) as LiveKitRoom);
  }
  async listParticipants(room: string) {
    return this.rooms.get(room) ?? [];
  }
  async removeParticipant(room: string, identity: string) {
    this.removed.push({ room, identity });
    this.rooms.set(
      room,
      (this.rooms.get(room) ?? []).filter((p) => p.identity !== identity),
    );
  }
  async updateParticipant(room: string, identity: string) {
    return this.rooms.get(room)!.find((p) => p.identity === identity)!;
  }
}

const grant = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).video;
const until = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
};

it('scopes media credentials to the authoritative zone and revokes them from the server', async () => {
  const sfu = new FakeSfu();
  const member = async (email: string, x: number, y: number) => {
    const token = (await store.redeem(await store.invite(id, email, email, raw)))!;
    const user = (await store.members(id)).find((m) => m.email === email)!;
    await store.savePositions(id, [{ id: user.id, x, y }]);
    return { id: user.id, cookie: `office_session=${token}` };
  };
  // Two people share Desk 7; a third sits in the Cedar meeting room.
  const alice = await member('media-alice@example.test', 800, 608);
  const bob = await member('media-bob@example.test', 832, 608);
  const cara = await member('media-cara@example.test', 144, 104);
  const desk = `workspace-${id}-zone-desk-7`;

  const media = await createApp(store, {
    workspaceId: id,
    origin,
    bootstrapSecret: 'media-test',
    logger: false,
    livekit: {
      apiUrl: 'http://livekit.test',
      wsUrl: 'wss://livekit.test',
      apiKey: 'devkey',
      apiSecret: 'devsecret-devsecret-devsecret',
    },
    mediaService: sfu,
  });
  await media.app.listen({ port: 0, host: '127.0.0.1' });
  const address = media.app.server.address() as { port: number };
  const sockets = [alice, bob, cara].map(
    (person) =>
      new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        origin,
        headers: { cookie: person.cookie },
      }),
  );
  const token = async (person: { cookie: string }) =>
    (await media.app.inject({ url: '/api/media/token', headers: headers(person.cookie) })).json();
  const status = (person: { cookie: string }, value: Status) =>
    media.app.inject({
      method: 'PATCH',
      url: '/api/status',
      headers: headers(person.cookie),
      payload: { status: value },
    });

  try {
    await Promise.all(sockets.map((s) => new Promise((r) => s.once('open', r))));
    await until(
      () => media.world.connections.get(alice.id)?.player.zoneId === 'desk-7',
      'Players never reached their zones',
    );
    expect(media.world.connections.get(cara.id)!.player.zoneId).toBe('cedar');

    // A credential names exactly one zone room and carries only allowed sources.
    const free = await token(alice);
    expect(free).toMatchObject({ enabled: true, url: 'wss://livekit.test', room: desk });
    expect(grant(free.token)).toMatchObject({
      room: desk,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: ['microphone', 'camera', 'screen_share'],
    });
    // Conversations are isolated: another zone is a different room entirely.
    expect((await token(cara)).room).toBe(`workspace-${id}-zone-cedar`);

    // An SFU permission wider than policy is revoked even in the right zone:
    // LiveKit reads an empty source list as "may publish anything".
    sfu.join(desk, alice.id, { canPublish: true, canSubscribe: true, canPublishSources: [] });
    await until(() => !sfu.present(desk, alice.id), 'An over-broad grant was left in place');

    const inZone = {
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE],
    };
    sfu.join(desk, alice.id, inZone);
    sfu.join(desk, bob.id, inZone);

    // Focus stays in the conversation with full receive and optional publish
    // permissions. The client, rather than a weaker credential, defaults its
    // local microphone and camera to off.
    await status(bob, 'focus');
    const focused = await token(bob);
    expect(grant(focused.token)).toMatchObject({
      room: desk,
      canPublish: true,
      canSubscribe: true,
      canPublishSources: ['microphone', 'camera', 'screen_share'],
    });

    // DND is excluded from media entirely: removed from the room and refused a
    // new credential while standing in the same zone.
    await status(bob, 'do-not-disturb');
    await until(() => !sfu.present(desk, bob.id), 'DND did not revoke SFU access');
    expect(media.world.connections.get(bob.id)!.player.zoneId).toBe('desk-7');
    expect(await token(bob)).toMatchObject({ enabled: false });
    expect((await store.members(id)).find((m) => m.id === bob.id)!.status).toBe('do-not-disturb');

    // Walking onto the open floor ends the conversation.
    for (let seq = 1; seq <= 3; seq++)
      sockets[0].send(JSON.stringify({ type: 'input', seq, heading: 'up' }));
    await until(
      () => media.world.connections.get(alice.id)?.player.zoneId === null,
      'Alice never left the desk zone',
    );
    await until(() => !sfu.present(desk, alice.id), 'Leaving the zone did not revoke SFU access');
    expect(await token(alice)).toMatchObject({ enabled: false });
    expect(sfu.removed.map((entry) => entry.identity)).toEqual([alice.id, bob.id, alice.id]);
  } finally {
    for (const socket of sockets) socket.close();
    await media.app.close();
  }
});

it('persists a mixed wardrobe and broadcasts it to connected players, rejecting invalid selections', async () => {
  const peer = connect(ownerCookie);
  await peer.next((m) => m.type === 'welcome');
  const appearance = {
    ...presetAppearance(3),
    head: 2,
    skin: 5,
    hair: 8,
    shirt: 1,
    pants: 3,
    shoes: 3,
  };
  const payload = { displayName: 'Alice', character: 3, appearance };
  expect(
    (await office.app.inject({ method: 'PATCH', url: '/api/profile', headers: headers(), payload }))
      .statusCode,
  ).toBe(200);
  const update = await peer.next(
    (m) =>
      m.type === 'delta' &&
      m.changedPlayers.some((p) => p.id === ownerId && p.appearance?.head === 2),
  );
  expect(
    update.type === 'delta' && update.changedPlayers.find((p) => p.id === ownerId)?.appearance,
  ).toEqual(appearance);
  expect((await store.members(id)).find((m) => m.id === ownerId)?.appearance).toEqual(appearance);
  const restored = new World(await store.workspace(id), await store.members(id), store);
  expect(restored.members.get(ownerId)?.appearance).toEqual(appearance);
  const session = await office.app.inject({ url: '/api/session', headers: headers() });
  expect(session.json().user.appearance).toEqual(appearance);
  for (const invalid of [{ ...appearance, skin: 6 }, { ...appearance, head: -1 }, { head: 0 }]) {
    expect(
      (
        await office.app.inject({
          method: 'PATCH',
          url: '/api/profile',
          headers: headers(),
          payload: { ...payload, appearance: invalid },
        })
      ).statusCode,
    ).toBe(400);
  }
  expect((await store.members(id)).find((m) => m.id === ownerId)?.appearance).toEqual(appearance);
  peer.socket.close();
});

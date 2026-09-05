import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  canStand,
  move,
  parseMap,
  zoneAt,
  clientMessageSchema,
  SPEED,
  TICK_HZ,
  type ServerMessage,
  type Workspace,
} from '@office/shared';
import { World, type Peer } from '../../apps/server/src/world/tick';
import type { SavedMember } from '../../apps/server/src/persistence/store';

const raw = () => JSON.parse(readFileSync('maps/office.tmj', 'utf8'));
const map = parseMap(raw());
const member: SavedMember = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'a@example.test',
  displayName: 'Alice',
  character: 0,
  role: 'owner',
  x: map.spawn.x,
  y: map.spawn.y,
  status: 'free',
};
const workspace: Workspace = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Office',
  mapRevision: 'test',
  map: map.tiled,
  desks: {},
};
function fixture() {
  const savePositions = vi.fn().mockResolvedValue(undefined);
  const world = new World(workspace, [member], { savePositions });
  const messages: ServerMessage[] = [];
  const peer: Peer = { send: (m) => messages.push(structuredClone(m)), close: vi.fn() };
  world.attach(member.id, peer, Date.now() + 100000, 'session');
  return { world, peer, messages, savePositions };
}

describe('map and zones', () => {
  it('uses half-open foot-center boundaries, not avatar overlap', () => {
    const zone = map.zones.find((z) => z.id === 'desk-1')!;
    expect(zoneAt(map, zone.x, zone.y)).toBe('desk-1');
    expect(zoneAt(map, zone.x + zone.width - 0.01, zone.y)).toBe('desk-1');
    expect(zoneAt(map, zone.x + zone.width, zone.y)).toBeNull();
    expect(zoneAt(map, zone.x, zone.y + zone.height)).toBeNull();
    expect(zoneAt(map, zone.x - 0.01, zone.y)).toBeNull();
    expect(zoneAt(map, map.spawn.x, map.spawn.y)).toBeNull();
  });
  it('computes meeting membership from the map', () => {
    const room = map.zones.find((z) => z.kind === 'meeting')!;
    expect(zoneAt(map, room.x + 16, room.y + 64)).toBe(room.id);
  });
  it('rejects overlapping call zones, duplicate IDs and unsupported geometry', () => {
    for (const mutate of [
      (z: any[]) => {
        z[1].x = z[0].x;
        z[1].y = z[0].y;
      },
      (z: any[]) => {
        z[1].properties[0].value = z[0].properties[0].value;
      },
      (z: any[]) => {
        z[0].rotation = 45;
      },
      (z: any[]) => {
        z[0].ellipse = true;
      },
    ]) {
      const data = raw();
      mutate(data.layers.find((l: any) => l.name === 'zones').objects);
      expect(() => parseMap(data)).toThrow();
    }
  });
  it('allows open-floor coverage but prioritizes desk and meeting zones', () => {
    const data = raw(),
      zones = data.layers.find((l: any) => l.name === 'zones').objects;
    zones.unshift({
      id: 80,
      name: 'Floor',
      x: 0,
      y: 0,
      width: 1280,
      height: 896,
      properties: [
        { name: 'zoneId', value: 'open' },
        { name: 'kind', value: 'open' },
      ],
    });
    const parsed = parseMap(data);
    expect(zoneAt(parsed, map.spawn.x, map.spawn.y)).toBe('open');
    expect(zoneAt(parsed, 100, 100)).toBe('cedar');
  });
  it('rejects bad collision dimensions, offsets and external tilesets', () => {
    const data = raw();
    data.layers[2].data.pop();
    expect(() => parseMap(data)).toThrow();
    const offset = raw();
    offset.layers[0].offsetx = 4;
    expect(() => parseMap(offset)).toThrow();
    const external = raw();
    external.tilesets = [{ firstgid: 1, source: 'office.tsx' }];
    expect(() => parseMap(external)).toThrow();
  });
});

describe('movement authority', () => {
  it('moves one fixed cardinal step and never accepts client coordinates or durations', () => {
    const initial = { ...map.spawn, direction: 'down' as const, moving: false };
    const next = move(map, initial, 'right');
    expect(next.x - initial.x).toBe(SPEED / TICK_HZ);
    expect(next.y).toBe(initial.y);
    for (const extra of [{ x: 900 }, { dt: 10 }, { direction: 'diagonal' }, { seq: -1 }])
      expect(
        clientMessageSchema.safeParse({ type: 'input', seq: 1, direction: 'up', ...extra }).success,
      ).toBe(false);
  });
  it('collides with walls without tunneling and rejects out-of-bounds positions', () => {
    let state = { x: 48, y: 560, direction: 'left' as const, moving: false };
    for (let i = 0; i < 100; i++) state = move(map, state, 'left') as typeof state;
    expect(state.x).toBeGreaterThanOrEqual(39);
    expect(state.x).toBeLessThanOrEqual(40);
    expect(canStand(map, state.x, state.y)).toBe(true);
    expect(canStand(map, 32, 400)).toBe(false);
    expect(canStand(map, -100, 400)).toBe(false);
    expect(canStand(map, Infinity, 400)).toBe(false);
  });
  it('coalesces bursts into one step without latency backlog; idle stops movement', () => {
    const { world, peer, messages } = fixture();
    for (let seq = 1; seq <= 5; seq++)
      world.input(member.id, peer, { type: 'input', seq, direction: 'right' });
    world.tick();
    expect(world.connections.get(member.id)!.player.x).toBe(member.x + 8);
    expect(messages.at(-1)).toMatchObject({ type: 'delta', ack: 5 });
    for (let i = 0; i < 5; i++) world.tick();
    expect(world.connections.get(member.id)!.player).toMatchObject({
      x: member.x + 8,
      moving: false,
    });
  });
  it('bounds queues and rejects replayed or skipped sequence numbers', () => {
    for (const sequence of [[2], [1, 1], Array.from({ length: 9 }, (_, i) => i + 1)]) {
      const { world, peer } = fixture();
      for (const seq of sequence)
        world.input(member.id, peer, { type: 'input', seq, direction: 'right' });
      expect(peer.close).toHaveBeenCalledWith(4002, expect.any(String));
      expect(world.connections.size).toBe(0);
    }
  });
  it('computes zones only after resolving movement', () => {
    const { world, peer } = fixture();
    const c = world.connections.get(member.id)!;
    c.player.x = 98;
    c.player.y = 412;
    world.input(member.id, peer, { type: 'input', seq: 1, direction: 'down' });
    world.tick();
    expect(c.player.zoneId).toBe('desk-1');
  });
  it('replaces a session without the old disconnect removing the new player', () => {
    const { world, peer } = fixture(),
      replacement: Peer = { send: vi.fn(), close: vi.fn() };
    world.attach(member.id, replacement, Date.now() + 10000, 'new');
    world.detach(member.id, peer);
    expect(peer.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect(world.connections.get(member.id)!.peer).toBe(replacement);
    world.revokeSession('session');
    expect(world.connections.size).toBe(1);
    world.revokeSession('new');
    expect(world.connections.size).toBe(0);
  });
  it('includes the latest member directory in reconnect snapshots', () => {
    const { world, peer } = fixture();
    world.detach(member.id, peer);
    world.updateMembers([member, { ...member, id: 'bob', displayName: 'Bob' }], {});
    const send = vi.fn();
    world.attach(member.id, { send, close: vi.fn() }, Date.now() + 10000, 'new');
    expect(send.mock.calls[0][0].members.map((m: SavedMember) => m.displayName)).toEqual([
      'Alice',
      'Bob',
    ]);
  });
  it('keeps members when empty and repairs blocked restored positions', async () => {
    const savePositions = vi.fn().mockResolvedValue(undefined);
    const world = new World(workspace, [{ ...member, x: 0, y: 0, status: 'do-not-disturb' }], {
      savePositions,
    });
    expect(world.members.get(member.id)).toMatchObject({ ...map.spawn, status: 'do-not-disturb' });
    await world.flush();
    expect(savePositions).toHaveBeenCalled();
    expect(world.connections.size).toBe(0);
    expect(world.members.size).toBe(1);
  });
  it('expires live sessions server-side and emits removals', () => {
    const { world, messages } = fixture();
    world.tick(Date.now() + 200000);
    expect(world.connections.size).toBe(0);
    expect(messages[0].type).toBe('welcome');
  });
  it('broadcasts only changed player records', () => {
    const { world, messages } = fixture();
    world.tick();
    world.tick();
    expect(messages.at(-1)).toMatchObject({
      type: 'delta',
      changedPlayers: [],
      removedPlayerIds: [],
    });
  });
});

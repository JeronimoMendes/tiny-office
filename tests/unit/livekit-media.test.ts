import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TrackSource, type ParticipantInfo, type Room } from 'livekit-server-sdk';
import { LiveKitMedia, type MediaRoomService } from '../../apps/server/src/media/livekit';
import { World, type Peer } from '../../apps/server/src/world/tick';
import type { SavedMember } from '../../apps/server/src/persistence/store';
import type { ServerMessage, Workspace } from '@office/shared';

const raw = JSON.parse(readFileSync('maps/office.tmj', 'utf8'));
const workspace: Workspace = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Test',
  mapRevision: 'test',
  map: raw,
  desks: {},
};
const zoneRoom = (zoneId: string) => `workspace-${workspace.id}-zone-${zoneId}`;
const member = (id: string, status: SavedMember['status'] = 'free'): SavedMember => ({
  id,
  email: `${id}@example.test`,
  displayName: id,
  character: 0,
  role: 'member',
  status,
  x: 656,
  y: 656,
});
const peer: Peer = { send(_message: ServerMessage) {}, close() {} };

class FakeService implements MediaRoomService {
  rooms = new Map<string, ParticipantInfo[]>();
  listed = 0;
  removed: Array<{ room: string; identity: string }> = [];
  updated: Array<{ room: string; identity: string; options: any }> = [];
  async listRooms() {
    this.listed++;
    return [...this.rooms.keys()].map((name) => ({ name }) as Room);
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
  async updateParticipant(room: string, identity: string, options: any) {
    this.updated.push({ room, identity, options });
    return this.rooms.get(room)!.find((p) => p.identity === identity)!;
  }
}

const participant = (
  identity: string,
  canSubscribe: boolean,
  canPublishSources: TrackSource[] = [TrackSource.MICROPHONE, TrackSource.CAMERA],
) =>
  ({
    identity,
    sid: `PA_${identity}`,
    name: identity,
    permission: { canSubscribe, canPublish: true, canPublishData: false, canPublishSources },
  }) as ParticipantInfo;

function setup(statuses: SavedMember['status'][] = ['free', 'free', 'free']) {
  const members = ['alice', 'bob', 'cara'].map((id, index) => member(id, statuses[index]));
  const world = new World(workspace, members, { savePositions: async () => {} });
  for (const m of members) world.attach(m.id, peer, Date.now() + 60_000, m.id);
  const service = new FakeService();
  const media = new LiveKitMedia(
    world,
    { apiUrl: 'http://livekit', wsUrl: 'ws://livekit', apiKey: 'key', apiSecret: 'secret' },
    service,
  );
  const zone = (id: string, zoneId: string | null) =>
    (world.connections.get(id)!.player.zoneId = zoneId);
  const status = (id: string, next: SavedMember['status']) =>
    (world.connections.get(id)!.player.status = next);
  return { world, service, media, zone, status };
}

describe('LiveKit authoritative reconciliation', () => {
  it('issues one zone-scoped credential and refuses ineligible people', async () => {
    const { media, zone } = setup(['free', 'do-not-disturb', 'focus']);
    expect(await media.token('alice')).toMatchObject({ enabled: false });

    zone('alice', 'cedar');
    zone('bob', 'cedar');
    zone('cara', 'fern');
    expect(await media.token('alice')).toMatchObject({
      enabled: true,
      url: 'ws://livekit',
      room: zoneRoom('cedar'),
    });
    expect(await media.token('bob')).toMatchObject({ enabled: false });
    expect(await media.token('cara')).toMatchObject({ room: zoneRoom('fern') });
  });

  it('removes anyone whose authoritative zone left the room', async () => {
    const { service, media, zone } = setup();
    zone('alice', 'cedar');
    zone('bob', 'cedar');
    zone('cara', 'fern');
    service.rooms.set(zoneRoom('cedar'), [
      participant('alice', true),
      participant('bob', true),
      participant('cara', true),
    ]);
    await media.reconcile();
    expect(service.removed).toEqual([{ room: zoneRoom('cedar'), identity: 'cara' }]);

    zone('alice', null);
    await media.reconcile();
    expect(service.removed).toContainEqual({ room: zoneRoom('cedar'), identity: 'alice' });
  });

  it('disconnects a downgraded participant rather than leaving permissions behind', async () => {
    const { service, media, zone, status } = setup();
    zone('alice', 'cedar');
    zone('bob', 'cedar');
    service.rooms.set(zoneRoom('cedar'), [participant('alice', true), participant('bob', true)]);

    // Focus keeps the conversation but may no longer receive or use video.
    status('alice', 'focus');
    await media.reconcile();
    expect(service.removed).toEqual([{ room: zoneRoom('cedar'), identity: 'alice' }]);

    // DND is excluded from the room entirely.
    status('bob', 'do-not-disturb');
    await media.reconcile();
    expect(service.removed).toContainEqual({ room: zoneRoom('cedar'), identity: 'bob' });
  });

  it('grants a focused participant microphone-only permissions in place', async () => {
    const { service, media, zone } = setup(['focus', 'free', 'free']);
    zone('alice', 'cedar');
    service.rooms.set(zoneRoom('cedar'), [
      participant('alice', false, [TrackSource.MICROPHONE]),
      participant('bob', false, [TrackSource.MICROPHONE]),
    ]);
    zone('bob', 'cedar');
    await media.reconcile();

    expect(service.removed).toEqual([]);
    expect(service.updated).toEqual([
      {
        room: zoneRoom('cedar'),
        identity: 'bob',
        options: {
          name: 'bob',
          permission: {
            canSubscribe: true,
            canPublish: true,
            canPublishData: false,
            canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
          },
        },
      },
    ]);
  });

  it('calls the SFU only while a conversation can exist', async () => {
    const { service, media, zone } = setup();
    await media.reconcile();
    expect(service.listed).toBe(0);

    zone('alice', 'cedar');
    service.rooms.set(zoneRoom('cedar'), [participant('alice', true)]);
    await media.reconcile();
    expect(service.listed).toBe(1);

    // A stale participant keeps reconciliation awake until the room drains.
    zone('alice', null);
    await media.reconcile();
    expect(service.listed).toBe(2);
    expect(service.removed).toEqual([{ room: zoneRoom('cedar'), identity: 'alice' }]);
    await media.reconcile();
    expect(service.listed).toBe(3);
    await media.reconcile();
    expect(service.listed).toBe(3);
  });
});

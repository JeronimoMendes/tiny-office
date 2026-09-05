import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  type ParticipantInfo,
  type ParticipantPermission,
  type Room as LiveKitRoom,
} from 'livekit-server-sdk';
import type { World } from '../world/tick';
import { conversationRoom, mediaPolicy, roomPrefix } from './policy';

export type MediaTokenResult =
  { enabled: false; reason: string } | { enabled: true; url: string; token: string; room: string };

type ParticipantUpdate = {
  name?: string;
  permission?: Partial<ParticipantPermission>;
};
export interface MediaRoomService {
  listRooms(names?: string[]): Promise<LiveKitRoom[]>;
  listParticipants(room: string): Promise<ParticipantInfo[]>;
  removeParticipant(room: string, identity: string): Promise<void>;
  updateParticipant(
    room: string,
    identity: string,
    options: ParticipantUpdate,
  ): Promise<ParticipantInfo>;
}

const sources = (policy: ReturnType<typeof mediaPolicy>) => [
  ...(policy.canPublishMicrophone ? [TrackSource.MICROPHONE] : []),
  ...(policy.canPublishCamera ? [TrackSource.CAMERA] : []),
];

export class LiveKitMedia {
  readonly enabled: boolean;
  private readonly prefix: string;
  private readonly service: MediaRoomService | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queued = false;
  private reconciling = false;
  private reconcileAgain = false;
  private occupied = false;

  constructor(
    private readonly world: World,
    private readonly config: {
      apiUrl?: string;
      wsUrl?: string;
      apiKey?: string;
      apiSecret?: string;
    },
    service?: MediaRoomService,
  ) {
    this.enabled = !!(config.apiUrl && config.wsUrl && config.apiKey && config.apiSecret);
    this.prefix = roomPrefix(world.workspace.id);
    this.service = this.enabled
      ? (service ?? new RoomServiceClient(config.apiUrl!, config.apiKey!, config.apiSecret!))
      : null;
  }

  start() {
    if (!this.enabled) return;
    // Safety net behind the movement/status events that normally drive
    // reconciliation; it makes no API calls while no conversation exists.
    this.timer = setInterval(() => this.schedule(), 2000);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  schedule = () => {
    if (!this.enabled) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      void this.reconcile().catch((error) => console.error('LiveKit reconciliation failed', error));
    });
  };

  async token(userId: string): Promise<MediaTokenResult> {
    if (!this.enabled) return { enabled: false, reason: 'Media is not configured' };
    const player = this.world.connections.get(userId)?.player;
    if (!player) return { enabled: false, reason: 'Join the office first' };
    const room = conversationRoom(this.world.workspace.id, player);
    if (!room)
      return {
        enabled: false,
        reason:
          player.status === 'do-not-disturb'
            ? 'Media is disabled while in DND'
            : 'Open floor is a quiet space',
      };
    const policy = mediaPolicy(player);
    const token = new AccessToken(this.config.apiKey!, this.config.apiSecret!, {
      identity: userId,
      name: player.displayName,
      ttl: '2m',
    });
    token.addGrant({
      room,
      roomJoin: true,
      canSubscribe: policy.canReceive,
      canPublish: true,
      canPublishData: false,
      canPublishSources: sources(policy),
    });
    return { enabled: true, url: this.config.wsUrl!, token: await token.toJwt(), room };
  }

  /** Reconcile SFU membership and permissions from the authoritative world. */
  async reconcile() {
    if (!this.service) return;
    if (this.reconciling) {
      this.reconcileAgain = true;
      return;
    }
    this.reconciling = true;
    try {
      const players = new Map(
        [...this.world.connections].map(([id, connection]) => [id, connection.player]),
      );
      const wanted = [...players.values()].some((player) => mediaPolicy(player).eligible);
      if (!wanted && !this.occupied) return;
      const rooms = (await this.service.listRooms()).filter((room) =>
        room.name.startsWith(this.prefix),
      );
      this.occupied = false;
      for (const room of rooms) {
        const participants = await this.service.listParticipants(room.name);
        this.occupied ||= participants.length > 0;
        for (const participant of participants) {
          const player = players.get(participant.identity);
          if (!player || conversationRoom(this.world.workspace.id, player) !== room.name) {
            await this.service.removeParticipant(room.name, participant.identity);
            continue;
          }
          const policy = mediaPolicy(player);
          const granted = participant.permission;
          const allowed = sources(policy);
          const grantedSources = granted?.canPublishSources ?? [];
          // Anything the SFU grants beyond current policy is revoked by
          // disconnecting; a downgraded permission must never linger.
          const excess =
            !!granted &&
            ((granted.canSubscribe && !policy.canReceive) ||
              granted.canPublishData ||
              grantedSources.some((source) => !allowed.includes(source)) ||
              grantedSources.length === 0);
          if (excess) {
            await this.service.removeParticipant(room.name, participant.identity);
            continue;
          }
          const stale =
            participant.name !== player.displayName ||
            !granted ||
            granted.canSubscribe !== policy.canReceive ||
            !granted.canPublish ||
            allowed.some((source) => !grantedSources.includes(source));
          if (stale)
            await this.service.updateParticipant(room.name, participant.identity, {
              name: player.displayName,
              permission: {
                canSubscribe: policy.canReceive,
                canPublish: true,
                canPublishData: false,
                canPublishSources: allowed,
              },
            });
        }
      }
    } finally {
      this.reconciling = false;
      if (this.reconcileAgain) {
        this.reconcileAgain = false;
        this.schedule();
      }
    }
  }
}

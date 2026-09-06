import {
  move,
  canStand,
  parseMap,
  zoneAt,
  PROTOCOL_VERSION,
  type Input,
  type Player,
  type ServerMessage,
  type Workspace,
} from '@office/shared';
import type { SavedMember, Store } from '../persistence/store';
import { PositionWriter } from '../persistence/position-writer';

export interface Peer {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}
type Connection = {
  peer: Peer;
  player: Player;
  inputs: Input[];
  receivedSeq: number;
  ack: number;
  expiresAt: number;
  sessionHash: string;
};

export class World {
  readonly map;
  readonly members = new Map<string, SavedMember>();
  readonly connections = new Map<string, Connection>();
  private changed = new Set<string>();
  private removed = new Set<string>();
  private writer: PositionWriter;
  private mediaPolicyChanged: (() => void) | null = null;
  tickNumber = 0;

  constructor(
    readonly workspace: Workspace,
    members: SavedMember[],
    store: Pick<Store, 'savePositions'>,
  ) {
    this.map = parseMap(workspace.map);
    if (!canStand(this.map, this.map.spawn.x, this.map.spawn.y))
      throw new Error('Spawn is blocked');
    this.writer = new PositionWriter(store, workspace.id);
    for (const member of members) this.restoreMember(member);
  }
  setMediaPolicyChangeHandler(handler: () => void) {
    this.mediaPolicyChanged = handler;
  }
  private restoreMember(member: SavedMember) {
    const restored = { ...member };
    if (!canStand(this.map, member.x, member.y)) {
      Object.assign(restored, this.map.spawn);
      this.writer.mark(restored);
    }
    this.members.set(restored.id, restored);
  }
  attach(userId: string, peer: Peer, expiresAt: number, sessionHash: string) {
    const member = this.members.get(userId);
    if (!member) throw new Error('Not a workspace member');
    const old = this.connections.get(userId);
    const player: Player = old
      ? { ...old.player }
      : {
          id: member.id,
          displayName: member.displayName,
          character: member.character,
          appearance: member.appearance,
          status: member.status,
          x: member.x,
          y: member.y,
          direction: 'down',
          moving: false,
          zoneId: zoneAt(this.map, member.x, member.y),
        };
    this.connections.set(userId, {
      peer,
      player,
      inputs: [],
      receivedSeq: 0,
      ack: 0,
      expiresAt,
      sessionHash,
    });
    old?.peer.close(4001, 'Opened in another tab or device');
    this.removed.delete(userId);
    this.changed.add(userId);
    this.mediaPolicyChanged?.();
    peer.send({
      type: 'welcome',
      version: PROTOCOL_VERSION,
      selfId: userId,
      tick: this.tickNumber,
      players: [...this.connections.values()].map((c) => c.player),
      members: [...this.members.values()].map(({ x, y, ...m }) => m),
      workspace: this.workspace,
    });
  }
  input(userId: string, peer: Peer, input: Input) {
    const c = this.connections.get(userId);
    if (!c || c.peer !== peer) return;
    if (input.seq !== c.receivedSeq + 1 || c.inputs.length >= 8) {
      peer.close(4002, 'Invalid input sequence or excessive queued inputs');
      this.detach(userId, peer);
      return;
    }
    c.receivedSeq = input.seq;
    c.inputs.push(input);
  }
  detach(userId: string, peer: Peer) {
    const c = this.connections.get(userId);
    if (!c || c.peer !== peer) return;
    this.writer.mark(c.player);
    this.connections.delete(userId);
    this.changed.delete(userId);
    this.removed.add(userId);
    this.mediaPolicyChanged?.();
  }
  revokeSession(hash: string) {
    for (const [id, c] of this.connections)
      if (c.sessionHash === hash) {
        c.peer.close(4003, 'Signed out');
        this.detach(id, c.peer);
      }
  }
  updateMembers(members: SavedMember[], desks: Workspace['desks']) {
    for (const member of members) {
      const existing = this.members.get(member.id);
      this.restoreMember(existing ? { ...member, x: existing.x, y: existing.y } : member);
      const c = this.connections.get(member.id);
      if (c) {
        Object.assign(c.player, {
          displayName: member.displayName,
          character: member.character,
          appearance: member.appearance,
          status: member.status,
        });
        this.changed.add(member.id);
        if (c.player.status !== existing?.status) this.mediaPolicyChanged?.();
      }
    }
    this.workspace.desks = desks;
    const message: ServerMessage = {
      type: 'members',
      members: members.map(({ x, y, ...member }) => member),
      desks,
    };
    for (const c of this.connections.values()) c.peer.send(message);
  }

  // Keep the complete authoritative simulation here. Inputs buy at most one
  // fixed movement step per server tick; neither sequence nor arrival rate buys time.
  tick(now = Date.now()) {
    this.tickNumber++;
    for (const [id, c] of this.connections) {
      if (c.expiresAt <= now) {
        c.peer.close(4003, 'Session expired');
        this.detach(id, c.peer);
        continue;
      }
      // Coalesce obsolete samples instead of building up latency when client
      // and server clocks drift. Only the newest heading buys one step.
      const input = c.inputs.at(-1);
      c.inputs.length = 0;
      const previous = c.player;
      const motion = move(this.map, previous, input?.heading ?? null);
      const zoneId = zoneAt(this.map, motion.x, motion.y);
      if (input) c.ack = input.seq;
      if (
        motion.x !== previous.x ||
        motion.y !== previous.y ||
        motion.direction !== previous.direction ||
        motion.moving !== previous.moving ||
        zoneId !== previous.zoneId
      ) {
        c.player = { ...previous, ...motion, zoneId };
        if (zoneId !== previous.zoneId) this.mediaPolicyChanged?.();
        this.changed.add(id);
        const member = this.members.get(id)!;
        member.x = motion.x;
        member.y = motion.y;
        this.writer.mark(c.player);
      }
    }
    const changedPlayers = [...this.changed].flatMap((id) => {
      const c = this.connections.get(id);
      return c ? [{ ...c.player }] : [];
    });
    const removedPlayerIds = [...this.removed];
    // Future interest management belongs here: filter these changes by each
    // recipient's map region and send snapshots when a player enters interest.
    for (const c of this.connections.values()) {
      c.peer.send({
        type: 'delta',
        tick: this.tickNumber,
        ack: c.ack,
        changedPlayers,
        removedPlayerIds,
      });
    }
    this.changed.clear();
    this.removed.clear();
  }
  flush() {
    return this.writer.flush();
  }
}

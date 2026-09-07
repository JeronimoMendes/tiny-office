import {
  move,
  canStand,
  parseMap,
  zoneAt,
  PROTOCOL_VERSION,
  type Input,
  type Player,
  type ServerMessage,
  type WhiteboardChanges,
  type WhiteboardPresence,
  type WhiteboardRecord,
  type Workspace,
} from '@office/shared';
import type { SavedMember, Store } from '../persistence/store';
import { PositionWriter } from '../persistence/position-writer';

export interface Peer {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}
type Whiteboard = {
  records: Map<string, WhiteboardRecord>;
  presences: Map<string, WhiteboardPresence>;
  editors: Set<string>;
};

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
  map;
  readonly members = new Map<string, SavedMember>();
  readonly connections = new Map<string, Connection>();
  private changed = new Set<string>();
  private removed = new Set<string>();
  private writer: PositionWriter;
  private mediaPolicyChanged: (() => void) | null = null;
  private whiteboards = new Map<string, Whiteboard>();
  tickNumber = 0;

  constructor(
    public workspace: Workspace,
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
    if (player.zoneId) this.sendWhiteboardState(peer, player.zoneId);
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
  openWhiteboard(userId: string, peer: Peer, zoneId: string) {
    const c = this.connections.get(userId);
    const zone = this.map.zones.find((candidate) => candidate.id === zoneId);
    const boardIsActive = this.whiteboards.has(zoneId);
    const nearBoard =
      c && zone && Math.hypot(c.player.x - (zone.x + zone.width / 2), c.player.y - zone.y) < 105;
    if (
      !c ||
      c.peer !== peer ||
      c.player.zoneId !== zoneId ||
      zone?.kind !== 'meeting' ||
      (!boardIsActive && !nearBoard)
    ) {
      peer.send({
        type: 'error',
        code: 'whiteboard-unavailable',
        message: 'Move closer to the meeting room whiteboard.',
      });
      return;
    }
    let board = this.whiteboards.get(zoneId);
    if (!board) {
      board = { records: new Map(), presences: new Map(), editors: new Set() };
      this.whiteboards.set(zoneId, board);
    }
    board.editors.add(userId);
    this.broadcastWhiteboard(zoneId, {
      type: 'whiteboard-state',
      board: {
        zoneId,
        records: [...board.records.values()],
        presences: [...board.presences.values()],
        editorIds: [...board.editors],
      },
    });
  }
  updateWhiteboard(userId: string, peer: Peer, zoneId: string, changes: WhiteboardChanges) {
    const c = this.connections.get(userId);
    const board = this.whiteboards.get(zoneId);
    if (!c || c.peer !== peer || c.player.zoneId !== zoneId || !board?.editors.has(userId)) return;
    for (const record of changes.put) board.records.set(record.id, record);
    for (const id of changes.remove) board.records.delete(id);
    if (board.records.size > 10_000) {
      peer.close(4002, 'Whiteboard is too large');
      this.detach(userId, peer);
      return;
    }
    this.broadcastWhiteboard(zoneId, { type: 'whiteboard-changes', zoneId, changes }, userId);
  }
  updateWhiteboardPresence(
    userId: string,
    peer: Peer,
    zoneId: string,
    presence: WhiteboardPresence,
  ) {
    const c = this.connections.get(userId);
    const board = this.whiteboards.get(zoneId);
    if (
      !c ||
      c.peer !== peer ||
      c.player.zoneId !== zoneId ||
      !board?.editors.has(userId) ||
      presence.userId !== `user:${userId}` ||
      presence.id !== `instance_presence:${userId}`
    )
      return;
    board.presences.set(userId, presence);
    this.broadcastWhiteboard(
      zoneId,
      { type: 'whiteboard-presence', zoneId, userId, presence },
      userId,
    );
  }
  closeWhiteboard(userId: string, peer: Peer, zoneId: string) {
    const c = this.connections.get(userId);
    if (!c || c.peer !== peer) return;
    this.leaveWhiteboard(userId, zoneId);
  }
  private leaveWhiteboard(userId: string, zoneId: string) {
    const board = this.whiteboards.get(zoneId);
    if (!board?.editors.delete(userId)) return;
    if (board.presences.delete(userId))
      this.broadcastWhiteboard(zoneId, {
        type: 'whiteboard-presence',
        zoneId,
        userId,
        presence: null,
      });
    if (!board.editors.size) {
      this.whiteboards.delete(zoneId);
      this.broadcastWhiteboard(zoneId, { type: 'whiteboard-ended', zoneId });
      return;
    }
    this.broadcastWhiteboard(zoneId, {
      type: 'whiteboard-editors',
      zoneId,
      editorIds: [...board.editors],
    });
  }
  private sendWhiteboardState(peer: Peer, zoneId: string) {
    const board = this.whiteboards.get(zoneId);
    if (!board) {
      peer.send({ type: 'whiteboard-ended', zoneId });
      return;
    }
    peer.send({
      type: 'whiteboard-state',
      board: {
        zoneId,
        records: [...board.records.values()],
        presences: [...board.presences.values()],
        editorIds: [...board.editors],
      },
    });
  }
  private broadcastWhiteboard(zoneId: string, message: ServerMessage, exceptId?: string) {
    for (const [id, c] of this.connections)
      if (id !== exceptId && c.player.zoneId === zoneId) c.peer.send(message);
  }
  detach(userId: string, peer: Peer) {
    const c = this.connections.get(userId);
    if (!c || c.peer !== peer) return;
    this.writer.mark(c.player);
    if (c.player.zoneId) this.leaveWhiteboard(userId, c.player.zoneId);
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
  applyWorkspaceMap(workspace: Workspace) {
    const map = parseMap(workspace.map);
    if (!canStand(map, map.spawn.x, map.spawn.y)) throw new Error('Spawn is blocked');
    this.workspace = workspace;
    this.map = map;
    this.whiteboards.clear();
    for (const [id, member] of this.members) {
      const connection = this.connections.get(id);
      const position = connection?.player ?? member;
      const next = canStand(map, position.x, position.y)
        ? { x: position.x, y: position.y }
        : map.spawn;
      member.x = next.x;
      member.y = next.y;
      this.writer.mark(member);
      if (connection) {
        Object.assign(connection.player, next, {
          zoneId: zoneAt(map, next.x, next.y),
          moving: false,
        });
        // Reconnecting supplies an atomic map + player snapshot and clears any
        // prediction queued against the old collision grid.
        connection.peer.close(4010, 'Workspace map updated');
        this.detach(id, connection.peer);
      }
    }
    this.mediaPolicyChanged?.();
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
        if (zoneId !== previous.zoneId && previous.zoneId)
          this.leaveWhiteboard(id, previous.zoneId);
        c.player = { ...previous, ...motion, zoneId };
        if (zoneId !== previous.zoneId) {
          this.mediaPolicyChanged?.();
          if (zoneId) this.sendWhiteboardState(c.peer, zoneId);
        }
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

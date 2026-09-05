import {
  move,
  parseMap,
  PROTOCOL_VERSION,
  STEP_MS,
  type Heading,
  type Input,
  type Player,
  type ServerMessage,
  type SessionInfo,
} from '@office/shared';
import type { RendererBridge, RenderSnapshot } from './bridge';

export type SessionView = SessionInfo & {
  connection: 'connecting' | 'online' | 'reconnecting' | 'closed';
  connectionMessage: string;
  players: Player[];
};

export class OfficeSession {
  private view: SessionView;
  private listeners = new Set<() => void>();
  private renderListeners = new Set<(snapshot: RenderSnapshot) => void>();
  private lastRender: RenderSnapshot | null = null;
  private socket: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private retry = 0;
  private seq = 0;
  private pending: Input[] = [];
  private heading: Heading | null = null;
  private predicted: Player | null = null;
  private tick = 0;
  private receivedAt = 0;
  private map;
  readonly renderer: RendererBridge = {
    subscribe: (listener) => {
      this.renderListeners.add(listener);
      if (this.lastRender) listener(structuredClone(this.lastRender));
      return () => {
        this.renderListeners.delete(listener);
      };
    },
    setHeading: (heading) => {
      this.heading = heading;
    },
  };
  constructor(info: SessionInfo) {
    this.view = {
      ...info,
      connection: 'connecting',
      connectionMessage: 'Connecting to the office…',
      players: [],
    };
    this.map = parseMap(info.workspace.map);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private update(patch: Partial<SessionView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  start() {
    this.stopped = false;
    this.connect();
    this.interval = setInterval(() => this.predict(), STEP_MS);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.clearInput);
  }
  private clearInput = () => {
    this.heading = null;
  };
  stop() {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = null;
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.clearInput);
  }
  private connect() {
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.socket) return;
      try {
        this.receive(JSON.parse(event.data) as ServerMessage);
      } catch {
        socket.close(4002, 'Invalid server message');
      }
    };
    socket.onclose = (event) => {
      if (this.stopped || socket !== this.socket) return;
      this.pending = [];
      this.predicted = null;
      this.heading = null;
      if ([4001, 4002, 4003].includes(event.code)) {
        this.update({
          connection: 'closed',
          connectionMessage: event.reason || 'Connection closed. Reload to rejoin.',
        });
        return;
      }
      this.update({
        connection: 'reconnecting',
        connectionMessage: 'Connection lost. Reconnecting…',
      });
      this.reconnect = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 10000));
    };
  }
  private receive(message: ServerMessage) {
    if (message.type === 'welcome') {
      if (message.version !== PROTOCOL_VERSION) {
        this.socket?.close(4002, 'App version changed. Reload this page.');
        return;
      }
      this.map = parseMap(message.workspace.map);
      this.seq = 0;
      this.pending = [];
      this.retry = 0;
      this.tick = message.tick;
      this.receivedAt = performance.now();
      this.predicted = { ...message.players.find((p) => p.id === message.selfId)! };
      this.update({
        workspace: message.workspace,
        players: message.players,
        members: message.members,
        user: message.members.find((m) => m.id === message.selfId)!,
        connection: 'online',
        connectionMessage: 'Connected',
      });
      this.publishRender();
      return;
    }
    if (message.type === 'members') {
      this.update({
        members: message.members,
        user: message.members.find((m) => m.id === this.view.user.id) ?? this.view.user,
        workspace: { ...this.view.workspace, desks: message.desks },
      });
      this.publishRender();
      return;
    }
    if (message.type === 'error') {
      this.update({ connectionMessage: message.message });
      return;
    }
    if (message.type !== 'delta') throw new Error('Unknown message');
    this.tick = message.tick;
    this.receivedAt = performance.now();
    const players = new Map(this.view.players.map((p) => [p.id, p]));
    for (const id of message.removedPlayerIds) players.delete(id);
    for (const player of message.changedPlayers) players.set(player.id, player);
    const self = players.get(this.view.user.id);
    this.pending = this.pending.filter((input) => input.seq > message.ack);
    if (self) {
      this.predicted = { ...self };
      for (const input of this.pending)
        this.predicted = { ...this.predicted, ...move(this.map, this.predicted, input.heading) };
    }
    this.update({ players: [...players.values()] });
    this.publishRender();
  }
  private predict() {
    if (
      this.view.connection !== 'online' ||
      this.socket?.readyState !== WebSocket.OPEN ||
      !this.predicted ||
      this.pending.length >= 6
    )
      return;
    const input: Input = {
      type: 'input',
      seq: ++this.seq,
      heading: document.hidden ? null : this.heading,
    };
    this.pending.push(input);
    this.socket.send(JSON.stringify(input));
    this.predicted = { ...this.predicted, ...move(this.map, this.predicted, input.heading) };
    this.publishRender();
  }
  private publishRender() {
    if (!this.predicted) return;
    this.lastRender = {
      workspace: this.view.workspace,
      selfId: this.view.user.id,
      tick: this.tick,
      receivedAt: this.receivedAt,
      players: this.view.players,
      predictedSelf: this.predicted,
      members: this.view.members,
    };
    for (const listener of this.renderListeners) listener(structuredClone(this.lastRender));
  }
}

export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result as T;
}

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  move,
  parseMap,
  PROTOCOL_VERSION,
  type Input,
  type Player,
  type ServerMessage,
  type SessionInfo,
} from '@office/shared';
import { OfficeSession } from '../../apps/client/src/session/session';

const map = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8')));
const info: SessionInfo = {
  user: {
    id: 'self',
    email: 'self@example.test',
    displayName: 'Self',
    character: 0,
    role: 'owner',
    status: 'free',
  },
  members: [],
  workspace: { id: 'office', name: 'Office', mapRevision: 'test', map: map.tiled, desks: {} },
};
info.members = [info.user];
const initial: Player = {
  ...info.user,
  x: 480,
  y: 490,
  direction: 'down',
  moving: false,
  zoneId: null,
};

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  sent: Input[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason: string }) => void;
  constructor() {
    Socket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  close(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

let session: OfficeSession;
let socket: Socket;
function welcome(target = socket, player = initial) {
  target.receive({
    type: 'welcome',
    version: PROTOCOL_VERSION,
    selfId: initial.id,
    tick: 0,
    players: [player],
    members: info.members,
    workspace: info.workspace,
  });
}
function sample() {
  return session.renderer.sampleSelf(performance.now())!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('WebSocket', Socket);
  Socket.instances = [];
  session = new OfficeSession(info);
  session.start();
  socket = Socket.instances[0];
  welcome();
});
afterEach(() => {
  session.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session movement clocks', () => {
  it('renders input immediately without raising the network or React update rate', () => {
    const render = vi.fn();
    const ui = vi.fn();
    session.renderer.subscribe(render);
    session.subscribe(ui);
    session.renderer.setHeading('right');
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10);
      expect(sample().x).toBeCloseTo(initial.x + (i + 1) * 1.2);
    }
    expect(socket.sent).toHaveLength(0);
    expect(render).toHaveBeenCalledTimes(1);
    expect(ui).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(socket.sent).toEqual([{ type: 'input', seq: 1, heading: 'right' }]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('replays delayed acknowledgements without losing fractional frame progress', () => {
    session.renderer.setHeading('right');
    vi.advanceTimersByTime(150);
    expect(socket.sent).toHaveLength(2);
    const before = sample();
    socket.receive({
      type: 'delta',
      tick: 1,
      ack: 1,
      changedPlayers: [{ ...initial, ...move(map, initial, 'right') }],
      removedPlayerIds: [],
    });
    expect(sample().x).toBeCloseTo(before.x, 8);
    vi.advanceTimersByTime(10);
    expect(sample().x - before.x).toBeCloseTo(1.2, 1);
  });

  it('bounds both queued inputs and visual prediction during a network outage', () => {
    session.renderer.setHeading('right');
    vi.advanceTimersByTime(1000);
    const stopped = sample();
    expect(socket.sent).toHaveLength(6);
    expect(stopped.x).toBeLessThanOrEqual(initial.x + 7 * 8);
    vi.advanceTimersByTime(5000);
    expect(sample().x).toBeCloseTo(stopped.x, 2);
    expect(sample().moving).toBe(false);
    expect(socket.sent).toHaveLength(6);
  });

  it.each(['blur', 'visibilitychange'])('clears frame-rate and network input on %s', (event) => {
    session.renderer.setHeading('right');
    vi.advanceTimersByTime(20);
    const before = sample();
    if (event === 'blur') window.dispatchEvent(new Event(event));
    else document.dispatchEvent(new Event(event));
    vi.advanceTimersByTime(20);
    expect(sample()).toMatchObject({ x: before.x, moving: false });
    vi.advanceTimersByTime(30);
    expect(socket.sent[0].heading).toBeNull();
  });

  it('resets presentation on reconnect rather than easing from stale prediction', () => {
    session.renderer.setHeading('right');
    vi.advanceTimersByTime(100);
    socket.close();
    expect(session.renderer.sampleSelf(performance.now())).toBeNull();
    vi.advanceTimersByTime(1000);
    const restored = { ...initial, x: 800 };
    welcome(Socket.instances[1], restored);
    expect(sample()).toMatchObject({ x: 800, moving: false });
    vi.advanceTimersByTime(20);
    expect(sample().x).toBe(800);
  });
});

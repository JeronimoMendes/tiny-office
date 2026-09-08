import { EventEmitter } from 'node:events';
import { RoomEvent, type Room } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEAKING_HOLD_MS, watchSpeakers } from '../../apps/client/src/ui/media-speaking';

function setup() {
  const local = { identity: 'self', isMicrophoneEnabled: true };
  const remote = { identity: 'peer', isMicrophoneEnabled: true };
  const room = Object.assign(new EventEmitter(), {
    localParticipant: local,
    remoteParticipants: new Map([[remote.identity, remote]]),
    activeSpeakers: [local, remote],
  });
  const changed = vi.fn();
  const stop = watchSpeakers(room as unknown as Room, changed);
  return { room, local, remote, changed, stop };
}

describe('speaking indicators', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('maps simultaneous speakers to player IDs and holds each through short pauses', () => {
    const { room, changed } = setup();
    expect(changed).toHaveBeenLastCalledWith(['self', 'peer']);
    room.activeSpeakers = [room.localParticipant];
    room.emit(RoomEvent.ActiveSpeakersChanged, room.activeSpeakers);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS - 1);
    expect(changed).toHaveBeenLastCalledWith(['self', 'peer']);
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenLastCalledWith(['self']);
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS);
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it('cancels release when speech resumes and does not extend silence on repeated events', () => {
    const { room, local, changed } = setup();
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    vi.advanceTimersByTime(400);
    room.activeSpeakers = [local];
    room.emit(RoomEvent.ActiveSpeakersChanged, [local]);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS);
    expect(changed).toHaveBeenLastCalledWith(['self']);
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    vi.advanceTimersByTime(400);
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS - 400);
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it('mute bypasses a pending silence hold', () => {
    const { room, local, changed } = setup();
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    local.isMicrophoneEnabled = false;
    room.emit(RoomEvent.TrackMuted);
    expect(changed).toHaveBeenLastCalledWith(['peer']);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS);
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it.each([RoomEvent.TrackMuted, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackUnpublished])(
    'removes muted or unpublished microphones on %s even before the speaker list updates',
    (event) => {
      const { room, local, changed } = setup();
      local.isMicrophoneEnabled = false;
      room.emit(event);
      expect(changed).toHaveBeenLastCalledWith(['peer']);
    },
  );

  it('removes departed participants from a stale speaker list', () => {
    const { room, remote, changed } = setup();
    room.remoteParticipants.delete(remote.identity);
    room.emit(RoomEvent.ParticipantDisconnected, remote);
    expect(changed).toHaveBeenLastCalledWith(['self']);
  });

  it.each([RoomEvent.Reconnecting, RoomEvent.Disconnected])('clears on %s', (event) => {
    const { room, changed } = setup();
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    room.emit(event);
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears on cleanup and ignores events from the old call', () => {
    const { room, changed, stop } = setup();
    room.activeSpeakers = [];
    room.emit(RoomEvent.ActiveSpeakersChanged, []);
    stop();
    expect(changed).toHaveBeenLastCalledWith([]);
    expect(vi.getTimerCount()).toBe(0);
    changed.mockClear();
    room.emit(RoomEvent.ActiveSpeakersChanged, room.activeSpeakers);
    room.emit(RoomEvent.TrackMuted);
    room.emit(RoomEvent.Disconnected);
    vi.advanceTimersByTime(SPEAKING_HOLD_MS);
    expect(changed).not.toHaveBeenCalled();
    expect(room.eventNames()).toEqual([]);
  });
});

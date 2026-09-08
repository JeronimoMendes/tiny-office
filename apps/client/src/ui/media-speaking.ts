import { RoomEvent, type Room } from 'livekit-client';

// Bridge pauses between words without delaying the start of a speaking cue.
export const SPEAKING_HOLD_MS = 650;

/** LiveKit identities are office player IDs. Keep this ephemeral and call-local. */
export function watchSpeakers(room: Room, onChange: (ids: string[]) => void): () => void {
  const speaking = new Set<string>();
  const releases = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelRelease = (id: string) => {
    clearTimeout(releases.get(id));
    releases.delete(id);
  };
  const eligible = (id: string) => {
    const participant =
      id === room.localParticipant.identity
        ? room.localParticipant
        : room.remoteParticipants.get(id);
    return participant?.isMicrophoneEnabled ?? false;
  };
  const update = () => {
    const active = new Set(
      room.activeSpeakers.map((participant) => participant.identity).filter(eligible),
    );
    for (const id of active) {
      cancelRelease(id);
      speaking.add(id);
    }
    for (const id of speaking) {
      if (!eligible(id)) {
        // Mute and departure must not wait for the silence hold.
        cancelRelease(id);
        speaking.delete(id);
      } else if (!active.has(id) && !releases.has(id)) {
        releases.set(
          id,
          setTimeout(() => {
            releases.delete(id);
            speaking.delete(id);
            onChange([...speaking]);
          }, SPEAKING_HOLD_MS),
        );
      }
    }
    onChange([...speaking]);
  };
  const clear = () => {
    for (const id of releases.keys()) cancelRelease(id);
    speaking.clear();
    onChange([]);
  };
  room.on(RoomEvent.ActiveSpeakersChanged, update);
  room.on(RoomEvent.TrackMuted, update);
  room.on(RoomEvent.TrackUnpublished, update);
  room.on(RoomEvent.LocalTrackUnpublished, update);
  room.on(RoomEvent.ParticipantDisconnected, update);
  room.on(RoomEvent.Reconnecting, clear);
  room.on(RoomEvent.Disconnected, clear);
  update();
  return () => {
    room.off(RoomEvent.ActiveSpeakersChanged, update);
    room.off(RoomEvent.TrackMuted, update);
    room.off(RoomEvent.TrackUnpublished, update);
    room.off(RoomEvent.LocalTrackUnpublished, update);
    room.off(RoomEvent.ParticipantDisconnected, update);
    room.off(RoomEvent.Reconnecting, clear);
    room.off(RoomEvent.Disconnected, clear);
    clear();
  };
}

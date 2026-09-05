import { useEffect, useRef, useState } from 'react';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import type { Status } from '@office/shared';
import { api } from '../session/session';

type TokenResponse =
  { enabled: false; reason: string } | { enabled: true; url: string; token: string; room: string };

export function MediaControls({
  zoneId,
  status,
  connected,
}: {
  zoneId: string | null;
  status: Status;
  connected: boolean;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const media = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const next = new Room({ adaptiveStream: true, dynacast: true });
    setRoom(null);
    setMic(false);
    setCamera(false);
    if (!connected || !zoneId || status === 'do-not-disturb') {
      setMessage(
        !connected
          ? 'Media disconnected'
          : status === 'do-not-disturb'
            ? 'Media off in DND'
            : 'Open floor is quiet',
      );
      return () => void next.disconnect();
    }
    // Elements are removed by selector: the SDK detaches a revoked track before
    // this handler runs, so track.detach() can no longer report its elements.
    const drop = (selector: string) =>
      media.current?.querySelectorAll(selector).forEach((element) => element.remove());
    const attach = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      const element = track.attach();
      element.dataset.participant = participant.identity;
      element.dataset.track = publication.trackSid;
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      media.current?.append(element);
    };
    const detach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      track.detach();
      drop(`[data-track="${publication.trackSid}"]`);
    };
    next.on(RoomEvent.TrackSubscribed, attach);
    next.on(RoomEvent.TrackUnsubscribed, detach);
    next.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) =>
      drop(`[data-participant="${participant.identity}"]`),
    );
    // The server may disconnect us the moment its policy changes; ask again
    // rather than sitting silently outside a conversation we still belong to.
    next.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;
      setRoom(null);
      setMessage('Reconnecting media…');
      setTimeout(() => !cancelled && setAttempt((value) => value + 1), 750);
    });
    void api<TokenResponse>('/media/token')
      .then(async (result) => {
        if (cancelled) return;
        if (!result.enabled) {
          setMessage(result.reason);
          return;
        }
        // Subscriptions follow the room-scoped credential: LiveKit delivers
        // only this zone's tracks, and nothing at all without canSubscribe.
        await next.connect(result.url, result.token);
        if (cancelled) return void next.disconnect();
        setRoom(next);
        setMessage(status === 'focus' ? 'Focused · incoming media off' : 'In zone conversation');
      })
      .catch((error) => setMessage((error as Error).message));
    return () => {
      cancelled = true;
      next.removeAllListeners();
      void next.disconnect();
      if (media.current) media.current.replaceChildren();
    };
  }, [connected, zoneId, status, attempt]);

  async function toggleMic() {
    if (!room) return;
    try {
      if (mic) {
        await room.localParticipant.setMicrophoneEnabled(false);
        setMic(false);
      } else {
        const track = await createLocalAudioTrack();
        await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
        setMic(true);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  async function toggleCamera() {
    if (!room || status !== 'free') return;
    try {
      if (camera) {
        await room.localParticipant.setCameraEnabled(false);
        media.current?.querySelectorAll('[data-local]').forEach((element) => element.remove());
        setCamera(false);
      } else {
        const track = await createLocalVideoTrack();
        await room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
        const element = track.attach();
        element.dataset.local = 'true';
        element.muted = true;
        if (element instanceof HTMLVideoElement) element.playsInline = true;
        media.current?.append(element);
        setCamera(true);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <div className="media-controls">
      <div className="media-tracks" ref={media} aria-label="Conversation media" />
      <button disabled={!room} aria-pressed={mic} onClick={() => void toggleMic()}>
        {mic ? 'Mute' : 'Mic'}
      </button>
      <button
        disabled={!room || status !== 'free'}
        aria-pressed={camera}
        title={status === 'focus' ? 'Video is disabled while focused' : undefined}
        onClick={() => void toggleCamera()}
      >
        {camera ? 'Stop video' : 'Video'}
      </button>
      <small>{message}</small>
    </div>
  );
}

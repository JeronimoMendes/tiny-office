import { useEffect, useRef, useState } from 'react';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import type { Status } from '@office/shared';
import { api } from '../session/session';

/** Names every camera so a face in the strip maps to a person in the room. */
function tile(video: HTMLMediaElement, name: string) {
  if (video instanceof HTMLVideoElement) video.playsInline = true;
  const wrapper = document.createElement('div');
  wrapper.className = 'media-tile';
  const label = document.createElement('span');
  label.className = 'media-name';
  label.textContent = name;
  wrapper.append(video, label);
  return wrapper;
}

type TokenResponse =
  { enabled: false; reason: string } | { enabled: true; url: string; token: string; room: string };

function MicrophoneIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V6M7 10v1a5 5 0 0 0 10 0v-1M12 16v3M9 19h6" />
      {!enabled && <path d="M4 4l16 16" />}
    </svg>
  );
}

function ScreenIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16v12H4zM9 21h6M12 17v4" />
      {!enabled && <path d="M3 3l18 18" />}
    </svg>
  );
}

export function MediaControls({
  zoneId,
  status,
  connected,
  displayName,
}: {
  zoneId: string | null;
  status: Status;
  connected: boolean;
  displayName: string;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const media = useRef<HTMLDivElement>(null);
  const published = useRef(new Map<Track.Source, LocalTrack>());

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
      element.autoplay = true;
      const node =
        element instanceof HTMLVideoElement
          ? tile(element, participant.name || participant.identity)
          : element;
      node.dataset.participant = participant.identity;
      node.dataset.track = publication.trackSid;
      media.current?.append(node);
    };
    const detach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      track.detach();
      drop(`[data-track="${publication.trackSid}"]`);
    };
    next.on(RoomEvent.TrackSubscribed, attach);
    next.on(RoomEvent.TrackUnsubscribed, detach);
    next.on(RoomEvent.TrackUnpublished, (publication: RemoteTrackPublication) =>
      drop(`[data-track="${publication.trackSid}"]`),
    );
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
      .catch((error) => {
        if (!cancelled) setMessage((error as Error).message);
      });
    return () => {
      cancelled = true;
      published.current.clear();
      next.removeAllListeners();
      void next.disconnect();
      if (media.current) media.current.replaceChildren();
    };
  }, [connected, zoneId, status, attempt]);

  useEffect(() => {
    const label = media.current?.querySelector('[data-local] .media-name');
    if (label) label.textContent = `${displayName} (you)`;
  }, [displayName]);

  // Muting a published track leaves it subscribed, so peers keep a dead tile and
  // the next publish adds a second one. Stopping means unpublishing.
  async function unpublish(source: Track.Source) {
    const track = published.current.get(source);
    if (!track) return;
    published.current.delete(source);
    await room?.localParticipant.unpublishTrack(track, true);
  }
  async function publish(source: Track.Source, track: LocalTrack) {
    await room!.localParticipant.publishTrack(track, { source });
    published.current.set(source, track);
  }

  async function toggleMic() {
    if (!room) return;
    try {
      if (mic) {
        await unpublish(Track.Source.Microphone);
        setMic(false);
      } else {
        await publish(Track.Source.Microphone, await createLocalAudioTrack());
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
        await unpublish(Track.Source.Camera);
        media.current?.querySelectorAll('[data-local]').forEach((element) => element.remove());
        setCamera(false);
      } else {
        const track = await createLocalVideoTrack();
        await publish(Track.Source.Camera, track);
        const element = track.attach();
        element.muted = true;
        const node = tile(element, `${displayName} (you)`);
        node.dataset.local = 'true';
        media.current?.append(node);
        setCamera(true);
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <div className="media-controls">
      <div className="media-tracks" ref={media} aria-label="Conversation media" />
      <button
        className="media-toggle"
        disabled={!room}
        aria-label={mic ? 'Mute' : 'Mic'}
        aria-pressed={mic}
        title={mic ? 'Turn off microphone' : 'Turn on microphone'}
        onClick={() => void toggleMic()}
      >
        <MicrophoneIcon enabled={mic} />
      </button>
      <button
        className="media-toggle"
        disabled={!room || status !== 'free'}
        aria-label={camera ? 'Stop video' : 'Video'}
        aria-pressed={camera}
        title={
          status === 'focus'
            ? 'Video is disabled while focused'
            : camera
              ? 'Turn off video'
              : 'Turn on video'
        }
        onClick={() => void toggleCamera()}
      >
        <ScreenIcon enabled={camera} />
      </button>
      <small>{message}</small>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from 'livekit-client';
import type { Status } from '@office/shared';
import { api } from '../session/session';
import { callRows, pinnedLayout } from './media-layout';
import {
  AVAILABLE_MEDIA_IDLE_MS,
  shouldPauseAvailableMedia,
  shouldResumeAvailableMedia,
} from './media-presence';

/** Names every camera so a face in the strip maps to a person in the room. */
function tile(video: HTMLMediaElement, name: string, screen = false) {
  if (video instanceof HTMLVideoElement) video.playsInline = true;
  const wrapper = document.createElement('div');
  wrapper.className = `media-tile${screen ? ' media-screen' : ''}`;
  const label = document.createElement('span');
  label.className = 'media-name';
  label.textContent = screen ? `${name} · screen` : name;
  wrapper.append(video, label);
  // A shared screen is what people want to look at, so it doubles as a button.
  if (screen) {
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'button');
  }
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
  hasPeerInZone,
}: {
  zoneId: string | null;
  status: Status;
  connected: boolean;
  displayName: string;
  hasPeerInZone: boolean;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sharePending, setSharePending] = useState(false);
  const shareOperation = useRef<Room | null>(null);
  const canShare = !!navigator.mediaDevices?.getDisplayMedia;
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [idlePaused, setIdlePaused] = useState(false);
  const media = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const published = useRef(new Map<Track.Source, LocalTrack>());
  const pending = useRef(new Set<Track.Source>());

  // Keep the same media elements mounted: changing the layout must not
  // reconnect the call, republish tracks, or interrupt playback.
  useEffect(() => {
    const element = dialog.current!;
    if (element.matches(':modal') === expanded) return;
    element.close();
    if (expanded) {
      element.showModal();
      expandButton.current?.focus();
    } else {
      element.show();
      expandButton.current?.focus();
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const container = media.current!;
    const tiles = () => Array.from(container.querySelectorAll<HTMLElement>('.media-tile'));
    const layout = () => {
      const videos = tiles();
      const gap = parseFloat(getComputedStyle(container).gap);
      const stage = videos.find((tile) => tile.dataset.screen === pinned);
      // A pinned share that stopped leaves nothing to stage: fall back to the grid.
      if (pinned && !stage) return void setPinned(null);
      container.classList.toggle('media-staged', !!stage);
      for (const tile of videos) tile.classList.toggle('media-pinned', tile === stage);
      if (stage) {
        const faces = videos.filter((tile) => tile !== stage);
        const { stage: height, strip } = pinnedLayout(
          faces.length,
          container.clientWidth,
          container.clientHeight,
          gap,
        );
        stage.style.width = '100%';
        stage.style.height = `${height}px`;
        for (const face of faces) {
          face.style.width = `${strip.width}px`;
          face.style.height = `${strip.height}px`;
        }
        return;
      }
      const rows = callRows(videos.length, container.clientWidth, container.clientHeight, gap);
      let index = 0;
      for (const columns of rows) {
        for (let column = 0; column < columns; column++) {
          const tile = videos[index++]!;
          tile.style.width = `calc((100% - ${gap * (columns - 1)}px) / ${columns})`;
          tile.style.height = `calc((100% - ${gap * (rows.length - 1)}px) / ${rows.length})`;
        }
      }
    };
    const resize = new ResizeObserver(layout);
    const tracks = new MutationObserver(layout);
    resize.observe(container);
    tracks.observe(container, { childList: true });
    layout();
    return () => {
      resize.disconnect();
      tracks.disconnect();
      container.classList.remove('media-staged');
      for (const tile of tiles()) {
        tile.classList.remove('media-pinned');
        tile.style.removeProperty('width');
        tile.style.removeProperty('height');
      }
    };
  }, [expanded, pinned]);

  // A shared screen is the reason to look at a call: clicking one from the map
  // opens the focused view on it, and clicking it there pins or releases it.
  useEffect(() => {
    const container = media.current!;
    const describe = () => {
      for (const screen of container.querySelectorAll<HTMLElement>('.media-screen')) {
        const staged = expanded && screen.dataset.screen === pinned;
        screen.title = expanded
          ? staged
            ? 'Unpin screen'
            : 'Pin screen'
          : 'Open this screen in the call';
        if (expanded) screen.setAttribute('aria-pressed', String(staged));
        else screen.removeAttribute('aria-pressed');
      }
    };
    const activate = (target: EventTarget | null) => {
      const screen = (target as HTMLElement | null)?.closest<HTMLElement>('.media-screen');
      if (!screen) return;
      const key = screen.dataset.screen!;
      if (expanded) return setPinned((current) => (current === key ? null : key));
      if (!hasPeerInZone) return;
      setPinned(key);
      setExpanded(true);
    };
    const clicked = (event: MouseEvent) => activate(event.target);
    const pressed = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!(event.target as HTMLElement).classList.contains('media-screen')) return;
      event.preventDefault();
      activate(event.target);
    };
    const tiles = new MutationObserver(describe);
    tiles.observe(container, { childList: true });
    container.addEventListener('click', clicked);
    container.addEventListener('keydown', pressed);
    describe();
    return () => {
      tiles.disconnect();
      container.removeEventListener('click', clicked);
      container.removeEventListener('keydown', pressed);
    };
  }, [expanded, pinned, hasPeerInZone]);

  useEffect(() => {
    if (!room || !hasPeerInZone) setExpanded(false);
  }, [room, hasPeerInZone]);

  useEffect(() => {
    const visibilityChanged = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => document.removeEventListener('visibilitychange', visibilityChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const next = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = null;
    setRoom(null);
    setMic(false);
    setCamera(false);
    setSharing(false);
    setSharePending(false);
    shareOperation.current = null;
    setPinned(null);
    setIdlePaused(false);
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
          ? tile(
              element,
              participant.name || participant.identity,
              publication.source === Track.Source.ScreenShare,
            )
          : element;
      node.dataset.participant = participant.identity;
      node.dataset.track = publication.trackSid;
      if (publication.source === Track.Source.ScreenShare)
        node.dataset.screen = publication.trackSid;
      media.current?.append(node);
    };
    const detach = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      track.detach();
      drop(`[data-track="${publication.trackSid}"]`);
    };
    next.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.ScreenShare || !publication.track || cancelled)
        return;
      const element = publication.track.attach();
      element.muted = true;
      const node = tile(element, `${next.localParticipant.name || displayName} (you)`, true);
      node.dataset.localScreen = 'true';
      node.dataset.screen = 'local';
      media.current?.append(node);
      setSharing(true);
      setMessage('Sharing your screen');
    });
    next.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.ScreenShare) return;
      publication.track?.detach();
      drop('[data-local-screen]');
      setSharing(false);
      setMessage('Screen sharing stopped');
    });
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
      roomRef.current = null;
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
        await next.connect(result.url, result.token);
        if (cancelled) return void next.disconnect();
        roomRef.current = next;
        setRoom(next);
        setMessage(status === 'focus' ? 'Focused · mic and video off' : 'In zone conversation');
      })
      .catch((error) => {
        if (!cancelled) setMessage((error as Error).message);
      });
    return () => {
      cancelled = true;
      if (roomRef.current === next) roomRef.current = null;
      published.current.clear();
      pending.current.clear();
      next.removeAllListeners();
      void next.disconnect();
      if (media.current) media.current.replaceChildren();
    };
  }, [connected, zoneId, status, attempt]);

  useEffect(() => {
    const label = media.current?.querySelector('[data-local] .media-name');
    if (label) label.textContent = `${displayName} (you)`;
    const screenLabel = media.current?.querySelector('[data-local-screen] .media-name');
    if (screenLabel) screenLabel.textContent = `${displayName} (you) · screen`;
  }, [displayName]);

  async function setMicrophone(enabled: boolean) {
    const source = Track.Source.Microphone;
    const activeRoom = roomRef.current;
    if (!activeRoom || pending.current.has(source) || published.current.has(source) === enabled)
      return;
    pending.current.add(source);
    try {
      if (enabled) {
        const track = await createLocalAudioTrack();
        if (roomRef.current !== activeRoom) return void track.stop();
        await activeRoom.localParticipant.publishTrack(track, { source });
        published.current.set(source, track);
      } else {
        const track = published.current.get(source)!;
        published.current.delete(source);
        await activeRoom.localParticipant.unpublishTrack(track, true);
      }
      if (roomRef.current === activeRoom) setMic(enabled);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      pending.current.delete(source);
    }
  }

  async function setVideo(enabled: boolean) {
    const source = Track.Source.Camera;
    const activeRoom = roomRef.current;
    if (!activeRoom || pending.current.has(source) || published.current.has(source) === enabled)
      return;
    pending.current.add(source);
    try {
      if (enabled) {
        const track = await createLocalVideoTrack();
        if (roomRef.current !== activeRoom) return void track.stop();
        await activeRoom.localParticipant.publishTrack(track, { source });
        published.current.set(source, track);
        const element = track.attach();
        element.muted = true;
        const node = tile(element, `${displayName} (you)`);
        node.dataset.local = 'true';
        media.current?.append(node);
      } else {
        const track = published.current.get(source)!;
        published.current.delete(source);
        await activeRoom.localParticipant.unpublishTrack(track, true);
        media.current?.querySelectorAll('[data-local]').forEach((element) => element.remove());
      }
      if (roomRef.current === activeRoom) setCamera(enabled);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      pending.current.delete(source);
    }
  }

  async function toggleScreenShare() {
    const activeRoom = roomRef.current;
    if (!activeRoom || shareOperation.current) return;
    shareOperation.current = activeRoom;
    setSharePending(true);
    try {
      // Screen capture is always an explicit user action, never presence-driven.
      await activeRoom.localParticipant.setScreenShareEnabled(
        !activeRoom.localParticipant.isScreenShareEnabled,
        { audio: false },
      );
      // The picker may outlive the conversation that opened it.
      if (roomRef.current !== activeRoom) {
        await activeRoom.localParticipant.setScreenShareEnabled(false);
      }
    } catch (error) {
      if (roomRef.current === activeRoom) {
        setMessage(
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'Screen sharing cancelled or permission denied'
            : `Screen sharing failed: ${(error as Error).message}`,
        );
      }
    } finally {
      if (shareOperation.current === activeRoom) {
        shareOperation.current = null;
        setSharePending(false);
      }
    }
  }

  // Available people automatically open both tracks when somebody joins their
  // zone. Focused people receive the conversation but choose when to publish.
  useEffect(() => {
    if (!room || !shouldResumeAvailableMedia(status, pageVisible, hasPeerInZone, idlePaused))
      return;
    setIdlePaused(false);
    void setMicrophone(true);
    void setVideo(true);
  }, [room, status, hasPeerInZone, pageVisible, idlePaused]);

  // An available person who leaves an empty zone open in a background tab gets
  // a short grace period. A peer joining, or returning to the tab, resumes both.
  useEffect(() => {
    if (!room || !shouldPauseAvailableMedia(status, pageVisible, hasPeerInZone)) return;
    const timer = window.setTimeout(() => {
      setIdlePaused(true);
      void setMicrophone(false);
      void setVideo(false);
    }, AVAILABLE_MEDIA_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [room, status, hasPeerInZone, pageVisible]);

  return (
    <dialog
      open
      ref={dialog}
      className={`media-controls${expanded ? ' media-expanded' : ''}`}
      role={expanded ? 'dialog' : 'group'}
      aria-label={expanded ? 'Focused call' : 'Call controls'}
      aria-modal={expanded || undefined}
      onCancel={(event) => {
        event.preventDefault();
        setExpanded(false);
      }}
    >
      <h2 hidden={!expanded}>Zone conversation</h2>
      <div className="media-tracks" ref={media} aria-label="Conversation media" />
      <div className="media-actions">
        <button
          className="media-toggle"
          disabled={!room}
          aria-label={mic ? 'Mute' : 'Mic'}
          aria-pressed={mic}
          title={mic ? 'Turn off microphone' : 'Turn on microphone'}
          onClick={() => void setMicrophone(!mic)}
        >
          <MicrophoneIcon enabled={mic} />
        </button>
        <button
          className="media-toggle"
          disabled={!room}
          aria-label={camera ? 'Stop video' : 'Video'}
          aria-pressed={camera}
          title={camera ? 'Turn off video' : 'Turn on video'}
          onClick={() => void setVideo(!camera)}
        >
          <ScreenIcon enabled={camera} />
        </button>
        <button
          className="media-toggle"
          disabled={!room || !canShare || sharePending}
          aria-label={sharing ? 'Stop sharing' : 'Share screen'}
          aria-pressed={sharing}
          title={
            !canShare
              ? 'Screen sharing is not supported in this browser'
              : sharing
                ? 'Stop sharing screen'
                : 'Share screen'
          }
          onClick={() => void toggleScreenShare()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 17H3V4h18v13h-5M12 21V10M8 14l4-4 4 4" />
          </svg>
        </button>
        {room && hasPeerInZone && (
          <button
            ref={expandButton}
            className="media-toggle"
            disabled={!room}
            aria-label={expanded ? 'Back to map' : 'Expand call'}
            aria-expanded={expanded}
            title={expanded ? 'Back to map (Esc)' : 'Expand call'}
            onClick={() => setExpanded((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={
                  expanded
                    ? 'M4 9h5V4M15 4v5h5M20 15h-5v5M9 20v-5H4'
                    : 'M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5'
                }
              />
            </svg>
          </button>
        )}
        <small role="status">{message}</small>
      </div>
    </dialog>
  );
}

import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useRef,
} from 'react';
import { createRoot } from 'react-dom/client';
import { parseMap, type SessionInfo } from '@office/shared';
import { OfficeSession, api } from './session/session';
import { mountOffice } from './game/mount';
import { OwnerPanel, ProfileDialog } from './ui/Account';
import { Avatar } from './ui/Avatar';
import './ui/styles.css';

const MediaControls = lazy(() =>
  import('./ui/Media').then((module) => ({ default: module.MediaControls })),
);
const WhiteboardDialog = lazy(() =>
  import('./ui/Whiteboard').then((module) => ({
    default: module.WhiteboardDialog,
  })),
);
const WhiteboardPreview = lazy(() =>
  import('./ui/Whiteboard').then((module) => ({
    default: module.WhiteboardPreview,
  })),
);

// Read personal link secrets once and remove them before any network activity.
const loginToken = new URLSearchParams(location.hash.slice(1)).get('login');
if (loginToken) history.replaceState(null, '', location.pathname + location.search);
const startup = (async () => {
  if (loginToken) await api('/login', { token: loginToken });
  const bootstrap = await api<{ required: boolean }>('/bootstrap');
  if (bootstrap.required) return { bootstrap: true, info: null };
  try {
    return { bootstrap: false, info: await api<SessionInfo>('/session') };
  } catch {
    return { bootstrap: false, info: null };
  }
})();

function App() {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [bootstrap, setBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    void startup
      .then((result) => {
        setInfo(result.info);
        setBootstrap(result.bootstrap);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function claim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    const data = new FormData(event.currentTarget);
    try {
      await api('/bootstrap', {
        secret: data.get('secret'),
        email: data.get('email'),
        displayName: data.get('displayName'),
      });
      setInfo(await api<SessionInfo>('/session'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (info) return <Office info={info} />;
  return (
    <main className="entry">
      <div className="entry-art" aria-hidden="true">
        <span>✳</span>
        <p>
          A tiny space.
          <br />A little more together.
        </p>
      </div>
      <section className="entry-card">
        <div className="eyebrow">TINY OFFICE</div>
        <h1>{bootstrap ? 'Make yourself at home.' : 'Your team, in one place.'}</h1>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {bootstrap ? (
          <>
            <p>
              Claim this office with the bootstrap secret in your server logs. You’ll be its owner.
            </p>
            <form onSubmit={claim}>
              <label>
                Bootstrap secret
                <input name="secret" type="password" required autoComplete="off" />
              </label>
              <label>
                Your email
                <input name="email" type="email" required autoComplete="email" maxLength={254} />
              </label>
              <label>
                Display name
                <input name="displayName" required maxLength={40} autoComplete="nickname" />
              </label>
              <button className="primary" disabled={loading}>
                Create my office
              </button>
            </form>
          </>
        ) : (
          <p>
            {loading
              ? 'Opening the door…'
              : 'Ask your workspace owner for a personal sign-in link. Each link works once; your session stays signed in for 30 days.'}
          </p>
        )}
        <small>A private, self-hosted place to work alongside each other.</small>
      </section>
    </main>
  );
}

function Office({ info }: { info: SessionInfo }) {
  const [session] = useState(() => new OfficeSession(info));
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [panel, setPanel] = useState(true);
  const [profile, setProfile] = useState(false);
  const [error, setError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    session.start();
    const unmount = mountOffice(mapRef.current!, session.renderer);
    return () => {
      unmount();
      session.stop();
    };
  }, [session]);
  const self = view.players.find((p) => p.id === view.user.id);
  const whiteboardZones = useMemo(() => parseMap(view.workspace.map).zones, [view.workspace.map]);
  const meetingZone = whiteboardZones.find(
    (zone) => zone.id === self?.zoneId && zone.kind === 'meeting',
  );
  const nearWhiteboard = Boolean(
    meetingZone &&
    self &&
    Math.hypot(self.x - (meetingZone.x + meetingZone.width / 2), self.y - meetingZone.y) < 105,
  );
  const roomBoard = view.whiteboard?.zoneId === self?.zoneId ? view.whiteboard : null;
  const zones = view.workspace.map.layers.find((l) => l.name === 'zones')?.objects ?? [];
  const zoneName = (id: string | null) =>
    zones.find((z) => z.properties.some((p) => p.name === 'zoneId' && p.value === id))?.name ??
    'Open floor';
  const online = new Set(view.players.map((p) => p.id));
  useEffect(() => {
    if (whiteboardOpen && self?.zoneId !== whiteboardOpen) {
      session.closeWhiteboard(whiteboardOpen);
      setWhiteboardOpen(null);
    }
  }, [self?.zoneId, session, whiteboardOpen]);
  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.code !== 'Space' ||
        event.repeat ||
        whiteboardOpen ||
        !nearWhiteboard ||
        !meetingZone ||
        target.closest('input,textarea,select,[contenteditable],dialog')
      )
        return;
      event.preventDefault();
      setWhiteboardOpen(meetingZone.id);
      session.openWhiteboard(meetingZone.id);
    };
    window.addEventListener('keydown', openFromKeyboard);
    return () => window.removeEventListener('keydown', openFromKeyboard);
  }, [meetingZone, nearWhiteboard, session, whiteboardOpen]);
  function openWhiteboard(zoneId: string) {
    setWhiteboardOpen(zoneId);
    session.openWhiteboard(zoneId);
  }
  function closeWhiteboard() {
    if (whiteboardOpen) session.closeWhiteboard(whiteboardOpen);
    setWhiteboardOpen(null);
  }
  async function setStatus(status: SessionInfo['user']['status']) {
    setStatusBusy(true);
    setError('');
    try {
      await api('/status', { status }, 'PATCH');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }
  async function logout() {
    try {
      await api('/logout', {});
      session.stop();
      location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="office-shell">
      <div
        className="map-stage"
        ref={mapRef}
        aria-label="Virtual office map. Use WASD or arrow keys to walk."
        tabIndex={0}
      />
      <header className="topbar">
        <div className="brand glass">
          <span className="brand-mark">✳</span>
          <div>
            <strong>{view.workspace.name}</strong>
            <span>WORKSPACE</span>
          </div>
        </div>
        <div className="topbar-right glass">
          <span className={`connection ${view.connection}`} data-testid="connection">
            <i />
            {view.connection === 'online' ? `${view.players.length} here` : view.connection}
          </span>
          <button
            className="icon-button"
            aria-label={panel ? 'Hide participants' : 'Show participants'}
            onClick={() => setPanel(!panel)}
          >
            ☷
          </button>
        </div>
      </header>
      <div className="location-chip glass">
        <span>⌖</span> {zoneName(self?.zoneId ?? null)}{' '}
        <span className="quiet-tag">{self?.zoneId ? 'Zone' : 'Quiet space'}</span>
      </div>
      {view.connection !== 'online' && (
        <div className="connection-banner glass" role="status">
          {view.connectionMessage}
          {view.connection === 'closed' && (
            <button onClick={() => location.reload()}>Rejoin</button>
          )}
        </div>
      )}
      {error && (
        <div className="connection-banner error" role="alert">
          {error}
        </div>
      )}
      {nearWhiteboard && !whiteboardOpen && !roomBoard && (
        <div className="whiteboard-hint glass" role="status">
          <span aria-hidden="true">✎</span>
          <div>
            <strong>Use the whiteboard</strong>
            <small>
              Press <kbd>Space</kbd> to start drawing
            </small>
          </div>
        </div>
      )}
      {roomBoard && !whiteboardOpen && (
        <Suspense fallback={null}>
          <WhiteboardPreview
            board={roomBoard}
            session={session}
            onOpen={() => openWhiteboard(roomBoard.zoneId)}
          />
        </Suspense>
      )}
      {panel && (
        <aside className="side-panel glass">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">GOOD TO SEE YOU</span>
              <h2>
                People <span>{view.players.length}</span>
              </h2>
            </div>
            <button
              className="icon-button"
              onClick={() => setPanel(false)}
              aria-label="Close participants"
            >
              ×
            </button>
          </div>
          <div className="people-list" aria-label="Participants">
            {[...view.members]
              .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)))
              .map((member) => {
                const player = view.players.find((p) => p.id === member.id);
                return (
                  <div
                    className={`person ${player ? '' : 'offline'}`}
                    key={member.id}
                    data-testid={`person-${member.id}`}
                  >
                    <Avatar character={member.character} appearance={member.appearance} />
                    <div className="person-details">
                      <strong>
                        {member.displayName}
                        {member.id === view.user.id && <small> (you)</small>}
                      </strong>
                      <span>{player ? zoneName(player.zoneId) : 'Away from office'}</span>
                    </div>
                    <span
                      title={player ? member.status : 'Offline'}
                      aria-label={player ? member.status : 'Offline'}
                      className={`status-dot ${player ? member.status : 'offline'}`}
                    />
                  </div>
                );
              })}
          </div>
          <div className="panel-note">
            <strong>Room to settle in.</strong>
            <p>Walk into a desk or meeting room to join its private conversation.</p>
          </div>
          {view.user.role === 'owner' && <OwnerPanel view={view} />}
          <button className="text-button signout" onClick={logout}>
            Sign out
          </button>
        </aside>
      )}
      <footer className="bottom-wrap">
        <div className="controls glass">
          <button className="identity-button" onClick={() => setProfile(true)}>
            <Avatar character={view.user.character} appearance={view.user.appearance} />
            <span>
              <strong>{view.user.displayName}</strong>
              <small>Edit your character</small>
            </span>
            <span className="edit-glyph">✎</span>
          </button>
          <span className="control-divider" />
          <label className="availability">
            <span className={`status-dot ${view.user.status}`} />
            <select
              aria-label="Availability"
              disabled={statusBusy}
              value={view.user.status}
              onChange={(event) =>
                void setStatus(event.target.value as SessionInfo['user']['status'])
              }
            >
              <option value="free">Available</option>
              <option value="focus">Focus</option>
              <option value="do-not-disturb">Do not disturb</option>
            </select>
          </label>
          <span className="control-divider" />
          <Suspense fallback={<small>Media…</small>}>
            <MediaControls
              zoneId={self?.zoneId ?? null}
              status={view.user.status}
              connected={view.connection === 'online'}
              displayName={view.user.displayName}
            />
          </Suspense>
          <span className="control-divider" />
          <div className="movement-hint">
            <kbd>W</kbd>
            <div>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd>
            </div>
          </div>
          <span className="walk-copy">
            or arrow keys
            <br />
            <strong>to wander</strong>
          </span>
        </div>
        <span className="bottom-caption">A shared space, at your own pace.</span>
      </footer>
      {profile && <ProfileDialog user={view.user} onClose={() => setProfile(false)} />}
      {whiteboardOpen && roomBoard && (
        <Suspense fallback={<div className="whiteboard-loading glass">Opening whiteboard…</div>}>
          <WhiteboardDialog
            board={roomBoard}
            session={session}
            roomName={zoneName(whiteboardOpen)}
            onClose={closeWhiteboard}
          />
        </Suspense>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

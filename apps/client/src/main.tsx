import React, { useEffect, useState, useSyncExternalStore, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionInfo } from '@office/shared';
import { OfficeSession, api } from './session/session';
import { mountOffice } from './game/mount';
import { OwnerPanel, ProfileDialog } from './ui/Account';
import './ui/styles.css';

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
  const zones = view.workspace.map.layers.find((l) => l.name === 'zones')?.objects ?? [];
  const zoneName = (id: string | null) =>
    zones.find((z) => z.properties.some((p) => p.name === 'zoneId' && p.value === id))?.name ??
    'Open floor';
  const online = new Set(view.players.map((p) => p.id));
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
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">✳</span>
          <div>
            <strong>{view.workspace.name}</strong>
            <span>WORKSPACE</span>
          </div>
        </div>
        <div className="topbar-right">
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
                    <Avatar character={member.character} />
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
            <p>
              Walk over to a desk or explore a meeting room. Audio and video arrive in the next
              phase.
            </p>
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
            <Avatar character={view.user.character} />
            <span>
              <strong>{view.user.displayName}</strong>
              <small>Edit your character</small>
            </span>
            <span className="edit-glyph">✎</span>
          </button>
          <span className="control-divider" />
          <span className="availability">
            <span className={`status-dot ${view.user.status}`} />
            {view.user.status === 'free' ? 'Available' : view.user.status}
          </span>
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
    </main>
  );
}

export function Avatar({ character }: { character: number }) {
  return (
    <span
      className="pixel-avatar"
      style={{ backgroundPosition: `-24px -${character * 32}px` }}
      aria-hidden="true"
    />
  );
}
createRoot(document.getElementById('root')!).render(<App />);

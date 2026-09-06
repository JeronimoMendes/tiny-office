import { useEffect, useRef, useState, useMemo, type FormEvent } from 'react';
import { parseMap, type Member } from '@office/shared';
import { api, type SessionView } from '../session/session';
import { Avatar } from './Avatar';

export function OwnerPanel({ view }: { view: SessionView }) {
  const [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const desks = useMemo(
    () => parseMap(view.workspace.map).zones.filter((z) => z.kind === 'desk'),
    [view.workspace.map],
  );
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setLink('');
    setCopied(false);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ url: string }>('/invites', {
        email: data.get('email'),
        displayName: data.get('displayName'),
      });
      setLink(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function assign(zoneId: string, userId: string) {
    setError('');
    setBusy(true);
    try {
      await api(`/desks/${zoneId}`, { userId: userId || null }, 'PUT');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="owner-panel">
      <summary>
        Manage office <span>OWNER</span>
      </summary>
      <p>
        Share a personal, single-use link. Enter an existing email to issue a fresh sign-in link.
      </p>
      <form onSubmit={invite}>
        <label>
          Member email
          <input name="email" type="email" required maxLength={254} />
        </label>
        <label>
          Member name
          <input name="displayName" required maxLength={40} />
        </label>
        <button className="primary" disabled={busy}>
          Create sign-in link
        </button>
      </form>
      {link && (
        <div className="invite-result">
          <label>
            Personal sign-in link
            <input
              aria-label="Personal sign-in link"
              value={link}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </label>
          <small>Expires in 24 hours. Send only to this person.</small>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setCopied(true))
                .catch(() => setError('Select and copy the link manually.'))
            }
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3>Desk assignments</h3>
      <p>One desk per person. Anyone can walk into a desk zone.</p>
      {desks.map((desk) => (
        <label key={desk.id}>
          {desk.name}
          <select
            aria-label={`Assign ${desk.name}`}
            disabled={busy}
            value={view.workspace.desks[desk.id] ?? ''}
            onChange={(e) => void assign(desk.id, e.target.value)}
          >
            <option value="">Unassigned</option>
            {view.members.map((m) => (
              <option value={m.id} key={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
      ))}
    </details>
  );
}

export function ProfileDialog({ user, onClose }: { user: Member; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [character, setCharacter] = useState(user.character),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      await api('/profile', { displayName: data.get('displayName'), character }, 'PATCH');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} onCancel={onClose} className="profile-dialog">
      <div className="panel-heading">
        <h2>A little more you.</h2>
        <button aria-label="Close profile" onClick={onClose}>
          ×
        </button>
      </div>
      <form onSubmit={save}>
        <label>
          Display name
          <input name="displayName" defaultValue={user.displayName} required maxLength={40} />
        </label>
        <fieldset>
          <legend>Your character</legend>
          <div className="character-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <button
                type="button"
                key={i}
                className={character === i ? 'selected' : ''}
                aria-label={`Character ${i + 1}`}
                aria-pressed={character === i}
                onClick={() => setCharacter(i)}
              >
                <Avatar character={i} scale={1.5} />
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          Save profile
        </button>
      </form>
    </dialog>
  );
}

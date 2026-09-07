import { useEffect, useRef, useState, useMemo, type FormEvent } from 'react';
import {
  parseMap,
  presetAppearance,
  wardrobe,
  type AppearanceSlot,
  type Direction,
  type Member,
} from '@office/shared';
import { api, type SessionView } from '../session/session';
import { Avatar } from './Avatar';

export function OwnerPanel({ view }: { view: SessionView }) {
  const [link, setLink] = useState(''),
    [emailed, setEmailed] = useState(''),
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
    setEmailed('');
    setCopied(false);
    const data = new FormData(event.currentTarget);
    try {
      const email = String(data.get('email'));
      const result = await api<{ url: string; emailed: boolean }>('/invites', {
        email,
        displayName: data.get('displayName'),
      });
      setLink(result.url);
      if (result.emailed) setEmailed(email);
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
        Members can also send themselves one from the sign-in screen.
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
          <small>
            {emailed
              ? `Sent to ${emailed}. Copy the link too if the email does not arrive.`
              : 'Expires in 24 hours. Send only to this person.'}
          </small>
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
      <p>People can pick an available desk themselves. As owner, you can swap or clear any desk.</p>
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

const categories: { slot: AppearanceSlot; label: string }[] = [
  { slot: 'head', label: 'Head' },
  { slot: 'skin', label: 'Skin' },
  { slot: 'hair', label: 'Hair' },
  { slot: 'shirt', label: 'Shirts' },
  { slot: 'pants', label: 'Pants' },
  { slot: 'shoes', label: 'Shoes' },
  { slot: 'accessory', label: 'Accessories' },
  { slot: 'hat', label: 'Hats' },
];
const colorSlots: Partial<Record<AppearanceSlot, AppearanceSlot>> = {
  hair: 'hairColor',
  shirt: 'shirtColor',
  pants: 'pantsColor',
  shoes: 'shoesColor',
};

export function ProfileDialog({ user, onClose }: { user: Member; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [character, setCharacter] = useState(user.character),
    [appearance, setAppearance] = useState(
      () => user.appearance ?? presetAppearance(user.character),
    ),
    [category, setCategory] = useState<AppearanceSlot>('head'),
    [direction, setDirection] = useState<Direction>('down'),
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
      await api(
        '/profile',
        { displayName: data.get('displayName'), character, appearance },
        'PATCH',
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="profile-dialog"
      aria-labelledby="profile-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR CHARACTER</span>
          <h2 id="profile-title">A little more you.</h2>
        </div>
        <button aria-label="Close profile" onClick={onClose}>
          ×
        </button>
      </div>
      <form onSubmit={save}>
        <label>
          Display name
          <input name="displayName" defaultValue={user.displayName} required maxLength={40} />
        </label>
        <div className="wardrobe-layout">
          <div className="wardrobe-preview">
            <div
              className="avatar-stage"
              role="img"
              aria-label={`${direction} view of your character`}
            >
              <Avatar appearance={appearance} scale={5} direction={direction} />
            </div>
            <strong>Made by you.</strong>
            <p>Mix, match, make yourself at home.</p>
            <div className="preview-directions" role="group" aria-label="Preview direction">
              {(['down', 'left', 'up', 'right'] as const).map((value, i) => (
                <button
                  type="button"
                  key={value}
                  aria-label={`View ${['front', 'left', 'back', 'right'][i]}`}
                  aria-pressed={direction === value}
                  onClick={() => setDirection(value)}
                >
                  {['Front', 'Left', 'Back', 'Right'][i]}
                </button>
              ))}
            </div>
          </div>
          <div className="wardrobe-controls">
            <div className="wardrobe-categories" role="group" aria-label="Character parts">
              {categories.map(({ slot, label }) => (
                <button
                  type="button"
                  key={slot}
                  aria-pressed={category === slot}
                  onClick={() => setCategory(slot)}
                >
                  {label}
                </button>
              ))}
            </div>
            <fieldset className="wardrobe-options" disabled={busy}>
              <legend>{categories.find(({ slot }) => slot === category)?.label}</legend>
              <div className={category === 'skin' ? 'swatch-grid' : 'style-grid'}>
                {wardrobe[category].map((value, index) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={category === 'skin' ? `Skin tone ${index + 1}` : value}
                    aria-pressed={appearance[category] === index}
                    onClick={() => setAppearance({ ...appearance, [category]: index })}
                  >
                    {category === 'skin' ? (
                      <span className="color-swatch" style={{ backgroundColor: value }} />
                    ) : (
                      <>
                        <Avatar appearance={{ ...appearance, [category]: index }} scale={1.5} />
                        <span>{value}</span>
                      </>
                    )}
                    {category === 'skin' && <span>{index + 1}</span>}
                  </button>
                ))}
              </div>
            </fieldset>
            {colorSlots[category] && (
              <fieldset className="wardrobe-colors" disabled={busy}>
                <legend>{categories.find(({ slot }) => slot === category)?.label} color</legend>
                <div className="swatch-grid">
                  {wardrobe[colorSlots[category]!].map((color, index) => (
                    <button
                      type="button"
                      key={color}
                      aria-label={`${categories.find(({ slot }) => slot === category)?.label} color ${index + 1}`}
                      aria-pressed={appearance[colorSlots[category]!] === index}
                      onClick={() =>
                        setAppearance({ ...appearance, [colorSlots[category]!]: index })
                      }
                    >
                      <span className="color-swatch" style={{ backgroundColor: color }} />
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </div>
        <details className="wardrobe-presets">
          <summary>Start with an outfit</summary>
          <div className="character-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`Character ${i + 1}`}
                aria-pressed={
                  categories.every(({ slot }) => appearance[slot] === presetAppearance(i)[slot]) &&
                  Object.values(colorSlots).every(
                    (slot) => appearance[slot] === presetAppearance(i)[slot],
                  )
                }
                onClick={() => {
                  setCharacter(i);
                  setAppearance(presetAppearance(i));
                }}
              >
                <Avatar character={i} scale={1.5} />
              </button>
            ))}
          </div>
        </details>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </dialog>
  );
}

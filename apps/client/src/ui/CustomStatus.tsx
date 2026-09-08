import { useEffect, useMemo, useRef, useState } from 'react';
import { type CustomStatus } from '@office/shared';
import { api } from '../session/session';
import { searchStatusEmojis } from './emoji-search';

function StatusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z" />
      <path d="M7 9h8M7 13h5" />
    </svg>
  );
}

export function CustomStatusControl({
  value,
  onSaved,
}: {
  value?: CustomStatus | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', blur);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', blur);
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="custom-status-control" ref={root}>
      <button
        ref={trigger}
        className="icon-button custom-status-button"
        onClick={() => setOpen(!open)}
        title={value?.text || 'Set a custom status'}
        aria-label={value?.text ? `Edit custom status: ${value.text}` : 'Set custom status'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? 'custom-status-popover' : undefined}
      >
        {value?.emoji ? <span aria-hidden="true">{value.emoji}</span> : <StatusIcon />}
      </button>
      {open && (
        <CustomStatusPopover
          value={value}
          onClose={close}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function CustomStatusPopover({
  value,
  onClose,
  onSaved,
}: {
  value?: CustomStatus | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(value?.text ?? '');
  const [emoji, setEmoji] = useState(value?.emoji ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emojiButton = useRef<HTMLButtonElement>(null);
  const results = useMemo(() => searchStatusEmojis(query), [query]);
  const [visibleCount, setVisibleCount] = useState(140);
  function closePicker() {
    setPickerOpen(false);
    emojiButton.current?.focus();
  }
  async function save(clear = false) {
    setBusy(true);
    setError('');
    try {
      await api(
        '/custom-status',
        {
          text: clear ? '' : text.trim(),
          emoji: clear || !text.trim() ? null : emoji || null,
        },
        'PATCH',
      );
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="custom-status-popover"
      className="custom-status-popover glass"
      role="dialog"
      aria-label="Custom status"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (pickerOpen) closePicker();
          else onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <div className="custom-status-heading">
          <label htmlFor="custom-status-text">What are you working on?</label>
          <button
            type="button"
            className="icon-button"
            aria-label="Close custom status"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="custom-status-input">
          <button
            ref={emojiButton}
            type="button"
            className="icon-button"
            aria-label="Choose status emoji"
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? 'status-emoji-picker' : undefined}
            disabled={busy}
            onClick={() => {
              setPickerOpen(!pickerOpen);
              setQuery('');
              setVisibleCount(140);
            }}
          >
            {emoji ? <span aria-hidden="true">{emoji}</span> : <StatusIcon />}
          </button>
          <input
            id="custom-status-text"
            autoFocus
            maxLength={100}
            value={text}
            disabled={busy}
            placeholder="Writing something wonderful…"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        {pickerOpen && (
          <section
            id="status-emoji-picker"
            className="status-emoji-picker"
            aria-label="Status emojis"
          >
            <input
              type="search"
              autoFocus
              aria-label="Search emojis"
              placeholder="Search emojis…"
              value={query}
              maxLength={60}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(140);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (results[0]) {
                    setEmoji(results[0].emoji);
                    closePicker();
                  }
                }
              }}
            />
            <div className="status-emoji-grid" aria-label="Emoji results" key={query}>
              {results.slice(0, visibleCount).map((entry) => (
                <button
                  type="button"
                  key={entry.emoji}
                  title={entry.name}
                  aria-label={entry.name}
                  aria-pressed={emoji === entry.emoji}
                  onClick={() => {
                    setEmoji(entry.emoji);
                    closePicker();
                  }}
                >
                  {entry.emoji}
                </button>
              ))}
              {visibleCount < results.length && (
                <button
                  type="button"
                  className="emoji-show-more"
                  onClick={() => setVisibleCount((count) => count + 140)}
                >
                  Show more ({results.length - visibleCount} remaining)
                </button>
              )}
            </div>
            {results.length === 0 && (
              <p className="emoji-empty" role="status">
                No emojis found. Try another word.
              </p>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEmoji('');
                closePicker();
              }}
            >
              Remove emoji
            </button>
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="custom-status-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Clear status
          </button>
          <small>{text.length}/100</small>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </section>
  );
}

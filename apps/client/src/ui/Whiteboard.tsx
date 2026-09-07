import { useEffect, useRef, useState } from 'react';
import {
  atom,
  createPresenceStateDerivation,
  createTLStore,
  createTLUser,
  defaultShapeUtils,
  InstancePresenceRecordType,
  react,
  Tldraw,
  type Editor,
  type TLInstancePresence,
  type TLRecord,
  type TLUserPreferences,
} from 'tldraw';
import 'tldraw/tldraw.css';
import type { WhiteboardPresence, WhiteboardRecord, WhiteboardState } from '@office/shared';
import type { OfficeSession } from '../session/session';

function BoardCanvas({
  board,
  session,
  preview = false,
}: {
  board: WhiteboardState;
  session: OfficeSession;
  preview?: boolean;
}) {
  const self = session.getSnapshot().user;
  const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }));
  const [userPreferences] = useState(() =>
    atom<TLUserPreferences>('whiteboard user preferences', {
      id: self.id,
      name: self.displayName,
      color: collaboratorColor(self.id),
    }),
  );
  const [currentUser] = useState(() =>
    createTLUser({
      userPreferences,
      setUserPreferences: (preferences) => userPreferences.set(preferences),
    }),
  );
  const remoteIds = useRef(new Set<string>());
  const remotePresenceIds = useRef(new Set<string>());
  const editor = useRef<Editor | null>(null);

  useEffect(() => {
    const nextIds = new Set(board.records.map((record) => record.id));
    const removed = [...remoteIds.current].filter((id) => !nextIds.has(id));
    store.mergeRemoteChanges(() => {
      if (removed.length) store.remove(removed as TLRecord['id'][]);
      if (board.records.length) store.put(board.records as unknown as TLRecord[]);
    });
    remoteIds.current = nextIds;
    if (preview) requestAnimationFrame(() => editor.current?.zoomToFit());
  }, [board.records, preview, store]);

  useEffect(() => {
    const remote = board.presences.filter((presence) => presence.userId !== self.id);
    const nextIds = new Set(remote.map((presence) => presence.id));
    const removed = [...remotePresenceIds.current].filter((id) => !nextIds.has(id));
    store.mergeRemoteChanges(() => {
      if (removed.length) store.remove(removed as TLRecord['id'][]);
      if (remote.length) store.put(remote as unknown as TLInstancePresence[]);
    });
    remotePresenceIds.current = nextIds;
  }, [board.presences, self.id, store]);

  useEffect(() => {
    if (preview) return;
    return store.listen(
      ({ changes }) => {
        const put = [
          ...Object.values(changes.added),
          ...Object.values(changes.updated).map(([, record]) => record),
        ];
        const remove = Object.keys(changes.removed);
        if (put.length || remove.length)
          session.updateWhiteboard(board.zoneId, {
            put: put as unknown as WhiteboardRecord[],
            remove,
          });
      },
      { source: 'user', scope: 'document' },
    );
  }, [board.zoneId, preview, session, store]);

  return (
    <Tldraw
      store={store}
      user={currentUser}
      hideUi={preview}
      onMount={(mountedEditor) => {
        editor.current = mountedEditor;
        mountedEditor.updateInstanceState({ isReadonly: preview });
        if (preview) {
          mountedEditor.zoomToFit();
          return;
        }
        const presence = createPresenceStateDerivation(
          userPreferences,
          InstancePresenceRecordType.createId(self.id),
        )(store);
        let latest: TLInstancePresence | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
          timer = null;
          if (latest)
            session.updateWhiteboardPresence(board.zoneId, latest as unknown as WhiteboardPresence);
        };
        const stop = react('broadcast whiteboard presence', () => {
          latest = presence.get();
          if (latest && !timer) timer = setTimeout(flush, 32);
        });
        return () => {
          stop();
          if (timer) clearTimeout(timer);
        };
      }}
    />
  );
}

const collaboratorColors = ['#e16941', '#4263eb', '#2f9e44', '#ae3ec9', '#d98b18', '#0b7285'];
function collaboratorColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return collaboratorColors[Math.abs(hash) % collaboratorColors.length];
}

export function WhiteboardDialog({
  board,
  session,
  roomName,
  onClose,
}: {
  board: WhiteboardState;
  session: OfficeSession;
  roomName: string;
  onClose: () => void;
}) {
  return (
    <section
      className="whiteboard-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={`${roomName} whiteboard`}
    >
      <header>
        <div>
          <span className="eyebrow">LIVE WHITEBOARD</span>
          <strong>{roomName}</strong>
          <small>{board.editorIds.length} drawing now</small>
        </div>
        <button onClick={onClose} aria-label="Close whiteboard">
          ×
        </button>
      </header>
      <div className="whiteboard-canvas">
        <BoardCanvas board={board} session={session} />
      </div>
    </section>
  );
}

export function WhiteboardPreview({
  board,
  session,
  onOpen,
}: {
  board: WhiteboardState;
  session: OfficeSession;
  onOpen: () => void;
}) {
  return (
    <aside className="whiteboard-preview glass" aria-label="Active whiteboard preview">
      <div className="whiteboard-preview-heading">
        <span>
          <i /> Whiteboard live
        </span>
        <small>{board.editorIds.length} drawing</small>
      </div>
      <div className="whiteboard-preview-canvas">
        <BoardCanvas board={board} session={session} preview />
        <button onClick={onOpen} aria-label="Join this whiteboard">
          Join whiteboard
        </button>
      </div>
    </aside>
  );
}

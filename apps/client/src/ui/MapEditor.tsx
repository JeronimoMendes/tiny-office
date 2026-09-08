import React, { useEffect, useRef, useState } from 'react';
import { type SessionInfo, type TiledMap, type Workspace } from '@office/shared';
import { api } from '../session/session';

type Tool = 'select' | 'tile' | 'move-tile' | 'object';
type Selection =
  | { type: 'zone' | 'prop' | 'decor'; index: number }
  | { type: 'tile'; layerName: string; cell: number }
  | null;
type Rect = { x: number; y: number; width: number; height: number };
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type SelectedObject = { type: 'decor' | 'prop'; index: number };
type SpaceClipboard = {
  zone: EditorObject;
  decor: EditorObject[];
  props: EditorObject[];
};
type DecorChoice = {
  name: string;
  label: string;
  // Tile-backed decor names its first GID; hand-drawn decor names a PNG in
  // assets/sprites and is placed whole instead of assembled from cells.
  gid?: number;
  sprite?: string;
  width: number;
  height?: number;
  solid?: boolean;
};
type WorkspaceSummary = { id: string; name: string; mapRevision: string };
type PropsManifest = {
  cell: number;
  columns: number;
  scale: number;
  anchor: [number, number];
  items: { name: string; label: string; frame: number }[];
};
type EditorLayer = TiledMap['layers'][number];
type EditorObject = NonNullable<EditorLayer['objects']>[number];

const clone = <T,>(value: T): T => structuredClone(value);
const property = (object: EditorObject, name: string) =>
  object.properties.find((item) => item.name === name)?.value;
const setProperty = (object: EditorObject, name: string, value: string | number | boolean) => {
  const existing = object.properties.find((item) => item.name === name);
  if (existing) existing.value = value;
  else object.properties.push({ name, value });
};
const decorChoices: DecorChoice[] = [
  { name: 'rug', label: 'Large rug', gid: 10, width: 3, height: 3 },
  { name: 'cat-rug', label: 'Cat rug', sprite: 'cat-rug', width: 2, height: 2 },
  { name: 'desk', label: 'Large desk', gid: 19, width: 2, solid: true },
  { name: 'couch', label: 'Couch', gid: 21, width: 2, solid: true },
  { name: 'table', label: 'Large table', gid: 23, width: 2, solid: true },
  { name: 'counter', label: 'Counter', gid: 25, width: 2, solid: true },
  { name: 'chair-up', label: 'Chair (up)', gid: 27, width: 1, solid: true },
  { name: 'chair-down', label: 'Chair (down)', gid: 28, width: 1, solid: true },
  { name: 'plant-tall', label: 'Tall flower pot', gid: 29, width: 1, solid: true },
  { name: 'plant-small', label: 'Small flower pot', gid: 30, width: 1, solid: true },
  {
    name: 'monstera',
    label: 'Monstera',
    sprite: 'monstera',
    width: 1,
    height: 2,
    solid: true,
  },
  {
    name: 'ultrawide-monitor',
    label: 'Ultrawide monitor',
    sprite: 'ultrawide-monitor',
    width: 2,
    height: 1,
  },
  {
    name: 'wind-turbine',
    label: 'Wind turbine',
    sprite: 'wind-turbine',
    width: 1,
    height: 2,
  },
  { name: 'bookshelf', label: 'Bookshelf', gid: 31, width: 1, solid: true },
  { name: 'cabinet', label: 'Cabinet', gid: 32, width: 1, solid: true },
  { name: 'cooler', label: 'Water cooler', gid: 33, width: 1, solid: true },
  { name: 'stool', label: 'Stool', gid: 34, width: 1, solid: true },
  { name: 'floor-lamp', label: 'Floor lamp', gid: 35, width: 1, solid: true },
  { name: 'divider', label: 'Divider', gid: 36, width: 1, solid: true },
];

function normalizeDecor(input: TiledMap) {
  const map = clone(input);
  if (map.layers.some((layer) => layer.name === 'decor')) return { map, converted: false };
  const furniture = map.layers.find(
    (layer) => layer.name === 'furniture' && layer.type === 'tilelayer',
  );
  const rugs = map.layers.find((layer) => layer.name === 'rug' && layer.type === 'tilelayer');
  if (
    (!furniture?.data?.some((value) => value >= 19) && !rugs?.data?.some(Boolean)) ||
    map.tilesets[0].tilecount < 36
  )
    return { map, converted: false };
  const collision = map.layers.find((layer) => layer.name === 'collision');
  let id = Math.max(
    0,
    ...map.layers.flatMap((layer) => layer.objects?.map((object) => object.id) ?? []),
  );
  const objects: EditorObject[] = [];
  const add = (
    name: string,
    x: number,
    y: number,
    columns: number,
    data: number[],
    cells: number[],
    transferCollision = true,
  ) => {
    const solid = transferCollision && cells.some((cell) => Boolean(collision?.data?.[cell]));
    if (transferCollision) for (const cell of cells) if (collision?.data) collision.data[cell] = 0;
    objects.push({
      id: ++id,
      name,
      x,
      y,
      width: columns * 32,
      height: (data.length / columns) * 32,
      rotation: 0,
      properties: [
        { name: 'tileData', value: JSON.stringify(data) },
        { name: 'columns', value: columns },
        { name: 'solid', value: solid },
      ],
    });
  };
  if (furniture?.data) {
    for (let cell = 0; cell < furniture.data.length; cell++) {
      const gid = furniture.data[cell];
      if (gid < 19) continue;
      const choice = decorChoices.find((item) => item.gid === gid);
      const width = choice?.width ?? 1;
      const cells = Array.from({ length: width }, (_, offset) => cell + offset);
      const data = cells.map((index) => furniture.data![index]);
      add(
        choice?.label ?? `Decor ${gid}`,
        (cell % map.width) * 32,
        Math.floor(cell / map.width) * 32,
        width,
        data,
        cells,
      );
      for (const index of cells) furniture.data[index] = 0;
    }
    furniture.name = 'structure';
  }
  if (rugs?.data) {
    for (let cell = 0; cell < rugs.data.length; cell++) {
      if (!rugs.data[cell]) continue;
      const component = new Set<number>([cell]);
      const pending = [cell];
      while (pending.length) {
        const current = pending.pop()!;
        const column = current % map.width;
        const neighbors = [
          current - map.width,
          current + map.width,
          ...(column > 0 ? [current - 1] : []),
          ...(column + 1 < map.width ? [current + 1] : []),
        ];
        for (const neighbor of neighbors)
          if (
            neighbor >= 0 &&
            neighbor < rugs.data.length &&
            rugs.data[neighbor] &&
            !component.has(neighbor)
          ) {
            component.add(neighbor);
            pending.push(neighbor);
          }
      }
      const cells = [...component];
      const minColumn = Math.min(...cells.map((index) => index % map.width));
      const maxColumn = Math.max(...cells.map((index) => index % map.width));
      const minRow = Math.min(...cells.map((index) => Math.floor(index / map.width)));
      const maxRow = Math.max(...cells.map((index) => Math.floor(index / map.width)));
      const columns = maxColumn - minColumn + 1;
      const data = Array.from({ length: (maxRow - minRow + 1) * columns }, (_, index) => {
        const column = minColumn + (index % columns);
        const row = minRow + Math.floor(index / columns);
        return rugs.data![row * map.width + column];
      });
      add('Rug', minColumn * 32, minRow * 32, columns, data, cells, false);
      for (const index of cells) rugs.data[index] = 0;
    }
    map.layers = map.layers.filter((layer) => layer !== rugs);
  }
  const deskZones =
    map.layers.find((layer) => layer.name === 'zones' && layer.type === 'objectgroup')?.objects ??
    [];
  for (const object of objects) {
    if (object.name !== 'Large desk') continue;
    const centerX = object.x + object.width / 2;
    const centerY = object.y + object.height / 2;
    const desk = deskZones.find(
      (zone) =>
        property(zone, 'kind') === 'desk' &&
        centerX >= zone.x &&
        centerX < zone.x + zone.width &&
        centerY >= zone.y &&
        centerY < zone.y + zone.height,
    );
    const deskId = desk && property(desk, 'zoneId');
    if (deskId) object.properties.push({ name: 'deskId', value: deskId });
  }
  const zoneIndex = map.layers.findIndex((layer) => layer.name === 'zones');
  map.layers.splice(zoneIndex < 0 ? map.layers.length : zoneIndex, 0, {
    name: 'decor',
    type: 'objectgroup',
    objects,
    offsetx: 0,
    offsety: 0,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
  });
  return { map, converted: true };
}

export function MapEditor({ info }: { info: SessionInfo }) {
  const initialDraft = useRef(normalizeDecor(info.workspace.map));
  const [workspace, setWorkspace] = useState(info.workspace);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([
    {
      id: info.workspace.id,
      name: info.workspace.name,
      mapRevision: info.workspace.mapRevision,
    },
  ]);
  const [draft, setDraft] = useState<TiledMap>(() => initialDraft.current.map);
  const [manifest, setManifest] = useState<PropsManifest | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [layerName, setLayerName] = useState(
    () =>
      info.workspace.map.layers.find((layer) => layer.type === 'tilelayer' && layer.visible)
        ?.name ?? 'collision',
  );
  const [gid, setGid] = useState(1);
  const [propName, setPropName] = useState('monitor');
  const [decorChoice, setDecorChoice] = useState<DecorChoice | null>(null);
  const [deskScope, setDeskScope] = useState('map');
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedObjects, setSelectedObjects] = useState<SelectedObject[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [dirty, setDirty] = useState(initialDraft.current.converted);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(
    initialDraft.current.converted
      ? 'Legacy furniture was converted to movable objects. Save to apply.'
      : '',
  );
  const [zoom, setZoom] = useState(1);
  const [invalidPlacement, setInvalidPlacement] = useState<Rect | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<HTMLImageElement | null>(null);
  const props = useRef<HTMLImageElement | null>(null);
  const sprites = useRef(new Map<string, HTMLImageElement>());
  const drag = useRef<{
    x: number;
    y: number;
    objectX?: number;
    objectY?: number;
    sourceCell?: number;
    sourceLayer?: string;
    resize?: ResizeHandle;
    objectWidth?: number;
    objectHeight?: number;
    attachedDecor?: number[];
    attachedProps?: number[];
    group?: (SelectedObject & { x: number; y: number; width: number; height: number })[];
  } | null>(null);
  const spaceClipboard = useRef<SpaceClipboard | null>(null);

  // Keep invalid intermediate layouts editable (for example while dragging one
  // room past another). The server validates the complete draft on save.
  const parsed = { width: draft.width * 32, height: draft.height * 32 };
  const tileLayers = draft.layers.filter((layer) => layer.type === 'tilelayer');
  const zonesLayer = draft.layers.find(
    (layer) => layer.name === 'zones' && layer.type === 'objectgroup',
  );
  const propsLayer = draft.layers.find(
    (layer) => layer.name === 'props' && layer.type === 'objectgroup',
  );
  const decorLayer = draft.layers.find(
    (layer) => layer.name === 'decor' && layer.type === 'objectgroup',
  );
  const zones = zonesLayer?.objects ?? [];
  const deskZones = zones.filter((zone) => property(zone, 'kind') === 'desk');
  const isObjectSelected = (type: SelectedObject['type'], index: number) =>
    selectedObjects.some((selected) => selected.type === type && selected.index === index);

  useEffect(() => {
    void api<{ workspaces: WorkspaceSummary[] }>('/editor/workspaces')
      .then((result) => setWorkspaces(result.workspaces))
      .catch((error: Error) => setMessage(error.message));
    void fetch('/assets/props.json')
      .then((response) => response.json())
      .then((value) => {
        setManifest(value as PropsManifest);
        setPropName((value as PropsManifest).items[0]?.name ?? 'monitor');
      });
  }, []);
  useEffect(() => {
    const image = new Image();
    image.src = `/assets/${draft.tilesets[0].image.split('/').pop()}`;
    image.onload = () => {
      tiles.current = image;
      draw();
    };
    const propImage = new Image();
    propImage.src = '/assets/props.png';
    propImage.onload = () => {
      props.current = propImage;
      draw();
    };
    // Hand-drawn decor is one PNG per piece, so the palette and the canvas both
    // need every sprite a choice can place.
    for (const { sprite } of decorChoices) {
      if (!sprite || sprites.current.has(sprite)) continue;
      const image = new Image();
      image.src = `/assets/sprites/${sprite}.png`;
      image.onload = () => {
        sprites.current.set(sprite, image);
        draw();
      };
    }
  }, [draft.tilesets]);
  useEffect(() => {
    draw();
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (selection && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault();
        removeSelection();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        if (selection?.type !== 'zone') return;
        event.preventDefault();
        copySpace();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        if (!spaceClipboard.current) return;
        event.preventDefault();
        pasteSpace();
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [selection, draft]);

  function draw() {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, parsed.width, parsed.height);
    const sheet = tiles.current;
    const columns = draft.tilesets[0].columns;
    for (const layer of draft.layers) {
      if (layer.type !== 'tilelayer' || !layer.visible || layer.name === 'collision' || !sheet)
        continue;
      layer.data?.forEach((tile, index) => {
        if (!tile) return;
        const frame = tile - 1;
        context.globalAlpha = layer.opacity;
        context.drawImage(
          sheet,
          (frame % columns) * 32,
          Math.floor(frame / columns) * 32,
          32,
          32,
          (index % draft.width) * 32,
          Math.floor(index / draft.width) * 32,
          32,
          32,
        );
      });
    }
    context.globalAlpha = 1;
    if (sheet) {
      for (const object of decorLayer?.objects ?? []) {
        const sprite = property(object, 'sprite');
        context.save();
        context.translate(object.x + object.width / 2, object.y + object.height / 2);
        context.rotate((object.rotation * Math.PI) / 180);
        const drawn = sprite ? sprites.current.get(String(sprite)) : undefined;
        if (drawn)
          context.drawImage(
            drawn,
            -object.width / 2,
            -object.height / 2,
            object.width,
            object.height,
          );
        const data = sprite ? [] : (JSON.parse(String(property(object, 'tileData'))) as number[]);
        const objectColumns = Number(property(object, 'columns'));
        data.forEach((tile, index) => {
          if (!tile) return;
          const frame = tile - 1;
          context.drawImage(
            sheet,
            (frame % columns) * 32,
            Math.floor(frame / columns) * 32,
            32,
            32,
            -object.width / 2 + (index % objectColumns) * 32,
            -object.height / 2 + Math.floor(index / objectColumns) * 32,
            32,
            32,
          );
        });
        if (isObjectSelected('decor', decorLayer?.objects?.indexOf(object) ?? -1)) {
          context.strokeStyle = '#fff3b0';
          context.lineWidth = 3;
          context.strokeRect(-object.width / 2, -object.height / 2, object.width, object.height);
        }
        context.restore();
      }
    }
    const collision = draft.layers.find((layer) => layer.name === 'collision');
    if (layerName === 'collision') {
      context.fillStyle = '#dc776855';
      collision?.data?.forEach((tile, index) => {
        if (tile)
          context.fillRect(
            (index % draft.width) * 32,
            Math.floor(index / draft.width) * 32,
            32,
            32,
          );
      });
    }
    if (manifest && props.current) {
      const byName = new Map(manifest.items.map((item) => [item.name, item.frame]));
      for (const object of propsLayer?.objects ?? []) {
        const frame = byName.get(String(property(object, 'prop')));
        if (frame === undefined) continue;
        context.save();
        context.translate(object.x, object.y);
        context.rotate((object.rotation * Math.PI) / 180);
        context.drawImage(
          props.current,
          (frame % manifest.columns) * manifest.cell,
          Math.floor(frame / manifest.columns) * manifest.cell,
          manifest.cell,
          manifest.cell,
          -manifest.anchor[0] * 32,
          -manifest.anchor[1] * 32,
          32,
          32,
        );
        context.restore();
      }
    }
    zones.forEach((zone, index) => {
      const kind = String(property(zone, 'kind'));
      context.fillStyle = kind === 'desk' ? '#dbc9852a' : '#a8c8db22';
      context.strokeStyle =
        selection?.type === 'zone' && selection.index === index
          ? '#fff3b0'
          : kind === 'desk'
            ? '#dbc985'
            : '#a8c8db';
      context.lineWidth = selection?.type === 'zone' && selection.index === index ? 3 : 1;
      context.fillRect(zone.x, zone.y, zone.width, zone.height);
      context.strokeRect(zone.x + 1, zone.y + 1, zone.width - 2, zone.height - 2);
      context.fillStyle = '#fff';
      context.font = '11px system-ui';
      context.fillText(zone.name || String(property(zone, 'zoneId')), zone.x + 6, zone.y + 15);
      if (selection?.type === 'zone' && selection.index === index) {
        context.fillStyle = '#fff3b0';
        context.strokeStyle = '#554d2f';
        for (const handle of resizeHandlePoints(zone)) {
          context.fillRect(handle.x - 5, handle.y - 5, 10, 10);
          context.strokeRect(handle.x - 5, handle.y - 5, 10, 10);
        }
      }
    });
    for (const selected of selectedObjects) {
      if (selected.type !== 'prop') continue;
      const object = propsLayer?.objects?.[selected.index];
      if (object) {
        context.strokeStyle = '#fff3b0';
        context.lineWidth = 2;
        context.strokeRect(object.x - 17, object.y - 27, 34, 34);
      }
    }
    if (selection?.type === 'tile') {
      context.strokeStyle = '#fff3b0';
      context.lineWidth = 3;
      context.strokeRect(
        (selection.cell % draft.width) * 32 + 1,
        Math.floor(selection.cell / draft.width) * 32 + 1,
        30,
        30,
      );
    }
    if (invalidPlacement) {
      context.fillStyle = '#e44f4555';
      context.strokeStyle = '#ff695e';
      context.lineWidth = 3;
      context.fillRect(
        invalidPlacement.x,
        invalidPlacement.y,
        invalidPlacement.width,
        invalidPlacement.height,
      );
      context.strokeRect(
        invalidPlacement.x + 1,
        invalidPlacement.y + 1,
        invalidPlacement.width - 2,
        invalidPlacement.height - 2,
      );
    }
    context.strokeStyle = '#ffffff14';
    context.lineWidth = 1;
    for (let x = 0; x <= parsed.width; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, parsed.height);
      context.stroke();
    }
    for (let y = 0; y <= parsed.height; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(parsed.width, y);
      context.stroke();
    }
  }

  function resizeHandlePoints(zone: Rect) {
    const centerX = zone.x + zone.width / 2;
    const centerY = zone.y + zone.height / 2;
    return [
      { handle: 'nw' as const, x: zone.x, y: zone.y },
      { handle: 'n' as const, x: centerX, y: zone.y },
      { handle: 'ne' as const, x: zone.x + zone.width, y: zone.y },
      { handle: 'e' as const, x: zone.x + zone.width, y: centerY },
      { handle: 'se' as const, x: zone.x + zone.width, y: zone.y + zone.height },
      { handle: 's' as const, x: centerX, y: zone.y + zone.height },
      { handle: 'sw' as const, x: zone.x, y: zone.y + zone.height },
      { handle: 'w' as const, x: zone.x, y: centerY },
    ];
  }
  function resizeHandleAt(zone: Rect, x: number, y: number) {
    return resizeHandlePoints(zone).find(
      (point) => Math.abs(point.x - x) <= 8 && Math.abs(point.y - y) <= 8,
    )?.handle;
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(parsed.width - 0.01, ((event.clientX - rect.left) * parsed.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(parsed.height - 0.01, ((event.clientY - rect.top) * parsed.height) / rect.height),
      ),
    };
  }
  function mutate(change: (map: TiledMap) => void) {
    setDraft((current) => {
      const next = clone(current);
      change(next);
      return next;
    });
    setDirty(true);
    setMessage('Unsaved changes');
  }
  function cellAt(x: number, y: number) {
    return Math.floor(y / 32) * draft.width + Math.floor(x / 32);
  }
  function topTile(cell: number) {
    if (layerName === 'collision') {
      const collision = tileLayers.find((layer) => layer.name === 'collision');
      if (collision?.data?.[cell]) return collision;
    }
    return [...tileLayers]
      .reverse()
      .find((layer) => layer.visible && layer.name !== 'collision' && Boolean(layer.data?.[cell]));
  }
  function overlaps(a: Rect, b: Rect) {
    return (
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    );
  }
  function validZone(candidate: Rect, selectedIndex = -1) {
    if (
      candidate.x < 0 ||
      candidate.y < 0 ||
      candidate.x + candidate.width > parsed.width ||
      candidate.y + candidate.height > parsed.height
    )
      return false;
    return !zones.some(
      (zone, index) =>
        index !== selectedIndex && property(zone, 'kind') !== 'open' && overlaps(candidate, zone),
    );
  }
  function paint(x: number, y: number) {
    mutate((map) => {
      const layer = map.layers.find((candidate) => candidate.name === layerName);
      if (layer?.data) layer.data[cellAt(x, y)] = layerName === 'collision' && gid ? 1 : gid;
    });
  }
  function objectInside(object: EditorObject, zone: Rect) {
    const centerX = object.x + object.width / 2;
    const centerY = object.y + object.height / 2;
    return (
      centerX >= zone.x &&
      centerX < zone.x + zone.width &&
      centerY >= zone.y &&
      centerY < zone.y + zone.height
    );
  }
  function attachmentsInside(zone: Rect) {
    return {
      attachedDecor: (decorLayer?.objects ?? []).flatMap((object, index) =>
        objectInside(object, zone) ? [index] : [],
      ),
      attachedProps: (propsLayer?.objects ?? []).flatMap((object, index) =>
        objectInside(object, zone) ? [index] : [],
      ),
    };
  }
  function hit(x: number, y: number): Selection {
    for (let index = (propsLayer?.objects?.length ?? 0) - 1; index >= 0; index--) {
      const object = propsLayer!.objects![index];
      if (Math.abs(x - object.x) < 18 && Math.abs(y - object.y + 10) < 20)
        return { type: 'prop', index };
    }
    for (let index = (decorLayer?.objects?.length ?? 0) - 1; index >= 0; index--) {
      const object = decorLayer!.objects![index];
      if (
        x >= object.x &&
        x <= object.x + object.width &&
        y >= object.y &&
        y <= object.y + object.height
      )
        return { type: 'decor', index };
    }
    for (let index = zones.length - 1; index >= 0; index--) {
      const zone = zones[index];
      if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height)
        return { type: 'zone', index };
    }
    return null;
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event);
    if (tool === 'select' && selection?.type === 'zone') {
      const zone = zones[selection.index];
      const resize = zone && resizeHandleAt(zone, at.x, at.y);
      if (zone && resize) {
        setSelectedObjects([]);
        drag.current = {
          ...at,
          objectX: zone.x,
          objectY: zone.y,
          objectWidth: zone.width,
          objectHeight: zone.height,
          resize,
        };
        return;
      }
      if (
        zone &&
        at.x >= zone.x &&
        at.x <= zone.x + zone.width &&
        at.y >= zone.y &&
        at.y <= zone.y + zone.height
      ) {
        setSelectedObjects([]);
        drag.current = {
          ...at,
          objectX: zone.x,
          objectY: zone.y,
          objectWidth: zone.width,
          objectHeight: zone.height,
          ...attachmentsInside(zone),
        };
        return;
      }
    }
    if (tool === 'tile') {
      paint(at.x, at.y);
      return;
    }
    if (tool === 'move-tile') {
      const cell = cellAt(at.x, at.y);
      const sourceLayer = topTile(cell);
      if (!sourceLayer) {
        setMessage('There is no tile in this cell to move.');
        setSelection(null);
        return;
      }
      setLayerName(sourceLayer.name);
      setSelectedObjects([]);
      setSelection({ type: 'tile', layerName: sourceLayer.name, cell });
      drag.current = { ...at, sourceCell: cell, sourceLayer: sourceLayer.name };
      return;
    }
    if (tool === 'object') {
      if (decorChoice) {
        const width = decorChoice.width * 32;
        const height = (decorChoice.height ?? 1) * 32;
        const x = Math.max(0, Math.min(parsed.width - width, at.x - width / 2));
        const y = Math.max(0, Math.min(parsed.height - height, at.y - height / 2));
        mutate((map) => {
          const layer = map.layers.find(
            (candidate) => candidate.name === 'decor' && candidate.type === 'objectgroup',
          );
          if (!layer?.objects) return;
          const id =
            Math.max(
              0,
              ...map.layers.flatMap(
                (candidate) => candidate.objects?.map((object) => object.id) ?? [],
              ),
            ) + 1;
          const count = decorChoice.width * (decorChoice.height ?? 1);
          layer.objects.push({
            id,
            name: decorChoice.label,
            x,
            y,
            width,
            height,
            rotation: 0,
            properties: decorChoice.sprite
              ? [
                  { name: 'sprite', value: decorChoice.sprite },
                  { name: 'solid', value: decorChoice.solid ?? false },
                ]
              : [
                  {
                    name: 'tileData',
                    value: JSON.stringify(
                      Array.from({ length: count }, (_, index) => decorChoice.gid! + index),
                    ),
                  },
                  { name: 'columns', value: decorChoice.width },
                  { name: 'solid', value: decorChoice.solid ?? false },
                ],
          });
          const index = layer.objects.length - 1;
          setSelection({ type: 'decor', index });
          setSelectedObjects([{ type: 'decor', index }]);
        });
        setTool('select');
        return;
      }
      const desk =
        deskScope === 'map'
          ? null
          : deskZones.find((zone) => property(zone, 'zoneId') === deskScope);
      if (
        desk &&
        !(
          at.x >= desk.x &&
          at.x <= desk.x + desk.width &&
          at.y >= desk.y &&
          at.y <= desk.y + desk.height
        )
      ) {
        setInvalidPlacement({ x: at.x - 16, y: at.y - 26, width: 32, height: 32 });
        setMessage('Place this personal item inside its selected desk.');
        return;
      }
      mutate((map) => {
        let layer = map.layers.find(
          (candidate) => candidate.name === 'props' && candidate.type === 'objectgroup',
        );
        if (!layer) {
          layer = {
            name: 'props',
            type: 'objectgroup',
            objects: [],
            offsetx: 0,
            offsety: 0,
            x: 0,
            y: 0,
            opacity: 1,
            visible: true,
          };
          map.layers.push(layer);
        }
        const id =
          Math.max(
            0,
            ...map.layers.flatMap(
              (candidate) => candidate.objects?.map((object) => object.id) ?? [],
            ),
          ) + 1;
        const properties: EditorObject['properties'] = [{ name: 'prop', value: propName }];
        if (deskScope !== 'map') properties.push({ name: 'deskId', value: deskScope });
        layer.objects!.push({
          id,
          name: propName,
          x: at.x,
          y: at.y,
          width: 0,
          height: 0,
          rotation: 0,
          point: true,
          properties,
        });
        const index = layer.objects!.length - 1;
        setSelection({ type: 'prop', index });
        setSelectedObjects([{ type: 'prop', index }]);
      });
      setTool('select');
      return;
    }
    const selected = hit(at.x, at.y);
    setInvalidPlacement(null);
    if (selected?.type === 'decor' || selected?.type === 'prop') {
      const candidate: SelectedObject = { type: selected.type, index: selected.index };
      const alreadySelected = isObjectSelected(candidate.type, candidate.index);
      if (event.shiftKey && alreadySelected) {
        const remaining = selectedObjects.filter(
          (item) => item.type !== candidate.type || item.index !== candidate.index,
        );
        setSelectedObjects(remaining);
        setSelection(remaining.at(-1) ?? null);
        drag.current = null;
        return;
      }
      const group =
        multiSelect || event.shiftKey
          ? alreadySelected
            ? selectedObjects
            : [...selectedObjects, candidate]
          : [candidate];
      setSelectedObjects(group);
      setSelection(candidate);
      const objects = group.flatMap((item) => {
        const object =
          item.type === 'decor'
            ? decorLayer?.objects?.[item.index]
            : propsLayer?.objects?.[item.index];
        return object
          ? [{ ...item, x: object.x, y: object.y, width: object.width, height: object.height }]
          : [];
      });
      const object = objects.find(
        (item) => item.type === candidate.type && item.index === candidate.index,
      );
      drag.current = object
        ? {
            ...at,
            objectX: object.x,
            objectY: object.y,
            objectWidth: object.width,
            objectHeight: object.height,
            group: objects,
          }
        : null;
      return;
    }
    setSelection(selected);
    setSelectedObjects([]);
    if (selected?.type === 'zone') {
      const zone = zones[selected.index];
      drag.current = zone
        ? {
            ...at,
            objectX: zone.x,
            objectY: zone.y,
            objectWidth: zone.width,
            objectHeight: zone.height,
            ...attachmentsInside(zone),
          }
        : null;
    } else drag.current = null;
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const at = point(event);
    if (!(event.buttons & 1)) {
      const zone = selection?.type === 'zone' ? zones[selection.index] : null;
      const handle = zone && tool === 'select' ? resizeHandleAt(zone, at.x, at.y) : null;
      event.currentTarget.style.cursor = handle
        ? handle === 'n' || handle === 's'
          ? 'ns-resize'
          : handle === 'e' || handle === 'w'
            ? 'ew-resize'
            : handle === 'ne' || handle === 'sw'
              ? 'nesw-resize'
              : 'nwse-resize'
        : tool === 'select'
          ? 'default'
          : 'crosshair';
      return;
    }
    if (tool === 'tile') {
      paint(at.x, at.y);
      return;
    }
    if (tool !== 'select' || !selection || !drag.current) return;
    if (selection.type === 'tile') return;
    const object =
      selection.type === 'zone'
        ? zones[selection.index]
        : selection.type === 'decor'
          ? decorLayer?.objects?.[selection.index]
          : propsLayer?.objects?.[selection.index];
    if (!object) return;
    const dx = at.x - drag.current.x;
    const dy = at.y - drag.current.y;
    if (drag.current.group && selection.type !== 'zone') {
      const group = drag.current.group;
      const minX = Math.min(...group.map((item) => item.x));
      const minY = Math.min(...group.map((item) => item.y));
      const maxX = Math.max(...group.map((item) => item.x + item.width));
      const maxY = Math.max(...group.map((item) => item.y + item.height));
      const translateX = Math.max(-minX, Math.min(parsed.width - maxX, dx));
      const translateY = Math.max(-minY, Math.min(parsed.height - maxY, dy));
      mutate((map) => {
        for (const item of group) {
          const layer = map.layers.find(
            (candidate) => candidate.name === (item.type === 'decor' ? 'decor' : 'props'),
          );
          const object = layer?.objects?.[item.index];
          if (!object) continue;
          object.x = item.x + translateX;
          object.y = item.y + translateY;
        }
      });
      return;
    }
    const origin = {
      x: drag.current.objectX ?? object.x,
      y: drag.current.objectY ?? object.y,
      width: drag.current.objectWidth ?? object.width,
      height: drag.current.objectHeight ?? object.height,
    };
    const next = { ...origin };
    if (selection.type === 'zone' && drag.current.resize) {
      const resize = drag.current.resize;
      if (resize.includes('e')) next.width = Math.max(32, Math.round((origin.width + dx) / 8) * 8);
      if (resize.includes('s'))
        next.height = Math.max(32, Math.round((origin.height + dy) / 8) * 8);
      if (resize.includes('w')) {
        const width = Math.max(32, Math.round((origin.width - dx) / 8) * 8);
        next.x = origin.x + origin.width - width;
        next.width = width;
      }
      if (resize.includes('n')) {
        const height = Math.max(32, Math.round((origin.height - dy) / 8) * 8);
        next.y = origin.y + origin.height - height;
        next.height = height;
      }
    } else {
      next.x += dx;
      next.y += dy;
    }
    if (selection.type === 'zone' && !validZone(next, selection.index)) {
      setInvalidPlacement(next);
      setMessage('Spaces cannot overlap or extend beyond the map.');
      return;
    }
    setInvalidPlacement(null);
    mutate((map) => {
      const layer = map.layers.find(
        (candidate) =>
          candidate.name ===
          (selection.type === 'zone' ? 'zones' : selection.type === 'decor' ? 'decor' : 'props'),
      );
      const moved = layer?.objects?.[selection.index];
      if (!moved) return;
      const previous = { x: moved.x, y: moved.y };
      moved.x = Math.max(0, Math.min(parsed.width - next.width, next.x));
      moved.y = Math.max(0, Math.min(parsed.height - next.height, next.y));
      moved.width = next.width;
      moved.height = next.height;
      if (selection.type === 'zone' && !drag.current?.resize) {
        const deltaX = moved.x - previous.x;
        const deltaY = moved.y - previous.y;
        const decor = map.layers.find((candidate) => candidate.name === 'decor')?.objects ?? [];
        const props = map.layers.find((candidate) => candidate.name === 'props')?.objects ?? [];
        for (const index of drag.current?.attachedDecor ?? []) {
          decor[index].x += deltaX;
          decor[index].y += deltaY;
        }
        for (const index of drag.current?.attachedProps ?? []) {
          props[index].x += deltaX;
          props[index].y += deltaY;
        }
      }
    });
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'move-tile' && drag.current?.sourceCell !== undefined) {
      const destination = cellAt(point(event).x, point(event).y);
      const source = drag.current.sourceCell;
      const sourceLayer = drag.current.sourceLayer;
      if (destination !== source && sourceLayer)
        mutate((map) => {
          const layer = map.layers.find((candidate) => candidate.name === sourceLayer);
          if (!layer?.data) return;
          const destinationTile = layer.data[destination];
          layer.data[destination] = layer.data[source];
          layer.data[source] = destinationTile;
          // Furniture and wall tiles carry their collision cell with them so a
          // visually moved desk does not leave an invisible obstacle behind.
          if (sourceLayer !== 'floor' && sourceLayer !== 'rug' && sourceLayer !== 'collision') {
            const collision = map.layers.find((candidate) => candidate.name === 'collision');
            if (collision?.data?.[source]) {
              const destinationCollision = collision.data[destination];
              collision.data[destination] = collision.data[source];
              collision.data[source] = destinationCollision;
            }
          }
          setSelection({ type: 'tile', layerName: sourceLayer, cell: destination });
        });
    }
    drag.current = null;
    setInvalidPlacement(null);
  }
  function copySpace() {
    if (selection?.type !== 'zone') return;
    const zone = zones[selection.index];
    if (!zone) return;
    const inside = (object: EditorObject) => {
      const centerX = object.x + object.width / 2;
      const centerY = object.y + object.height / 2;
      return (
        centerX >= zone.x &&
        centerX < zone.x + zone.width &&
        centerY >= zone.y &&
        centerY < zone.y + zone.height
      );
    };
    spaceClipboard.current = {
      zone: clone(zone),
      decor: clone((decorLayer?.objects ?? []).filter(inside)),
      props: clone((propsLayer?.objects ?? []).filter(inside)),
    };
    setHasClipboard(true);
    setMessage(
      `Copied ${zone.name} with ${spaceClipboard.current.decor.length + spaceClipboard.current.props.length} objects.`,
    );
  }
  function pasteSpace() {
    const copied = spaceClipboard.current;
    if (!copied) return;
    const candidates: { x: number; y: number; distance: number }[] = [];
    const preferredX = copied.zone.x + 32;
    const preferredY = copied.zone.y + 32;
    for (let y = 0; y + copied.zone.height <= parsed.height; y += 32)
      for (let x = 0; x + copied.zone.width <= parsed.width; x += 32) {
        const candidate = { x, y, width: copied.zone.width, height: copied.zone.height };
        if (validZone(candidate))
          candidates.push({ x, y, distance: Math.hypot(x - preferredX, y - preferredY) });
      }
    const target = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!target) {
      setMessage('There is no free area large enough to paste this space.');
      return;
    }
    const offsetX = target.x - copied.zone.x;
    const offsetY = target.y - copied.zone.y;
    mutate((map) => {
      let nextId =
        Math.max(
          0,
          ...map.layers.flatMap((layer) => layer.objects?.map((object) => object.id) ?? []),
        ) + 1;
      const zonesLayer = map.layers.find((layer) => layer.name === 'zones');
      if (!zonesLayer?.objects) return;
      const originalId = String(property(copied.zone, 'zoneId'));
      const ids = new Set(zonesLayer.objects.map((zone) => String(property(zone, 'zoneId'))));
      let suffix = 1;
      let copiedId = `${originalId}-copy`;
      while (ids.has(copiedId)) copiedId = `${originalId}-copy-${++suffix}`;
      const zone = clone(copied.zone);
      zone.id = nextId++;
      zone.name = `${zone.name} copy`;
      zone.x = target.x;
      zone.y = target.y;
      setProperty(zone, 'zoneId', copiedId);
      zonesLayer.objects.push(zone);
      const appendObjects = (layerName: 'decor' | 'props', objects: EditorObject[]) => {
        const layer = map.layers.find((candidate) => candidate.name === layerName);
        if (!layer?.objects) return;
        for (const source of objects) {
          const object = clone(source);
          object.id = nextId++;
          object.x += offsetX;
          object.y += offsetY;
          if (property(object, 'deskId') === originalId) setProperty(object, 'deskId', copiedId);
          if (property(object, 'surface') === originalId) setProperty(object, 'surface', copiedId);
          layer.objects.push(object);
        }
      };
      appendObjects('decor', copied.decor);
      appendObjects('props', copied.props);
      setSelectedObjects([]);
      setSelection({ type: 'zone', index: zonesLayer.objects.length - 1 });
    });
    setTool('select');
    setMessage('Pasted the space with its furniture and items.');
  }
  function addZone(kind: 'desk' | 'meeting') {
    const width = kind === 'desk' ? 96 : 192;
    const height = kind === 'desk' ? 96 : 160;
    let position: { x: number; y: number } | null = null;
    for (let y = 0; y + height <= parsed.height && !position; y += 32)
      for (let x = 0; x + width <= parsed.width; x += 32)
        if (validZone({ x, y, width, height })) {
          position = { x, y };
          break;
        }
    if (!position) {
      setMessage(`There is no free area large enough for another ${kind}.`);
      return;
    }
    mutate((map) => {
      const layer = map.layers.find((candidate) => candidate.name === 'zones');
      if (!layer?.objects) return;
      const existing = new Set(layer.objects.map((zone) => String(property(zone, 'zoneId'))));
      let number = 1;
      while (existing.has(`${kind}-${number}`)) number++;
      const id =
        Math.max(
          0,
          ...map.layers.flatMap((candidate) => candidate.objects?.map((object) => object.id) ?? []),
        ) + 1;
      layer.objects.push({
        id,
        name: kind === 'desk' ? `Desk ${number}` : `Room ${number}`,
        ...position,
        width,
        height,
        rotation: 0,
        properties: [
          { name: 'zoneId', value: `${kind}-${number}` },
          { name: 'kind', value: kind },
        ],
      });
      setSelectedObjects([]);
      setSelection({ type: 'zone', index: layer.objects.length - 1 });
    });
    setTool('select');
  }
  function removeSelection() {
    if (!selection) return;
    mutate((map) => {
      if (selectedObjects.length && selection.type !== 'zone' && selection.type !== 'tile') {
        for (const type of ['decor', 'prop'] as const) {
          const layer = map.layers.find(
            (candidate) => candidate.name === (type === 'decor' ? 'decor' : 'props'),
          );
          const indices = selectedObjects
            .filter((item) => item.type === type)
            .map((item) => item.index)
            .sort((a, b) => b - a);
          for (const index of indices) layer?.objects?.splice(index, 1);
        }
        return;
      }
      if (selection.type === 'tile') {
        const layer = map.layers.find((candidate) => candidate.name === selection.layerName);
        if (layer?.data) layer.data[selection.cell] = 0;
        return;
      }
      const layer = map.layers.find(
        (candidate) =>
          candidate.name ===
          (selection.type === 'zone' ? 'zones' : selection.type === 'decor' ? 'decor' : 'props'),
      );
      layer?.objects?.splice(selection.index, 1);
    });
    setSelection(null);
    setSelectedObjects([]);
  }
  function updateSelected(key: 'name' | 'width' | 'height', value: string) {
    if (selection?.type !== 'zone') return;
    const zone = zones[selection.index];
    if (!zone) return;
    if (key === 'name') {
      mutate((map) => {
        const selected = map.layers.find((layer) => layer.name === 'zones')?.objects?.[
          selection.index
        ];
        if (selected) selected.name = value.slice(0, 60);
      });
      return;
    }
    const candidate = {
      x: zone.x,
      y: zone.y,
      width: key === 'width' ? Math.max(32, Number(value) || 32) : zone.width,
      height: key === 'height' ? Math.max(32, Number(value) || 32) : zone.height,
    };
    if (!validZone(candidate, selection.index)) {
      setInvalidPlacement(candidate);
      setMessage('That size would overlap another space or leave the map.');
      return;
    }
    setInvalidPlacement(null);
    mutate((map) => {
      const selected = map.layers.find((layer) => layer.name === 'zones')?.objects?.[
        selection.index
      ];
      if (selected) selected[key] = candidate[key];
    });
  }
  function rotateSelection(amount: number) {
    if (!selectedObjects.length) return;
    mutate((map) => {
      for (const selected of selectedObjects) {
        const layer = map.layers.find(
          (candidate) => candidate.name === (selected.type === 'prop' ? 'props' : 'decor'),
        );
        const object = layer?.objects?.[selected.index];
        if (object) object.rotation = (object.rotation + amount + 360) % 360;
      }
    });
  }
  async function loadWorkspace(id: string) {
    if (dirty && !window.confirm('Discard your unsaved map changes?')) return;
    setMessage('Loading workspace…');
    try {
      const result = await api<{ workspace: Workspace }>(`/editor/workspaces/${id}`);
      setWorkspace(result.workspace);
      const normalized = normalizeDecor(result.workspace.map);
      setDraft(normalized.map);
      setLayerName(
        normalized.map.layers.find((layer) => layer.type === 'tilelayer' && layer.visible)?.name ??
          'collision',
      );
      setSelection(null);
      setSelectedObjects([]);
      setDirty(normalized.converted);
      setMessage(
        normalized.converted
          ? 'Legacy furniture was converted to movable objects. Save to apply.'
          : 'Workspace loaded',
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  async function save() {
    setSaving(true);
    setMessage('Saving…');
    try {
      const result = await api<{ workspace: Workspace }>(
        `/editor/workspaces/${workspace.id}/map`,
        { expectedRevision: workspace.mapRevision, map: draft },
        'PUT',
      );
      setWorkspace(result.workspace);
      setDraft(clone(result.workspace.map));
      setDirty(false);
      setMessage('Saved. Everyone in the office is reloading the updated map.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (info.user.role !== 'owner')
    return (
      <main className="editor-denied">
        <h1>Owner access required</h1>
        <a href="/">Return to the office</a>
      </main>
    );
  const selectedZone = selection?.type === 'zone' ? zones[selection.index] : null;
  return (
    <main className="map-editor">
      <header className="editor-header">
        <div>
          <span className="eyebrow">ADMIN · MAP EDITOR</span>
          <h1>Shape your workspace</h1>
        </div>
        <label>
          Workspace
          <select value={workspace.id} onChange={(event) => void loadWorkspace(event.target.value)}>
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="editor-actions">
          <span className={dirty ? 'unsaved' : ''}>{message || 'All changes saved'}</span>
          <a className="button-link" href="/">
            Back to office
          </a>
          <button className="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save workspace'}
          </button>
        </div>
      </header>
      <aside className="editor-sidebar">
        <section>
          <h2>Tools</h2>
          <div className="tool-grid">
            <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>
              ↖ Select & move
            </button>
            <button
              className={tool === 'move-tile' ? 'active' : ''}
              onClick={() => setTool('move-tile')}
            >
              ⇄ Move tile
            </button>
            <button className={tool === 'tile' ? 'active' : ''} onClick={() => setTool('tile')}>
              ✎ Paint tile
            </button>
            <button className={tool === 'object' ? 'active' : ''} onClick={() => setTool('object')}>
              ＋ Place object
            </button>
          </div>
          <button
            className={`multi-select-toggle ${multiSelect ? 'active' : ''}`}
            onClick={() => {
              setMultiSelect((value) => !value);
              setTool('select');
              if (selection?.type === 'zone' || selection?.type === 'tile') setSelection(null);
            }}
          >
            {multiSelect ? '✓ Multi-select objects on' : 'Multi-select objects'}
          </button>
          <small className="editor-help">You can also hold Shift while selecting objects.</small>
        </section>
        {selection && selection.type !== 'zone' && (
          <div className="selected-object-actions">
            <strong>
              Selected{' '}
              {selection.type === 'tile'
                ? 'structural tile'
                : `${selectedObjects.length} object${selectedObjects.length === 1 ? '' : 's'}`}
            </strong>
            {(selection.type === 'decor' || selection.type === 'prop') && (
              <div className="rotation-controls">
                <span>Rotate</span>
                <button onClick={() => rotateSelection(-45)}>↶ 45°</button>
                <button onClick={() => rotateSelection(45)}>↷ 45°</button>
              </div>
            )}
            <button className="danger" onClick={removeSelection}>
              Delete selected {selection.type === 'tile' ? 'tile' : 'object'}
            </button>
            {selectedObjects.length > 1 && (
              <button
                onClick={() => {
                  setSelectedObjects([]);
                  setSelection(null);
                }}
              >
                Clear selection
              </button>
            )}
            <small>
              Drag any selected object to move the group. Delete removes the whole selection.
            </small>
          </div>
        )}
        <section>
          <h2>Tiles</h2>
          <label>
            Layer
            <select value={layerName} onChange={(event) => setLayerName(event.target.value)}>
              {tileLayers.map((layer) => (
                <option key={layer.name}>{layer.name}</option>
              ))}
            </select>
          </label>
          <small className="editor-help">
            Only floors and walls live on the structural grid. Every structural cell is independent.
          </small>
          <div className="tile-palette">
            <button
              className={gid === 0 ? 'active erase-tile' : 'erase-tile'}
              onClick={() => {
                setGid(0);
                setTool('tile');
              }}
            >
              ×
            </button>
            {Array.from({ length: Math.min(draft.tilesets[0].tilecount, 9) }, (_, index) => (
              <button
                key={index}
                className={gid === index + 1 ? 'active' : ''}
                style={{
                  backgroundImage: `url(/assets/${draft.tilesets[0].image.split('/').pop()})`,
                  backgroundPosition: `${-(index % draft.tilesets[0].columns) * 32}px ${-Math.floor(index / draft.tilesets[0].columns) * 32}px`,
                }}
                onClick={() => {
                  setGid(index + 1);
                  setTool('tile');
                }}
                aria-label={`Tile ${index + 1}`}
              />
            ))}
          </div>
        </section>
        <section>
          <h2>Spaces</h2>
          <small className="editor-help">
            Choose a space below, then drag its eight canvas handles or change its width and height.
            Invalid sizes are blocked and shown in red.
          </small>
          <div className="row">
            <button onClick={() => addZone('desk')}>＋ Desktop</button>
            <button onClick={() => addZone('meeting')}>＋ Room</button>
          </div>
          <div className="row space-copy-actions">
            <button disabled={selection?.type !== 'zone'} onClick={copySpace}>
              Copy space
            </button>
            <button disabled={!hasClipboard} onClick={pasteSpace}>
              Paste with items
            </button>
          </div>
          <div className="space-list">
            {zones.map((zone, index) => (
              <button
                className={selection?.type === 'zone' && selection.index === index ? 'active' : ''}
                key={String(property(zone, 'zoneId'))}
                onClick={() => {
                  setSelection({ type: 'zone', index });
                  setSelectedObjects([]);
                  setTool('select');
                }}
              >
                <span>{property(zone, 'kind') === 'desk' ? 'Desk' : 'Room'}</span>
                {zone.name}
              </button>
            ))}
          </div>
          {selectedZone && (
            <div className="selection-fields">
              <label>
                Name
                <input
                  value={selectedZone.name}
                  onChange={(event) => updateSelected('name', event.target.value)}
                />
              </label>
              <div className="row">
                <label>
                  Width
                  <input
                    type="number"
                    step="32"
                    value={selectedZone.width}
                    onChange={(event) => updateSelected('width', event.target.value)}
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    step="32"
                    value={selectedZone.height}
                    onChange={(event) => updateSelected('height', event.target.value)}
                  />
                </label>
              </div>
              <button className="danger" onClick={removeSelection}>
                Delete this space
              </button>
            </div>
          )}
        </section>
        <section>
          <h2>Decor objects</h2>
          <small className="editor-help">
            Furniture and rugs sit above structural floor and wall tiles. Select an object to move
            or rotate the whole piece.
          </small>
          <div className="decor-palette">
            {decorChoices.map((item) => (
              <button
                className={decorChoice?.name === item.name ? 'active' : ''}
                key={item.name}
                onClick={() => {
                  setDecorChoice(item);
                  setTool('object');
                }}
              >
                <span
                  style={
                    item.sprite
                      ? {
                          backgroundImage: `url(/assets/sprites/${item.sprite}.png)`,
                          backgroundSize: 'contain',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat',
                        }
                      : {
                          backgroundImage: `url(/assets/${draft.tilesets[0].image.split('/').pop()})`,
                          backgroundPosition: `${-((item.gid! - 1) % draft.tilesets[0].columns) * 32}px ${-Math.floor((item.gid! - 1) / draft.tilesets[0].columns) * 32}px`,
                        }
                  }
                />
                {item.label}
              </button>
            ))}
          </div>
          <h2 className="subheading">Small items</h2>
          <label>
            Place on
            <select value={deskScope} onChange={(event) => setDeskScope(event.target.value)}>
              <option value="map">Entire map</option>
              {deskZones.map((zone) => (
                <option
                  key={String(property(zone, 'zoneId'))}
                  value={String(property(zone, 'zoneId'))}
                >
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <div className="prop-palette">
            {manifest?.items.map((item) => (
              <button
                className={propName === item.name ? 'active' : ''}
                key={item.name}
                onClick={() => {
                  setPropName(item.name);
                  setDecorChoice(null);
                  setTool('object');
                }}
              >
                <span
                  style={{
                    backgroundImage: 'url(/assets/props.png)',
                    backgroundPosition: `${-(item.frame % manifest.columns) * 32}px ${-Math.floor(item.frame / manifest.columns) * 32}px`,
                    backgroundSize: `${manifest.columns * 32}px auto`,
                  }}
                />
                {item.label}
              </button>
            ))}
          </div>
        </section>
      </aside>
      <section className="editor-workarea">
        <div className="editor-zoom" aria-label="Map zoom controls">
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          >
            +
          </button>
          <button onClick={() => setZoom(1)}>Reset</button>
        </div>
        <div className="editor-canvas-wrap">
          <canvas
            ref={canvas}
            width={parsed.width}
            height={parsed.height}
            style={{ width: parsed.width * zoom, height: parsed.height * zoom }}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
        </div>
        <p>
          Changes stay in a draft until you save. Existing people, positions, and desk assignments
          are preserved when possible; only positions made invalid by new walls move to spawn.
        </p>
      </section>
    </main>
  );
}

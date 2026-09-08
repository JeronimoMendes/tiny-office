import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  editableDeskItem,
  itemFitsDesk,
  itemProperty,
  parseMap,
  personalDesk,
  validateDeskEdit,
  type TiledMap,
} from '@office/shared';

const source = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8'))).tiled;
const deskId = String(
  itemProperty(
    source.layers
      .find((l) => l.name === 'zones')!
      .objects!.find((o) => itemProperty(o, 'kind') === 'desk')!,
    'zoneId',
  ),
);
const desk = personalDesk(source, deskId)!;
const items = (map: TiledMap, name = 'props') => map.layers.find((l) => l.name === name)!.objects!;
const small = () => ({
  id: 100000,
  name: 'Mug',
  x: desk.x + 32,
  y: desk.y + 32,
  width: 0,
  height: 0,
  rotation: 0,
  point: true,
  properties: [{ name: 'prop', value: 'mug' }],
});

describe('desk-only edits', () => {
  it('allows adding, moving and deleting small and big items', () => {
    const next = structuredClone(source);
    items(next).push(small());
    items(next, 'decor').push({
      ...small(),
      id: 100001,
      point: false,
      width: 32,
      height: 32,
      properties: [
        { name: 'tileData', value: '[30]' },
        { name: 'columns', value: 1 },
      ],
    });
    expect(() => validateDeskEdit(source, next, deskId)).not.toThrow();
    const moved = structuredClone(next);
    items(moved).at(-1)!.x += 8;
    expect(() => validateDeskEdit(next, moved, deskId)).not.toThrow();
    items(moved).pop();
    items(moved, 'decor').pop();
    expect(() => validateDeskEdit(next, moved, deskId)).not.toThrow();
  });
  it('supports the new hand-drawn sprites and MacBook prop from main', () => {
    const next = structuredClone(source);
    const macbook = small();
    macbook.properties[0].value = 'macbook';
    items(next).push(macbook);
    items(next, 'decor').push({
      ...small(),
      id: 100001,
      x: desk.x + 8,
      y: desk.y + 8,
      point: false,
      width: 64,
      height: 64,
      properties: [{ name: 'sprite', value: 'cat-rug' }],
    });
    expect(() => validateDeskEdit(source, next, deskId)).not.toThrow();
    items(next, 'decor').at(-1)!.properties[0].value = 'unknown-sprite';
    expect(() => validateDeskEdit(source, next, deskId)).toThrow();
  });
  it('rejects edits without a desk and all structural changes', () => {
    expect(() => validateDeskEdit(source, source, 'missing')).toThrow();
    const next = structuredClone(source);
    next.layers.find((l) => l.type === 'tilelayer')!.data![0] = 9;
    expect(() => validateDeskEdit(source, next, deskId)).toThrow();
    expect(() =>
      validateDeskEdit(source, { ...source, width: source.width + 1 }, deskId),
    ).toThrow();
  });
  it('rejects changing desk boundaries or objects outside the desk', () => {
    const next = structuredClone(source);
    personalDesk(next, deskId)!.width += 32;
    expect(() => validateDeskEdit(source, next, deskId)).toThrow();
    const other = structuredClone(source);
    const locked = items(other, 'decor').find((o) => !editableDeskItem(o, desk, false))!;
    locked.x += 1;
    expect(() => validateDeskEdit(source, other, deskId)).toThrow();
    items(other, 'decor').splice(items(other, 'decor').indexOf(locked), 1);
    expect(() => validateDeskEdit(source, other, deskId)).toThrow();
  });
  it('rejects other desk tags, unknown items, duplicate IDs and structural tiles disguised as decor', () => {
    for (const change of [
      (o: ReturnType<typeof small>) => {
        o.properties.push({ name: 'deskId', value: 'other' });
      },
      (o: ReturnType<typeof small>) => {
        o.properties[0].value = 'wall';
      },
      (o: ReturnType<typeof small>) => {
        o.id = items(source, 'decor')[0].id;
      },
      (o: ReturnType<typeof small>) => {
        o.x = desk.x;
      },
    ]) {
      const next = structuredClone(source),
        item = small();
      change(item);
      items(next).push(item);
      expect(() => validateDeskEdit(source, next, deskId)).toThrow();
    }
    const next = structuredClone(source);
    items(next, 'decor').push({
      ...small(),
      width: 32,
      height: 32,
      point: false,
      properties: [
        { name: 'tileData', value: '[1]' },
        { name: 'columns', value: 1 },
      ],
    });
    expect(() => validateDeskEdit(source, next, deskId)).toThrow();
  });
  it('checks rotated sprite corners, not just the anchor or center', () => {
    const item = { ...small(), x: desk.x + 7, y: desk.y + 16.24 };
    expect(itemFitsDesk(item, desk, true)).toBe(true);
    item.rotation = 45;
    expect(itemFitsDesk(item, desk, true)).toBe(false);
  });
});

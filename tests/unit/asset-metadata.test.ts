import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canStand,
  decorCatalog,
  itemCollider,
  itemCollisionBounds,
  itemRenderDepth,
  move,
  parseMap,
  type Item,
} from '@office/shared';

const plant: Item = {
  id: 999999,
  name: 'Monstera',
  x: 160,
  y: 160,
  width: 32,
  height: 64,
  rotation: 0,
  properties: [{ name: 'sprite', value: 'monstera' }],
};
const rug: Item = {
  ...plant,
  id: 999998,
  width: 64,
  height: 64,
  properties: [{ name: 'sprite', value: 'cat-rug' }],
};
function floor(items: Item[]) {
  const raw = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8'))).tiled;
  raw.layers.find((l) => l.name === 'collision')!.data!.fill(0);
  raw.layers.find((l) => l.name === 'decor')!.objects = items;
  return parseMap(raw);
}

describe('authored asset metadata', () => {
  it('has unique asset IDs and registered sprites', () => {
    expect(new Set(decorCatalog.map((a) => a.name)).size).toBe(decorCatalog.length);
    for (const asset of decorCatalog)
      if (asset.sprite) {
        const png = readFileSync(`assets/sprites/${asset.sprite}.png`);
        expect(png.readUInt32BE(16)).toBe(asset.width * 32);
        expect(png.readUInt32BE(20)).toBe(asset.height * 32);
      }
  });
  it('blocks the pot, not the leaves, with pixel precision rather than whole tiles', () => {
    const map = floor([plant]);
    expect(itemCollisionBounds(plant, map.tiled)).toEqual({ x: 8, y: 46, width: 16, height: 16 });
    expect(canStand(map, 176, 176)).toBe(true);
    expect(canStand(map, 176, 214)).toBe(false);
    expect(canStand(map, 160, 214)).toBe(true);
    expect(canStand(map, 162, 214)).toBe(false);
    const start = { x: 160, y: 214, direction: 'right' as const, moving: false };
    const moved = move(map, start, 'right');
    expect(moved.x).toBeLessThan(162);
    expect(canStand(map, moved.x, moved.y)).toBe(true);
  });
  it('rotates and scales the offset footprint with the full sprite', () => {
    const rotated = { ...plant, rotation: 90 };
    const map = floor([rotated]);
    expect(itemCollider(rotated, map.tiled)).toMatchObject({
      x: 154,
      y: 192,
      halfWidth: 8,
      halfHeight: 8,
    });
    expect(canStand(map, 154, 192)).toBe(false);
    expect(canStand(map, 176, 214)).toBe(true);
    expect(itemCollisionBounds({ ...plant, width: 64, height: 128 }, map.tiled)).toEqual({
      x: 16,
      y: 92,
      width: 32,
      height: 32,
    });
    const angled = floor([{ ...plant, rotation: 45 }]);
    const collider = angled.itemColliders[0];
    expect(canStand(angled, collider.x, collider.y)).toBe(false);
    expect(canStand(angled, collider.x + 25, collider.y + 25)).toBe(true);
  });
  it('keeps structural walls solid and rugs nonblocking; ignores forged collision overrides', () => {
    const map = floor([rug]);
    expect(map.itemColliders).toEqual([]);
    expect(canStand(map, 176, 176)).toBe(true);
    map.collision[5 * map.tiled.width + 5] = 1;
    expect(canStand(map, 176, 176)).toBe(false);
    const forged = {
      ...plant,
      properties: [
        ...plant.properties,
        { name: 'solid', value: false },
        { name: 'collision', value: 'null' },
      ],
    };
    expect(canStand(floor([forged]), 176, 214)).toBe(false);
  });
  it('defaults rugs below every item regardless of insertion order or Y', () => {
    const map = floor([plant, { ...rug, y: 800 }]);
    const low = itemRenderDepth({ ...rug, y: 800 }, false, map.tiled);
    expect(low).toBeLessThan(itemRenderDepth(plant, false, map.tiled));
    const tileRug = {
      ...rug,
      width: 96,
      height: 96,
      properties: [
        { name: 'columns', value: 3 },
        { name: 'tileData', value: '[10,11,12,13,14,15,16,17,18]' },
      ],
    };
    expect(itemRenderDepth(tileRug, false, map.tiled)).toBeLessThan(4);
    const legacyRug = {
      ...tileRug,
      width: 128,
      properties: [
        { name: 'columns', value: 4 },
        { name: 'tileData', value: '[10,11,11,12,13,14,14,15,16,17,17,18]' },
      ],
    };
    expect(itemRenderDepth(legacyRug, false, map.tiled)).toBeLessThan(4);
    expect(itemCollisionBounds(legacyRug, map.tiled)).toBeNull();
  });
  it('honors explicit layers and priorities while bounding them below players and labels', () => {
    const map = floor([]);
    const front = {
      ...rug,
      y: 0,
      properties: [
        ...rug.properties,
        { name: 'renderLayer', value: 'furniture' },
        { name: 'renderOrder', value: 1 },
      ],
    };
    expect(itemRenderDepth(front, false, map.tiled)).toBeGreaterThan(
      itemRenderDepth({ ...plant, y: 8000 }, false, map.tiled),
    );
    for (const value of [101, -101, 1.5, 'front']) {
      expect(() =>
        floor([{ ...plant, properties: [...plant.properties, { name: 'renderOrder', value }] }]),
      ).toThrow();
    }
    expect(() =>
      floor([
        {
          ...plant,
          properties: [...plant.properties, { name: 'renderLayer', value: 'above-players' }],
        },
      ]),
    ).toThrow();
  });
});

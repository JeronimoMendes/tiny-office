import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyDecorVariant,
  decorAsset,
  decorCatalog,
  decorFamilies,
  itemCollisionBounds,
  itemProperty,
  parseMap,
  personalDesk,
  spriteImage,
  validateDeskEdit,
  type Item,
} from '@office/shared';
import { collectCatalog } from '../../tools/asset-catalog';
import generated from '../../assets/catalog.json';

const chair = decorFamilies.find((family) => family.name === 'chair')!;
const makeChair = (): Item => ({
  id: 999999,
  name: 'Chair',
  x: 32,
  y: 64,
  width: 32,
  height: 32,
  rotation: 90,
  properties: [
    { name: 'tileData', value: '[27]' },
    { name: 'columns', value: 1 },
    { name: 'deskId', value: 'desk-1' },
    { name: 'renderLayer', value: 'surface' },
    { name: 'renderOrder', value: 7 },
  ],
});

describe('directional asset families', () => {
  it('compiles the per-item manifests into the checked-in catalog', () => {
    expect(collectCatalog('assets')).toEqual(generated);
    expect(chair.variants.map((variant) => variant.gid)).toEqual([27, 28]);
  });
  it('recognizes legacy chair views and keeps stored sprite IDs after moving files', () => {
    const item = makeChair();
    expect(decorAsset(item)?.family).toBe('chair');
    item.properties[0].value = '[28]';
    expect(decorAsset(item)?.name).toBe('chair-down');
    expect(spriteImage('monstera')).toBe('/assets/items/monstera/default.png');
    expect(spriteImage('old-custom-piece')).toBe('/assets/sprites/old-custom-piece.png');
  });
  it('swaps artwork without losing ownership, render order, center or angle', () => {
    const item = makeChair();
    applyDecorVariant(item, chair.variants[1]);
    expect(item).toMatchObject({ id: 999999, x: 32, y: 64, width: 32, height: 32, rotation: 90 });
    expect(itemProperty(item, 'tileData')).toBe('[28]');
    expect(itemProperty(item, 'deskId')).toBe('desk-1');
    expect(itemProperty(item, 'renderOrder')).toBe(7);
    expect(itemProperty(item, 'renderLayer')).toBe('surface');
    expect(itemCollisionBounds(item)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
    const tallVariant = { ...chair.variants[0], width: 1, height: 2 };
    applyDecorVariant(item, tallVariant);
    expect(item.x + item.width / 2).toBe(48);
    expect(item.y + item.height / 2).toBe(80);
  });
  it('removes stale atlas properties when switching to a standalone sprite', () => {
    const item = makeChair();
    applyDecorVariant(
      item,
      decorCatalog.find((asset) => asset.sprite === 'monstera')!,
    );
    expect(itemProperty(item, 'sprite')).toBe('monstera');
    expect(itemProperty(item, 'tileData')).toBeUndefined();
    expect(itemProperty(item, 'columns')).toBeUndefined();
    expect(itemCollisionBounds(item)).toEqual({ x: 8, y: 46, width: 16, height: 16 });
    applyDecorVariant(item, chair.variants[0]);
    expect(itemProperty(item, 'sprite')).toBeUndefined();
    expect(itemProperty(item, 'tileData')).toBe('[27]');
  });
  it('authorizes facing changes only inside the assigned desk', () => {
    const before = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8'))).tiled;
    const desk = personalDesk(before, 'desk-1')!;
    const item = makeChair();
    item.x = desk.x + 32;
    item.y = desk.y + 32;
    before.layers.find((l) => l.name === 'decor')!.objects!.push(item);
    const after = structuredClone(before);
    const changed = after.layers.find((l) => l.name === 'decor')!.objects!.at(-1)!;
    applyDecorVariant(changed, chair.variants[1]);
    expect(() => validateDeskEdit(before, after, 'desk-1')).not.toThrow();
    expect(() => validateDeskEdit(before, after, 'desk-2')).toThrow();
    changed.x = 0;
    expect(() => validateDeskEdit(before, after, 'desk-1')).toThrow();
  });
  it('supports variant-specific geometry and rejects duplicate IDs and unsafe paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-variants-'));
    const folder = join(root, 'items', 'test-desk');
    mkdirSync(folder, { recursive: true });
    const manifest = {
      name: 'test-desk',
      label: 'Test desk',
      width: 2,
      height: 1,
      solid: true,
      variants: [
        { name: 'test-desk-front', label: 'Front', sprite: 'test-desk-front', image: 'front.png' },
        {
          name: 'test-desk-side',
          label: 'Side',
          sprite: 'test-desk-side',
          image: 'side.png',
          width: 1,
          height: 2,
          collision: { x: 2, y: 20, width: 28, height: 40 },
        },
      ],
    };
    const write = () => writeFileSync(join(folder, 'asset.json'), JSON.stringify(manifest));
    try {
      write();
      const assets = collectCatalog(root);
      expect(assets[1]).toMatchObject({
        family: 'test-desk',
        image: 'items/test-desk/side.png',
        width: 1,
        height: 2,
        collision: { x: 2, y: 20, width: 28, height: 40 },
      });
      manifest.variants[1].image = '../side.png';
      write();
      expect(() => collectCatalog(root)).toThrow();
      manifest.variants[1].image = 'side.png';
      manifest.variants[1].name = manifest.variants[0].name;
      write();
      expect(() => collectCatalog(root)).toThrow(/Duplicate/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  hitItem,
  itemFitsDesk,
  itemLocalBounds,
  parseMap,
  validateDeskEdit,
  personalDesk,
  itemProperty,
  type Item,
} from '@office/shared';
import { alphaBounds, collectBounds, readRGBA } from '../../tools/item-bounds';
import metadata from '../../assets/item-bounds.json';

const mug: Item = {
  id: 999999,
  name: 'Mug',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  point: true,
  properties: [{ name: 'prop', value: 'mug' }],
};
const desk: Item = { ...mug, width: 96, height: 96, point: false };

describe('alpha bounding boxes', () => {
  it('keeps checked-in metadata synchronized with the finished PNGs', () => {
    expect(collectBounds('assets')).toEqual(metadata);
  });
  it('excludes transparent padding, includes partial alpha, and handles empty art', () => {
    const pixels = Buffer.alloc(4 * 4 * 4);
    pixels[(1 * 4 + 1) * 4 + 3] = 1;
    pixels[(2 * 4 + 2) * 4 + 3] = 255;
    expect(
      alphaBounds({ width: 4, height: 4, pixels }, { x: 0, y: 0, width: 4, height: 4 }),
    ).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(
      alphaBounds({ width: 4, height: 4, pixels }, { x: 0, y: 0, width: 1, height: 1 }),
    ).toBeNull();
  });
  it('decodes every PNG filter used by image editors', () => {
    const chunk = (type: string, data: Buffer) => {
      const bytes = Buffer.alloc(data.length + 12);
      bytes.writeUInt32BE(data.length);
      bytes.write(type, 4);
      data.copy(bytes, 8);
      return bytes;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 6;
    const pixels = Buffer.from([1, 200, 50, 255, 45, 14, 25, 0, 60, 20, 15, 2, 220, 170, 10, 200]);
    for (let filter = 0; filter <= 4; filter++) {
      const raw = Buffer.alloc(18);
      for (let y = 0; y < 2; y++) {
        raw[y * 9] = filter;
        for (let x = 0; x < 8; x++) {
          const i = y * 8 + x,
            a = x >= 4 ? pixels[i - 4] : 0,
            b = y ? pixels[i - 8] : 0,
            c = y && x >= 4 ? pixels[i - 12] : 0;
          const distances = [a, b, c].map((v) => Math.abs(a + b - c - v));
          const paeth = [a, b, c][distances.indexOf(Math.min(...distances))];
          raw[y * 9 + x + 1] =
            (pixels[i] - [0, a, b, Math.floor((a + b) / 2), paeth][filter]) & 255;
        }
      }
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
      ]);
      expect(readRGBA(png).pixels).toEqual(pixels);
    }
  });
  it('lets the mug touch all four desk edges but not cross them, including when rotated', () => {
    const box = itemLocalBounds(mug, true);
    expect(box.width).toBeLessThan(32);
    expect(box.height).toBeLessThan(32);
    for (const rotation of [0, 45, 90, 180, 270]) {
      const a = (rotation * Math.PI) / 180;
      const corners = [box.x, box.x + box.width].flatMap((x) =>
        [box.y, box.y + box.height].map((y) => ({
          x: x * Math.cos(a) - y * Math.sin(a),
          y: x * Math.sin(a) + y * Math.cos(a),
        })),
      );
      for (const [axis, size] of [
        ['x', desk.width],
        ['y', desk.height],
      ] as const) {
        for (const edge of ['min', 'max'] as const) {
          const position =
            edge === 'min'
              ? -Math.min(...corners.map((p) => p[axis]))
              : size - Math.max(...corners.map((p) => p[axis]));
          const placed = { ...mug, x: 48, y: 48, rotation, [axis]: position };
          expect(itemFitsDesk(placed, desk, true)).toBe(true);
          placed[axis] += edge === 'min' ? -0.1 : 0.1;
          expect(itemFitsDesk(placed, desk, true)).toBe(false);
        }
      }
    }
  });
  it('uses the same tight bounds for picking and server validation', () => {
    expect(hitItem(mug, true, -15, 0)).toBe(false);
    expect(hitItem(mug, true, 0, -8)).toBe(true);
    expect(hitItem({ ...mug, rotation: 90 }, true, 8, 0)).toBe(true);
    const before = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8'))).tiled;
    const zone = before.layers
      .find((l) => l.name === 'zones')!
      .objects!.find((o) => itemProperty(o, 'kind') === 'desk')!;
    const id = String(itemProperty(zone, 'zoneId'));
    expect(personalDesk(before, id)).toBe(zone);
    const after = structuredClone(before),
      box = itemLocalBounds(mug, true);
    after.layers
      .find((l) => l.name === 'props')!
      .objects!.push({ ...mug, x: zone.x - box.x, y: zone.y - box.y });
    expect(() => validateDeskEdit(before, after, id)).not.toThrow();
  });
  it('scales separate sprites and retains safe bounds for unknown artwork', () => {
    const item = {
      ...mug,
      width: 128,
      height: 128,
      point: false,
      properties: [{ name: 'sprite', value: 'cat-rug' }],
    };
    const bounds = itemLocalBounds(item, false);
    expect(bounds.width).toBe(metadata.sprites['cat-rug'].bounds.width * 2);
    item.properties[0].value = 'unknown';
    expect(itemLocalBounds(item, false)).toEqual({ x: -64, y: -64, width: 128, height: 128 });
  });
});

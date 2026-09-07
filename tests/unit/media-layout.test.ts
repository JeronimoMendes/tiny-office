import { describe, expect, it } from 'vitest';
import { callRows } from '../../apps/client/src/ui/media-layout';

describe('expanded call layout', () => {
  it('gives four people a 2×2 grid rather than three across and an empty row', () => {
    expect(callRows(4, 1280, 720, 16)).toEqual([2, 2]);
  });

  it('adapts a one-on-one to landscape and portrait panels', () => {
    expect(callRows(2, 1280, 720, 16)).toEqual([2]);
    expect(callRows(2, 360, 700, 16)).toEqual([1, 1]);
  });

  it('fills incomplete rows instead of reserving empty grid cells', () => {
    expect(callRows(5, 1280, 720, 16)).toEqual([3, 2]);
    expect(callRows(3, 1280, 720, 16)).toEqual([2, 1]);
  });

  it('handles no video or an unmeasured panel', () => {
    expect(callRows(0, 1280, 720, 16)).toEqual([]);
    expect(callRows(4, 0, 0, 16)).toEqual([]);
    expect(callRows(1, 1280, 720, 16)).toEqual([1]);
  });

  it('includes each participant once and fills both dimensions with balanced rows', () => {
    for (const [width, height] of [
      [1280, 720],
      [360, 700],
      [700, 300],
    ] as const) {
      for (let count = 1; count <= 25; count++) {
        const rows = callRows(count, width, height, 16);
        expect(rows.reduce((sum, columns) => sum + columns, 0)).toBe(count);
        expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1);
        const tileHeight = (height - 16 * (rows.length - 1)) / rows.length;
        expect(tileHeight).toBeGreaterThan(0);
        expect(tileHeight * rows.length + 16 * (rows.length - 1)).toBeCloseTo(height);
        for (const columns of rows) {
          const tileWidth = (width - 16 * (columns - 1)) / columns;
          expect(tileWidth).toBeGreaterThan(0);
          expect(tileWidth * columns + 16 * (columns - 1)).toBeCloseTo(width);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { callRows, pinnedLayout } from '../../apps/client/src/ui/media-layout';

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

describe('pinned screen layout', () => {
  it('gives the screen the panel and leaves one strip of faces under it', () => {
    const { stage, strip } = pinnedLayout(3, 1280, 720, 16);
    expect(strip.height).toBeCloseTo(720 * 0.15);
    expect(strip.width / strip.height).toBeCloseTo(16 / 10);
    expect(stage + 16 + strip.height).toBeCloseTo(720);
    expect(stage).toBeGreaterThan(strip.height * 5);
  });

  it('shrinks the faces rather than wrapping them onto a second strip', () => {
    for (const count of [1, 2, 5, 9, 16]) {
      const { stage, strip } = pinnedLayout(count, 1280, 720, 16);
      expect(strip.width * count + 16 * (count - 1)).toBeLessThanOrEqual(1280);
      expect(stage + 16 + strip.height).toBeCloseTo(720);
      expect(stage).toBeGreaterThan(0);
    }
  });

  it('caps the strip so a tall panel does not spend half its height on faces', () => {
    expect(pinnedLayout(2, 1280, 2000, 16).strip.height).toBe(120);
  });

  it('hands the whole panel to a screen shared with nobody on camera', () => {
    expect(pinnedLayout(0, 1280, 720, 16)).toEqual({ stage: 720, strip: { width: 0, height: 0 } });
    expect(pinnedLayout(2, 0, 0, 16)).toEqual({ stage: 0, strip: { width: 0, height: 0 } });
  });
});

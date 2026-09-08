import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { TiledMap } from '@office/shared';
import { OfficeScene } from '../../apps/client/src/game/OfficeScene';

// Exercise decor rendering without booting Phaser's browser-only game loop.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

describe('decor tile rendering', () => {
  it.each([1, 4])(
    'uses tile-sized frames at %ix artwork resolution, including after restart',
    (scale) => {
      const tiled = JSON.parse(readFileSync('maps/office.tmj', 'utf8')) as TiledMap;
      tiled.layers = tiled.layers.filter((layer) => layer.name !== 'decor');
      tiled.layers.push({
        name: 'decor',
        type: 'objectgroup',
        x: 0,
        y: 0,
        offsetx: 0,
        offsety: 0,
        visible: true,
        opacity: 1,
        objects: [
          {
            id: 999,
            name: 'Furniture',
            type: '',
            x: 64,
            y: 96,
            width: 64,
            height: 32,
            rotation: 90,
            properties: [
              { name: 'columns', type: 'int', value: 2 },
              { name: 'tileData', type: 'string', value: '[1,10]' },
              { name: 'solid', type: 'bool', value: true },
            ],
          },
        ],
      });
      const frames = new Map<string, number[]>();
      const texture = {
        has: (name: string) => frames.has(name),
        add: vi.fn((name: string, ...bounds: number[]) => frames.set(name, bounds)),
      };
      const image = vi.fn(() => ({
        setDisplaySize: vi.fn().mockReturnThis(),
        setAngle: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
      }));
      // A fresh scene shares the texture manager with the scene it replaces.
      const render = () => {
        const scene = Object.assign(Object.create(OfficeScene.prototype) as OfficeScene, {
          textures: { get: () => texture },
          add: { image },
        });
        scene['decorateTiles'](tiled, scale);
      };
      render();
      render();
      expect(texture.add).toHaveBeenCalledTimes(2);
      const columns = tiled.tilesets[0].columns;
      for (const tile of [0, 9]) {
        expect(frames.get(`decor-${columns}-${scale}-${tile}`)).toEqual([
          0,
          (tile % columns) * 32 * scale,
          Math.floor(tile / columns) * 32 * scale,
          32 * scale,
          32 * scale,
        ]);
      }
      expect(image).toHaveBeenNthCalledWith(
        1,
        96,
        96,
        'office-tiles',
        `decor-${columns}-${scale}-0`,
      );
      expect(image).toHaveBeenNthCalledWith(
        2,
        96,
        128,
        'office-tiles',
        `decor-${columns}-${scale}-9`,
      );
      for (const { value: sprite } of image.mock.results) {
        expect(sprite.setDisplaySize).toHaveBeenCalledWith(32, 32);
        expect(sprite.setAngle).toHaveBeenCalledWith(90);
      }
    },
  );

  it('draws hand-drawn decor as one sprite instead of atlas cells', () => {
    const tiled = JSON.parse(readFileSync('maps/office.tmj', 'utf8')) as TiledMap;
    tiled.layers = tiled.layers.filter((layer) => layer.name !== 'decor');
    tiled.layers.push({
      name: 'decor',
      type: 'objectgroup',
      x: 0,
      y: 0,
      offsetx: 0,
      offsety: 0,
      visible: true,
      opacity: 1,
      objects: [
        {
          id: 999,
          name: 'Cat rug',
          type: '',
          x: 64,
          y: 96,
          width: 64,
          height: 64,
          rotation: 90,
          properties: [
            { name: 'sprite', type: 'string', value: 'cat-rug' },
            { name: 'solid', type: 'bool', value: false },
          ],
        },
      ],
    });
    const texture = { has: () => false, add: vi.fn() };
    const image = vi.fn(() => ({
      setDisplaySize: vi.fn().mockReturnThis(),
      setAngle: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
    }));
    const scene = Object.assign(Object.create(OfficeScene.prototype) as OfficeScene, {
      textures: { get: () => texture },
      add: { image },
    });
    scene['decorateTiles'](tiled, 4);
    // One image at the object's centre, carved from no atlas frame at all.
    expect(texture.add).not.toHaveBeenCalled();
    expect(image).toHaveBeenCalledTimes(1);
    expect(image).toHaveBeenCalledWith(96, 128, 'sprite-cat-rug');
    const [{ value: sprite }] = image.mock.results;
    expect(sprite.setDisplaySize).toHaveBeenCalledWith(64, 64);
    expect(sprite.setAngle).toHaveBeenCalledWith(90);
    expect(sprite.setDepth).toHaveBeenCalledWith(3 + 160 / 1e8);
    const rug = tiled.layers.find((l) => l.name === 'decor')!.objects![0];
    rug.properties.push(
      { name: 'renderLayer', value: 'surface' },
      { name: 'renderOrder', value: 10 },
    );
    scene['decorateTiles'](tiled, 4);
    expect(image.mock.results.at(-1)!.value.setDepth).toHaveBeenCalledWith(
      5 + 10 / 1000 + 160 / 1e8,
    );
  });
});

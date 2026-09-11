/** Read visible bounds from finished artwork; never changes PNGs. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { DecorAsset } from '../packages/shared/src/asset-schema';
import { resolve } from 'node:path';

export type Bounds = { x: number; y: number; width: number; height: number };

// The checked-in artwork uses non-interlaced 8-bit RGBA PNGs. Support all five
// PNG scanline filters (image editors choose different ones on export).
export function readRGBA(png: Buffer) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Not a PNG');
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[26] || png[27] || png[28])
    throw new Error('Export artwork as non-interlaced 8-bit RGBA PNG');
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid PNG scanlines');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('Unknown PNG filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4] : 0,
        b = y ? pixels[i - stride] : 0;
      const c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter];
      pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

export function alphaBounds(image: ReturnType<typeof readRGBA>, region: Bounds): Bounds | null {
  let left = region.width,
    top = region.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < region.height; y++)
    for (let x = 0; x < region.width; x++) {
      if (!image.pixels[((region.y + y) * image.width + region.x + x) * 4 + 3]) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function collectBounds(
  root: string,
  catalog: DecorAsset[] = JSON.parse(readFileSync(resolve(root, 'catalog.json'), 'utf8')),
) {
  const load = (name: string) => readRGBA(readFileSync(resolve(root, name)));
  const manifest = JSON.parse(readFileSync(resolve(root, 'props.json'), 'utf8'));
  const atlas = load('props.png');
  const props = Object.fromEntries(
    manifest.items.map((item: { name: string; frame: number }) => {
      const bounds = alphaBounds(atlas, {
        x: (item.frame % manifest.columns) * manifest.cell,
        y: Math.floor(item.frame / manifest.columns) * manifest.cell,
        width: manifest.cell,
        height: manifest.cell,
      });
      if (!bounds) throw new Error(`Empty prop: ${item.name}`);
      return [
        item.name,
        {
          x: bounds.x / manifest.scale - manifest.anchor[0] * 32,
          y: bounds.y / manifest.scale - manifest.anchor[1] * 32,
          width: bounds.width / manifest.scale,
          height: bounds.height / manifest.scale,
        },
      ];
    }),
  );
  const files = new Map(
    catalog.filter((asset) => asset.sprite).map((asset) => [asset.sprite!, asset.image!]),
  );
  // Retain support for old custom maps with unregistered bare sprite IDs.
  if (existsSync(resolve(root, 'sprites')))
    for (const name of readdirSync(resolve(root, 'sprites'))) {
      if (name.endsWith('.png') && !files.has(name.slice(0, -4)))
        files.set(name.slice(0, -4), `sprites/${name}`);
    }
  const sprites = Object.fromEntries(
    [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, file]) => {
        const image = load(file);
        const asset = catalog.find((asset) => asset.sprite === name);
        if (asset && (image.width !== asset.width * 32 || image.height !== asset.height * 32))
          throw new Error(`Sprite ${name} dimensions must match its variant's width and height`);
        const bounds = alphaBounds(image, { x: 0, y: 0, width: image.width, height: image.height });
        if (!bounds) throw new Error(`Empty sprite: ${name}`);
        return [name, { width: image.width, height: image.height, bounds }];
      }),
  );
  const tiles = Object.fromEntries(
    ['office.png', 'office-cozy.png'].map((name) => {
      const image = load(name);
      return [
        name,
        Array.from({ length: ((image.width / 32) * image.height) / 32 }, (_, i) =>
          alphaBounds(image, {
            x: (i % (image.width / 32)) * 32,
            y: Math.floor(i / (image.width / 32)) * 32,
            width: 32,
            height: 32,
          }),
        ),
      ];
    }),
  );
  return { props, sprites, tiles };
}

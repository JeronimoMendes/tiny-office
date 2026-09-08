import { z } from 'zod';
import catalog from '../../../assets/catalog.json';
import { itemProperty, type Item, type ItemBounds } from './item-bounds';
import type { TiledMap } from './map';

export const renderLayerSchema = z.enum(['ground', 'furniture', 'surface']);
export type RenderLayer = z.infer<typeof renderLayerSchema>;
const boxSchema = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const assetSchema = z
  .object({
    name: z.string(),
    label: z.string(),
    gid: z.number().int().positive().optional(),
    sprite: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive().default(1),
    solid: z.boolean().default(false),
    collision: boxSchema.nullable().optional(),
    renderLayer: renderLayerSchema.default('furniture'),
  })
  .strict()
  .refine((a) => Boolean(a.gid) !== Boolean(a.sprite), 'Choose a tileset piece or a sprite')
  .refine(
    (a) =>
      !a.collision ||
      (a.collision.x + a.collision.width <= a.width * 32 &&
        a.collision.y + a.collision.height <= a.height * 32),
    'Collision must fit inside the asset',
  );
export const decorCatalog = z.array(assetSchema).parse(catalog);
export type DecorAsset = (typeof decorCatalog)[number];

export function decorAsset(item: Item, map?: TiledMap) {
  const sprite = itemProperty(item, 'sprite');
  if (sprite !== undefined) return decorCatalog.find((a) => a.sprite === sprite);
  const tileset = map?.tilesets[0];
  if (
    tileset &&
    !(
      tileset.image.endsWith('/office-cozy.png') ||
      (tileset.image.endsWith('/office.png') && tileset.tilecount > 8 && tileset.columns === 8)
    )
  )
    return undefined;
  try {
    const data = JSON.parse(String(itemProperty(item, 'tileData'))) as number[];
    // Legacy rugs repeat edge/center cells to cover arbitrary rectangles.
    if (
      data.some((gid) => gid >= 10 && gid <= 18) &&
      data.every((gid) => gid === 0 || (gid >= 10 && gid <= 18))
    )
      return decorCatalog.find((a) => a.name === 'rug');
    return decorCatalog.find(
      (a) =>
        a.gid !== undefined &&
        Number(itemProperty(item, 'columns')) === a.width &&
        data.length === a.width * a.height &&
        data.every((gid, i) => gid === a.gid! + i),
    );
  } catch {
    return undefined;
  }
}

export function itemRenderSettings(item: Item, small: boolean, map?: TiledMap) {
  return {
    layer: renderLayerSchema.parse(
      itemProperty(item, 'renderLayer') ??
        (small ? 'surface' : (decorAsset(item, map)?.renderLayer ?? 'furniture')),
    ),
    order: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .parse(itemProperty(item, 'renderOrder') ?? 0),
  };
}

/** Keep all item bands above structural tiles and below players/zone labels.
 * Priority wins over Y; Y resolves ties within a priority. */
export function itemRenderDepth(item: Item, small: boolean, map?: TiledMap) {
  const { layer, order } = itemRenderSettings(item, small, map);
  return (
    { ground: 3, furniture: 4, surface: 5 }[layer] +
    order / 1000 +
    (item.y + (small ? 0 : item.height)) / 1e8
  );
}

/** Physical footprint is authored independently of visible alpha. Local coordinates
 * are relative to the full sprite's top-left, then scaled with the placement. */
export function itemCollisionBounds(item: Item, map?: TiledMap): ItemBounds | null {
  const asset = decorAsset(item, map);
  if (asset?.collision === null || !(asset?.solid ?? itemProperty(item, 'solid') === true))
    return null;
  const box = asset?.collision;
  if (!box || !asset) return { x: 0, y: 0, width: item.width, height: item.height };
  const sx = item.width / (asset.width * 32),
    sy = item.height / (asset.height * 32);
  return { x: box.x * sx, y: box.y * sy, width: box.width * sx, height: box.height * sy };
}

export type ItemCollider = {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  cosine: number;
  sine: number;
};
export function itemCollider(item: Item, map: TiledMap): ItemCollider | null {
  const box = itemCollisionBounds(item, map);
  if (!box) return null;
  const angle = (item.rotation * Math.PI) / 180,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const dx = box.x + box.width / 2 - item.width / 2,
    dy = box.y + box.height / 2 - item.height / 2;
  return {
    x: item.x + item.width / 2 + dx * cosine - dy * sine,
    y: item.y + item.height / 2 + dx * sine + dy * cosine,
    halfWidth: box.width / 2,
    halfHeight: box.height / 2,
    cosine,
    sine,
  };
}

// Separating-axis test: an axis-aligned avatar footprint against a rotated item.
export function overlapsItem(c: ItemCollider, x: number, y: number, halfWidth = 7, halfHeight = 6) {
  const dx = x - c.x,
    dy = y - c.y,
    ac = Math.abs(c.cosine),
    as = Math.abs(c.sine);
  const epsilon = 1e-6;
  return (
    Math.abs(dx) < halfWidth + ac * c.halfWidth + as * c.halfHeight - epsilon &&
    Math.abs(dy) < halfHeight + as * c.halfWidth + ac * c.halfHeight - epsilon &&
    Math.abs(dx * c.cosine + dy * c.sine) <
      c.halfWidth + ac * halfWidth + as * halfHeight - epsilon &&
    Math.abs(-dx * c.sine + dy * c.cosine) <
      c.halfHeight + as * halfWidth + ac * halfHeight - epsilon
  );
}

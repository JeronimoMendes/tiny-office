import metadata from '../../../assets/item-bounds.json';
import type { TiledMap } from './map';

export type Item = NonNullable<TiledMap['layers'][number]['objects']>[number];
export type ItemBounds = { x: number; y: number; width: number; height: number };
export const itemProperty = (item: Item, name: string) =>
  item.properties.find((p) => p.name === name)?.value;
export const propBounds: Readonly<Record<string, ItemBounds>> = metadata.props;
export const spriteBounds: Readonly<
  Record<string, { width: number; height: number; bounds: ItemBounds }>
> = metadata.sprites;
const tileBounds: Readonly<Record<string, (ItemBounds | null)[]>> = metadata.tiles;

/** Tight rectangle relative to the renderer's rotation pivot. Unknown artwork
 * retains its full rectangle rather than trusting client-provided hitboxes. */
export function itemLocalBounds(item: Item, small: boolean, map?: TiledMap): ItemBounds {
  if (small)
    return (
      propBounds[String(itemProperty(item, 'prop'))] ?? { x: -16, y: -26.24, width: 32, height: 32 }
    );
  const fallback = {
    x: -item.width / 2,
    y: -item.height / 2,
    width: item.width,
    height: item.height,
  };
  const sprite = spriteBounds[String(itemProperty(item, 'sprite'))];
  if (sprite)
    return {
      x: (sprite.bounds.x / sprite.width) * item.width - item.width / 2,
      y: (sprite.bounds.y / sprite.height) * item.height - item.height / 2,
      width: (sprite.bounds.width / sprite.width) * item.width,
      height: (sprite.bounds.height / sprite.height) * item.height,
    };
  const tileset = map?.tilesets[0];
  let image = tileset?.image.split('/').pop();
  if (image === 'office.png' && tileset!.tilecount > 8 && tileset!.columns === 8)
    image = 'office-cozy.png';
  const tiles = image && tileBounds[image];
  if (!tiles || itemProperty(item, 'sprite')) return fallback;
  try {
    const data = JSON.parse(String(itemProperty(item, 'tileData'))) as number[];
    const columns = Number(itemProperty(item, 'columns'));
    const boxes = data.flatMap((gid, i) => {
      const box = tiles[gid - 1];
      return box
        ? [{ ...box, x: (i % columns) * 32 + box.x, y: Math.floor(i / columns) * 32 + box.y }]
        : [];
    });
    if (!boxes.length) return fallback;
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    return {
      x: x - item.width / 2,
      y: y - item.height / 2,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  } catch {
    return fallback;
  }
}

export function itemPivot(item: Item, small: boolean) {
  return { x: item.x + (small ? 0 : item.width / 2), y: item.y + (small ? 0 : item.height / 2) };
}

export function hitItem(item: Item, small: boolean, x: number, y: number, map?: TiledMap) {
  const pivot = itemPivot(item, small),
    box = itemLocalBounds(item, small, map);
  const angle = (-item.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const dx = x - pivot.x,
    dy = y - pivot.y;
  const localX = dx * c - dy * s,
    localY = dx * s + dy * c;
  return (
    localX >= box.x &&
    localX <= box.x + box.width &&
    localY >= box.y &&
    localY <= box.y + box.height
  );
}

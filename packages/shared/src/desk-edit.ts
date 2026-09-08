import { parseMap, type TiledMap } from './map';
import { decorAsset } from './assets';

import { itemLocalBounds, itemPivot, itemProperty, propBounds, type Item } from './item-bounds';

export function personalDesk(map: TiledMap, deskId: string) {
  return map.layers
    .find((l) => l.name === 'zones')
    ?.objects?.find(
      (o) => itemProperty(o, 'kind') === 'desk' && itemProperty(o, 'zoneId') === deskId,
    );
}

// Test the rendered bounds, including rotation and the small-item sprite anchor.
export function itemFitsDesk(item: Item, desk: Item, small: boolean, map?: TiledMap) {
  const angle = (item.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const { x: left, y: top, width, height } = itemLocalBounds(item, small, map);
  const { x: cx, y: cy } = itemPivot(item, small);
  return [left, left + width].every((x) =>
    [top, top + height].every((y) => {
      const px = cx + x * c - y * s,
        py = cy + x * s + y * c;
      return (
        px >= desk.x - 1e-6 &&
        py >= desk.y - 1e-6 &&
        px <= desk.x + desk.width + 1e-6 &&
        py <= desk.y + desk.height + 1e-6
      );
    }),
  );
}

export function editableDeskItem(item: Item, desk: Item, small: boolean, map?: TiledMap) {
  const owner = itemProperty(item, 'deskId');
  return (!owner || owner === itemProperty(desk, 'zoneId')) && itemFitsDesk(item, desk, small, map);
}

const smallItems = new Set(Object.keys(propBounds));
// PostgreSQL jsonb does not preserve object key order.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return value;
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Only item objects wholly within the assigned desk may differ. Everything else is immutable. */
export function validateDeskEdit(before: TiledMap, input: unknown, deskId: string): TiledMap {
  before = parseMap(before).tiled;
  const after = parseMap(input).tiled;
  const desk = personalDesk(before, deskId);
  const deny = () => {
    throw new Error('Only small and big items inside your own desk can be edited');
  };
  if (!desk) return deny();
  const stripped = (map: TiledMap) => ({
    ...map,
    layers: map.layers.map((l) =>
      l.name === 'props' || l.name === 'decor' ? { ...l, objects: [] } : l,
    ),
  });
  if (!equal(stripped(before), stripped(after))) return deny();
  const ids = after.layers.flatMap((l) => l.objects?.map((o) => o.id) ?? []);
  if (new Set(ids).size !== ids.length) return deny();
  for (const name of ['props', 'decor']) {
    const small = name === 'props';
    const oldItems = before.layers.find((l) => l.name === name)?.objects ?? [];
    const newItems = after.layers.find((l) => l.name === name)?.objects ?? [];
    const locked = oldItems.filter((o) => !editableDeskItem(o, desk, small, before));
    if (
      !equal(
        locked,
        newItems.filter((o) => locked.some((p) => p.id === o.id)),
      )
    )
      return deny();
    for (const item of newItems) {
      if (oldItems.some((o) => equal(o, item))) continue;
      if (
        !editableDeskItem(item, desk, small, before) ||
        new Set(item.properties.map((p) => p.name)).size !== item.properties.length
      )
        return deny();
      if (small) {
        if (!smallItems.has(String(itemProperty(item, 'prop'))) || item.width || item.height)
          return deny();
      } else {
        const asset = decorAsset(item, before);
        if (!asset || item.width !== asset.width * 32 || item.height !== asset.height * 32)
          return deny();
      }
    }
  }
  return after;
}

import { parseMap, type TiledMap } from './map';

type Item = NonNullable<TiledMap['layers'][number]['objects']>[number];
export const itemProperty = (item: Item, name: string) =>
  item.properties.find((p) => p.name === name)?.value;

export function personalDesk(map: TiledMap, deskId: string) {
  return map.layers
    .find((l) => l.name === 'zones')
    ?.objects?.find(
      (o) => itemProperty(o, 'kind') === 'desk' && itemProperty(o, 'zoneId') === deskId,
    );
}

// Test the rendered bounds, including rotation and the small-item sprite anchor.
export function itemFitsDesk(item: Item, desk: Item, small: boolean) {
  const angle = (item.rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const width = small ? 32 : item.width,
    height = small ? 32 : item.height;
  const cx = small ? item.x : item.x + width / 2;
  const cy = small ? item.y : item.y + height / 2;
  const left = small ? -16 : -width / 2;
  const top = small ? -32 * 0.82 : -height / 2;
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

export function editableDeskItem(item: Item, desk: Item, small: boolean) {
  const owner = itemProperty(item, 'deskId');
  return (!owner || owner === itemProperty(desk, 'zoneId')) && itemFitsDesk(item, desk, small);
}

const smallItems = new Set([
  'monitor',
  'laptop',
  'keyboard',
  'mug',
  'lamp',
  'succulent',
  'cactus',
  'books',
  'photo',
  'notepad',
  'pencils',
  'headphones',
  'cat',
  'duck',
  'trophy',
  'speaker',
  'stickies',
  'terrarium',
]);
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
    const locked = oldItems.filter((o) => !editableDeskItem(o, desk, small));
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
        !editableDeskItem(item, desk, small) ||
        new Set(item.properties.map((p) => p.name)).size !== item.properties.length
      )
        return deny();
      if (small) {
        if (!smallItems.has(String(itemProperty(item, 'prop'))) || item.width || item.height)
          return deny();
      } else {
        const data = JSON.parse(String(itemProperty(item, 'tileData'))) as number[];
        const columns = Number(itemProperty(item, 'columns'));
        const first = data[0];
        const width = first === 10 ? 3 : [19, 21, 23, 25].includes(first) ? 2 : 1;
        const height = first === 10 ? 3 : 1;
        if (
          !(
            first === 10 || [19, 21, 23, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36].includes(first)
          ) ||
          columns !== width ||
          item.width !== width * 32 ||
          item.height !== height * 32 ||
          data.length !== width * height ||
          data.some((gid, i) => gid !== first + i)
        )
          return deny();
      }
    }
  }
  return after;
}

import { z } from 'zod';

const property = z
  .object({ name: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })
  .passthrough();
const object = z
  .object({
    id: z.number().int(),
    name: z.string().default(''),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative().default(0),
    height: z.number().nonnegative().default(0),
    rotation: z.number().default(0),
    properties: z.array(property).default([]),
    point: z.boolean().optional(),
  })
  .passthrough();
const layer = z
  .object({
    name: z.string(),
    type: z.enum(['tilelayer', 'objectgroup']),
    width: z.number().optional(),
    height: z.number().optional(),
    data: z.array(z.number().int().nonnegative()).optional(),
    objects: z.array(object).optional(),
    offsetx: z.number().default(0),
    offsety: z.number().default(0),
    x: z.number().default(0),
    y: z.number().default(0),
    opacity: z.number().default(1),
    visible: z.boolean().default(true),
  })
  .passthrough();
const tiledSchema = z
  .object({
    orientation: z.literal('orthogonal'),
    infinite: z.literal(false),
    tilewidth: z.literal(32),
    tileheight: z.literal(32),
    width: z.number().int().min(4).max(256),
    height: z.number().int().min(4).max(256),
    layers: z.array(layer),
    tilesets: z
      .array(
        z
          .object({
            firstgid: z.literal(1),
            name: z.string(),
            image: z.string().regex(/^\.\.\/assets\/[a-zA-Z0-9_-]+\.png$/),
            tilewidth: z.literal(32),
            tileheight: z.literal(32),
            tilecount: z.number().int().positive(),
            columns: z.number().int().positive(),
            margin: z.literal(0).optional(),
            spacing: z.literal(0).optional(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();
export type TiledMap = z.infer<typeof tiledSchema>;
export type Zone = {
  id: string;
  name: string;
  kind: 'desk' | 'meeting' | 'open';
  x: number;
  y: number;
  width: number;
  height: number;
};
export type OfficeMap = {
  tiled: TiledMap;
  width: number;
  height: number;
  collision: number[];
  zones: Zone[];
  spawn: { x: number; y: number };
};

export function parseMap(input: unknown): OfficeMap {
  const tiled = tiledSchema.parse(input);
  const collision = tiled.layers.find((l) => l.name === 'collision' && l.type === 'tilelayer');
  if (!collision?.data) throw new Error('Map requires a collision tile layer');
  if (new Set(tiled.layers.map((l) => l.name)).size !== tiled.layers.length)
    throw new Error('Layer names must be unique');
  for (const l of tiled.layers) {
    if (l.offsetx || l.offsety || l.x || l.y) throw new Error('Layer offsets are not supported');
    if (
      l.type === 'tilelayer' &&
      (l.width !== tiled.width ||
        l.height !== tiled.height ||
        l.data?.length !== tiled.width * tiled.height)
    )
      throw new Error('Tile layer dimensions must match the map');
    if (l.data?.some((gid) => gid > tiled.tilesets[0].tilecount))
      throw new Error('Unknown or flipped tile GID');
  }
  const zones = (
    tiled.layers.find((l) => l.name === 'zones' && l.type === 'objectgroup')?.objects ?? []
  ).map((o) => {
    const props = Object.fromEntries(o.properties.map((p) => [p.name, p.value]));
    const id = z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .parse(props.zoneId);
    const kind = z.enum(['desk', 'meeting', 'open']).parse(props.kind);
    if (
      o.rotation ||
      o.ellipse ||
      o.polygon ||
      o.polyline ||
      o.gid ||
      o.point ||
      o.width <= 0 ||
      o.height <= 0 ||
      o.x < 0 ||
      o.y < 0 ||
      o.x + o.width > tiled.width * 32 ||
      o.y + o.height > tiled.height * 32
    )
      throw new Error('Zones must be unrotated rectangles inside the map');
    return { id, kind, name: o.name || id, x: o.x, y: o.y, width: o.width, height: o.height };
  });
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw new Error('Duplicate zoneId');
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i],
        b = zones[j];
      if (
        a.kind !== 'open' &&
        b.kind !== 'open' &&
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      )
        throw new Error('Call zones must not overlap');
    }
  const spawn = tiled.layers.find((l) => l.name === 'spawn' && l.type === 'objectgroup')
    ?.objects?.[0];
  if (!spawn || spawn.rotation) throw new Error('Map requires one spawn object');
  return {
    tiled,
    width: tiled.width * 32,
    height: tiled.height * 32,
    collision: collision.data,
    zones,
    spawn: { x: spawn.x, y: spawn.y },
  };
}

// Foot-center membership; right/bottom edges are exclusive. Specific call zones
// take precedence over optional open-floor rectangles.
export function zoneAt(map: OfficeMap, x: number, y: number): string | null {
  const contains = (z: Zone) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height;
  return (
    map.zones.find((z) => z.kind !== 'open' && contains(z))?.id ??
    map.zones.find(contains)?.id ??
    null
  );
}

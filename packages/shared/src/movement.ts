import type { OfficeMap } from './map';
import { overlapsItem } from './assets';
export const TICK_HZ = 15;
export const STEP_MS = 1000 / TICK_HZ;
export const SPEED = 120;
export type Direction = 'up' | 'down' | 'left' | 'right';
export const headings = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  'up-left': [-1, -1],
  'up-right': [1, -1],
  'down-left': [-1, 1],
  'down-right': [1, 1],
} as const;
export type Heading = keyof typeof headings;
export type Motion = { x: number; y: number; direction: Direction; moving: boolean };

export function heading(horizontal: Direction | null, vertical: Direction | null): Heading | null {
  if (horizontal && vertical) return `${vertical}-${horizontal}` as Heading;
  return horizontal ?? vertical;
}

export function canStand(map: OfficeMap, x: number, y: number): boolean {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x - 7 < 0 ||
    y - 6 < 0 ||
    x + 7 > map.width ||
    y + 6 > map.height
  )
    return false;
  for (let ty = Math.floor((y - 6) / 32); ty <= Math.floor((y + 6 - 0.001) / 32); ty++) {
    for (let tx = Math.floor((x - 7) / 32); tx <= Math.floor((x + 7 - 0.001) / 32); tx++) {
      if (map.collision[ty * map.tiled.width + tx] !== 0) return false;
    }
  }
  return !map.itemColliders.some((collider) => overlapsItem(collider, x, y));
}

// The facing sticks to whichever axis the avatar was already showing while that
// axis stays part of the heading, so tapping a second key never flips the sprite.
function facing(previous: Direction, dx: number, dy: number): Direction {
  const dominant = { left: dx < 0, right: dx > 0, up: dy < 0, down: dy > 0 };
  if (dominant[previous]) return previous;
  return dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
}

// The server always uses the default fixed step. The local presentation can
// integrate a fraction of it without duplicating collision or diagonal rules.
export function move(
  map: OfficeMap,
  state: Motion,
  to: Heading | null,
  elapsedMs = STEP_MS,
): Motion {
  if (!to) return { ...state, moving: false };
  const [ux, uy] = headings[to];
  const direction = facing(state.direction, ux, uy);
  let { x, y } = state;
  // Small fixed substeps prevent tunneling and allow approaching a wall closely.
  const distance = (SPEED / TICK_HZ) * (Math.max(0, Math.min(elapsedMs, STEP_MS)) / STEP_MS);
  const steps = Math.max(1, Math.ceil(distance / 2)),
    length = distance / steps / (ux && uy ? Math.SQRT2 : 1),
    dx = ux * length,
    dy = uy * length;
  for (let i = 0; i < steps; i++) {
    // Sliding: a blocked diagonal still advances along whichever axis is free.
    if (canStand(map, x + dx, y + dy)) {
      x += dx;
      y += dy;
    } else if (dx && canStand(map, x + dx, y)) x += dx;
    else if (dy && canStand(map, x, y + dy)) y += dy;
    else break;
  }
  return { x, y, direction, moving: x !== state.x || y !== state.y };
}

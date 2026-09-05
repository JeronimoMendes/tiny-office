import type { OfficeMap } from './map';
export const TICK_HZ = 15;
export const STEP_MS = 1000 / TICK_HZ;
export const SPEED = 120;
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Motion = { x: number; y: number; direction: Direction; moving: boolean };

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
  return true;
}

export function move(map: OfficeMap, state: Motion, direction: Direction | null): Motion {
  if (!direction) return { ...state, moving: false };
  const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
  let { x, y } = state;
  // Small fixed substeps prevent tunneling and allow approaching a wall closely.
  const steps = Math.ceil(SPEED / TICK_HZ / 2),
    distance = SPEED / TICK_HZ / steps;
  for (let i = 0; i < steps; i++) {
    const nx = x + dx * distance,
      ny = y + dy * distance;
    if (!canStand(map, nx, ny)) break;
    x = nx;
    y = ny;
  }
  return { x, y, direction, moving: x !== state.x || y !== state.y };
}

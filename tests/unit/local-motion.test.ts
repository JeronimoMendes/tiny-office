import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canStand, move, parseMap, SPEED, STEP_MS, type Motion } from '@office/shared';
import { LocalMotion } from '../../apps/client/src/session/local-motion';

const map = parseMap(JSON.parse(readFileSync('maps/office.tmj', 'utf8')));
const initial: Motion = { ...map.spawn, direction: 'down', moving: false };

// Interleave the two clocks just as the browser does, including coincident ticks.
function walk(fps: number, heading: 'right' | 'down-right' = 'right') {
  // Speed tests need empty floor, independent of changes to authored furniture footprints.
  const floor = { ...map, collision: map.collision.map(() => 0), itemColliders: [] };
  const local = new LocalMotion(floor, initial, 0);
  local.setHeading(heading, 0);
  let fixed = initial;
  let tick = 1;
  const frames: Motion[] = [initial];
  for (let frame = 1; frame <= fps; frame++) {
    const now = (frame * 1000) / fps;
    while (tick * STEP_MS <= now + 1e-8) {
      fixed = move(floor, fixed, heading);
      local.commit(fixed, tick++ * STEP_MS);
    }
    // A matching ack must not rewind the fractional progress or restart easing.
    local.reconcile(fixed, { ...fixed }, now);
    frames.push(local.sample(now));
  }
  return frames;
}

describe('display-rate local movement', () => {
  it.each([30, 60, 120, 144])('moves at constant speed on every frame at %i Hz', (fps) => {
    const frames = walk(fps);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].x - frames[i - 1].x).toBeCloseTo(SPEED / fps, 8);
      expect(frames[i].moving).toBe(true);
    }
    expect(frames.at(-1)!.x - initial.x).toBeCloseTo(SPEED, 8);
  });

  it('responds to press, reversal, and release before the next network tick', () => {
    const local = new LocalMotion(map, initial, 0);
    local.setHeading('right', 10);
    expect(local.sample(20)).toMatchObject({
      x: initial.x + 1.2,
      direction: 'right',
      moving: true,
    });
    local.setHeading('left', 20);
    expect(local.sample(30).x).toBeCloseTo(initial.x);
    expect(local.sample(30).direction).toBe('left');
    local.setHeading(null, 30);
    expect(local.sample(60)).toMatchObject({ x: initial.x, moving: false });
  });

  it('keeps diagonal speed normalized and facing stable at display rate', () => {
    const frames = walk(144, 'down-right');
    const end = frames.at(-1)!;
    expect(Math.hypot(end.x - initial.x, end.y - initial.y)).toBeCloseTo(SPEED, 8);
    expect(end.direction).toBe('down');
  });

  it('preserves in-between-frame progress through a correction, then converges', () => {
    const local = new LocalMotion(map, initial, 0);
    local.setHeading('right', 0);
    const fixed = move(map, initial, 'right');
    local.commit(fixed, STEP_MS);
    const before = local.sample(80);
    // The server coalesced one step; replay is now 8px behind our old prediction.
    const corrected = { ...fixed, x: fixed.x - 8 };
    local.reconcile(fixed, corrected, 80);
    expect(local.sample(80).x).toBeCloseTo(before.x, 8);
    const next = local.sample(96);
    expect(next.x).toBeGreaterThan(before.x);
    expect(next.x).toBeLessThan(before.x + 1.92);
    expect(next.moving).toBe(true);
    expect(local.sample(1000).x).toBeCloseTo(corrected.x + 8, 3);
  });

  it.each([0, 10, 33, 60])(
    'holds still after a five-second walk released %ims into a tick',
    (phase) => {
      const floor = { ...map, collision: map.collision.map(() => 0), itemColliders: [] };
      const local = new LocalMotion(floor, initial, 0);
      local.setHeading('right', 0);
      let fixed = initial;
      for (let tick = 1; tick <= 75; tick++) {
        fixed = move(floor, fixed, 'right');
        local.commit(fixed, tick * STEP_MS);
      }
      const releasedAt = 5000 + phase;
      const stopped = local.sample(releasedAt);
      local.setHeading(null, releasedAt);
      for (let tick = 76; tick <= 105; tick++) {
        const now = tick * STEP_MS;
        fixed = move(floor, fixed, null);
        local.commit(fixed, now);
        local.reconcile(fixed, { ...fixed }, now + 5);
        expect(local.sample(now + 10)).toMatchObject({ x: stopped.x, y: stopped.y, moving: false });
      }
      // The held offset is only presentation; the fixed anchor is still exact.
      expect(stopped.x - fixed.x).toBeLessThanOrEqual(8);
      const resumeAt = 105 * STEP_MS + 10;
      local.setHeading('right', resumeAt);
      expect(local.sample(resumeAt).x).toBe(stopped.x);
      expect(local.sample(resumeAt + 10).x).toBeGreaterThan(stopped.x);
    },
  );

  it('does not hide significant authoritative corrections while idle', () => {
    const local = new LocalMotion(map, initial, 0);
    const corrected = { ...initial, x: initial.x - 16 };
    local.reconcile(initial, corrected, 10);
    expect(local.sample(10).x).toBe(corrected.x);
  });

  it('snaps large corrections instead of easing across the map', () => {
    const local = new LocalMotion(map, initial, 0);
    const destination = { ...initial, x: 900 };
    local.reconcile(initial, destination, 0);
    expect(local.sample(0)).toEqual(destination);
  });

  it('bounds prediction when timers stall and resumes without a huge time step', () => {
    const local = new LocalMotion(map, initial, 0);
    local.setHeading('right', 0);
    expect(local.sample(5000).x).toBe(initial.x + 8);
    expect(local.sample(6000)).toMatchObject({ x: initial.x + 8, moving: false });
    const fixed = move(map, initial, 'right');
    local.commit(fixed, 6000);
    expect(local.sample(6010).x).toBeCloseTo(fixed.x + 1.2);
  });

  it('collides and slides using the shared footprint without drawing inside walls', () => {
    const start: Motion = { x: 48, y: 560, direction: 'left', moving: false };
    for (const heading of ['left', 'down-left'] as const) {
      const local = new LocalMotion(map, start, 0);
      local.setHeading(heading, 0);
      let fixed = start;
      for (let frame = 1; frame <= 120; frame++) {
        const now = (frame * 1000) / 120;
        if (frame % 8 === 0) {
          fixed = move(map, fixed, heading);
          local.commit(fixed, now);
        }
        const displayed = local.sample(now);
        expect(canStand(map, displayed.x, displayed.y)).toBe(true);
      }
      const end = local.sample(1000);
      expect(end.x).toBeLessThanOrEqual(41);
      if (heading === 'left') expect(end.moving).toBe(false);
      else expect(end.y - start.y).toBeCloseTo(SPEED / Math.SQRT2, 8);
    }
  });

  it('fractional steps retain the fixed-step speed cap', () => {
    expect(move(map, initial, 'right', 5000)).toEqual(move(map, initial, 'right'));
    expect(move(map, initial, 'right', -1).x).toBe(initial.x);
    expect(move(map, initial, 'right', STEP_MS / 4).x).toBe(initial.x + 2);
  });
});

import {
  canStand,
  move,
  SPEED,
  STEP_MS,
  TICK_HZ,
  type Heading,
  type Motion,
  type OfficeMap,
} from '@office/shared';

const MAX_REST_OFFSET = SPEED / TICK_HZ;

// Presentation runs at display rate, independently of the 15 Hz input/ack loop.
// Fixed prediction remains the anchor; only discrepancies are eased, never
// ordinary walking. Nothing here changes what movement the server accepts.
export class LocalMotion {
  private motion: Motion;
  private heading: Heading | null = null;
  private offset = { x: 0, y: 0 };
  private time: number;
  private deadline: number;

  constructor(
    private map: OfficeMap,
    initial: Motion,
    now: number,
  ) {
    this.motion = { ...initial, moving: false };
    this.time = now;
    this.deadline = now + STEP_MS;
  }

  setHeading(heading: Heading | null, now: number) {
    this.sample(now);
    this.heading = heading;
    if (!heading) this.motion.moving = false;
  }

  sample(now: number): Motion {
    const elapsed = Math.max(0, Math.min(now, this.deadline) - this.time);
    // A release can leave up to one speculative step on screen. Keep that
    // tiny presentation offset at rest instead of visibly sliding backwards;
    // absorb it when walking resumes. Simulation/zone coordinates stay exact.
    const decay = this.heading ? Math.exp(-Math.max(0, now - this.time) / 80) : 1;
    if (elapsed > 0) this.motion = move(this.map, this.motion, this.heading, elapsed);
    else if (now > this.deadline) this.motion.moving = false;
    this.time = Math.max(this.time, now);
    this.offset.x *= decay;
    this.offset.y *= decay;
    const x = this.motion.x + this.offset.x;
    const y = this.motion.y + this.offset.y;
    // An eased correction must not draw the feet inside a wall.
    if (!canStand(this.map, x, y)) this.offset = { x: 0, y: 0 };
    return {
      ...this.motion,
      x: this.motion.x + this.offset.x,
      y: this.motion.y + this.offset.y,
    };
  }

  // Called once per sent input, after its fixed step has been predicted.
  // Holding a key at steady cadence produces zero correction here.
  commit(predicted: Motion, now: number) {
    const displayed = this.sample(now);
    this.rebase(predicted, displayed);
    // If networking stalls / the pending queue fills, do not run away forever.
    this.deadline = now + STEP_MS;
  }

  // Acks often leave fixed prediction unchanged. Apply only its actual error,
  // preserving the fractional frame progress since the last input was sent.
  reconcile(previous: Motion, predicted: Motion, now: number) {
    const displayed = this.sample(now);
    const corrected = {
      ...this.motion,
      x: this.motion.x + predicted.x - previous.x,
      y: this.motion.y + predicted.y - previous.y,
    };
    this.rebase(canStand(this.map, corrected.x, corrected.y) ? corrected : predicted, displayed);
  }

  private rebase(motion: Motion, displayed: Motion) {
    this.motion = { ...motion, moving: this.heading !== null && motion.moving };
    this.offset = { x: displayed.x - motion.x, y: displayed.y - motion.y };
    // Only sub-tick differences may remain at rest. Real corrections must
    // still apply, and rejoins/teleports must not fly through the office.
    const limit = this.heading ? 160 : MAX_REST_OFFSET + 1e-6;
    if (Math.hypot(this.offset.x, this.offset.y) > limit) this.offset = { x: 0, y: 0 };
  }
}

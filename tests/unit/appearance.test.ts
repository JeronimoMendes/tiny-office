import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  appearanceFrames,
  appearanceLayers,
  appearanceSchema,
  presetAppearance,
  profileSchema,
  wardrobe,
} from '@office/shared';

it('accepts all presets and rejects malformed or unavailable wardrobe selections', () => {
  for (let i = 0; i < 8; i++)
    expect(appearanceSchema.safeParse(presetAppearance(i)).success).toBe(true);
  const appearance = presetAppearance(0);
  for (const slot of Object.keys(wardrobe) as (keyof typeof wardrobe)[]) {
    for (const value of [-1, 0.5, wardrobe[slot].length, '0', null])
      expect(appearanceSchema.safeParse({ ...appearance, [slot]: value }).success).toBe(false);
  }
  expect(appearanceSchema.safeParse({ ...appearance, surprise: 0 }).success).toBe(false);
  expect(appearanceSchema.safeParse({ head: 0 }).success).toBe(false);
  expect(profileSchema.safeParse({ displayName: 'Robin', character: 0 }).success).toBe(true);
});

it('registers every combination within the exported atlas and keeps skin out of clothing and hair', () => {
  const appearance = presetAppearance(0);
  const frames = appearanceFrames(appearance);
  const darker = appearanceFrames({ ...appearance, skin: 5 });
  expect(
    darker.filter((frame, i) => frame.row !== frames[i].row).map((frame) => frame.name),
  ).toEqual(['body', 'hands', 'head']);
  for (const [i, { name, slots }] of appearanceLayers.entries()) {
    const png = readFileSync(`assets/wardrobe/${name}.png`);
    expect(png.readUInt32BE(16)).toBe(24 * 12);
    expect(png.readUInt32BE(20)).toBe(32 * frames[i].rows);
    const max = { ...appearance };
    for (const slot of slots) max[slot] = wardrobe[slot].length - 1;
    expect(appearanceFrames(max)[i].row).toBe(frames[i].rows - 1);
  }
});

import { z } from 'zod';
import wardrobe from './wardrobe.json' with { type: 'json' };
export { wardrobe };
const option = (key: keyof typeof wardrobe) =>
  z
    .number()
    .int()
    .min(0)
    .max(wardrobe[key].length - 1);
export const appearanceSchema = z
  .object({
    head: option('head'),
    skin: option('skin'),
    hair: option('hair'),
    hairColor: option('hairColor'),
    // Added after the first release, so records saved before it omit the key.
    beard: option('beard').default(0),
    shirt: option('shirt'),
    shirtColor: option('shirtColor'),
    pants: option('pants'),
    pantsColor: option('pantsColor'),
    shoes: option('shoes'),
    shoesColor: option('shoesColor'),
    accessory: option('accessory'),
    hat: option('hat'),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export type AppearanceSlot = keyof Appearance;
export function presetAppearance(character: number): Appearance {
  const i = Number.isInteger(character) && character >= 0 && character < 8 ? character : 0;
  return {
    head: i % 2,
    skin: [1, 0, 4, 2, 5, 0, 3, 1][i],
    hair: i,
    hairColor: i,
    beard: 0,
    shirt: i,
    shirtColor: i,
    pants: i === 3 ? 4 : 0,
    pantsColor: [0, 1, 2, 3, 4, 5, 3, 6][i],
    shoes: 0,
    shoesColor: i,
    accessory: [0, 1, 0, 0, 0, 2, 0, 3][i],
    hat: i === 6 ? 1 : 0,
  };
}
// The same row registration drives the DOM preview and all four walking views.
export const appearanceLayers = [
  { name: 'hair_back', slots: ['hair', 'hairColor'] },
  { name: 'body', slots: ['skin'] },
  { name: 'pants', slots: ['pants', 'pantsColor'] },
  { name: 'shoes', slots: ['shoes', 'shoesColor'] },
  { name: 'shirt', slots: ['shirt', 'shirtColor'] },
  { name: 'hands', slots: ['shirt', 'skin'] },
  { name: 'head', slots: ['head', 'skin'] },
  { name: 'beard', slots: ['beard', 'hairColor'] },
  { name: 'hair', slots: ['hair', 'hairColor'] },
  { name: 'accessory', slots: ['accessory'] },
  { name: 'hat', slots: ['hat'] },
] as const;
export function appearanceFrames(appearance: Appearance) {
  return appearanceLayers.map(({ name, slots }) => ({
    name,
    row: slots.reduce((row, slot) => row * wardrobe[slot].length + appearance[slot], 0),
    rows: slots.reduce((rows, slot) => rows * wardrobe[slot].length, 1),
  }));
}

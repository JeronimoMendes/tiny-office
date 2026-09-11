import { z } from 'zod';

export const renderLayerSchema = z.enum(['ground', 'furniture', 'surface']);
export type RenderLayer = z.infer<typeof renderLayerSchema>;
export const assetNameSchema = z.string().regex(/^[a-z0-9-]+$/);
const boxSchema = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export const assetSchema = z
  .object({
    name: assetNameSchema,
    label: z.string(),
    family: assetNameSchema,
    familyLabel: z.string(),
    variantLabel: z.string(),
    gid: z.number().int().positive().optional(),
    sprite: assetNameSchema.optional(),
    image: z
      .string()
      .regex(/^items\/[a-z0-9-]+\/[a-z0-9-]+\.png$/)
      .optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive().default(1),
    solid: z.boolean().default(false),
    collision: boxSchema.nullable().optional(),
    renderLayer: renderLayerSchema.default('furniture'),
  })
  .strict()
  .refine((a) => Boolean(a.gid) !== Boolean(a.sprite), 'Choose a tileset piece or a sprite')
  .refine((a) => Boolean(a.sprite) === Boolean(a.image), 'Sprite variants require an image')
  .refine(
    (a) =>
      !a.collision ||
      (a.collision.x + a.collision.width <= a.width * 32 &&
        a.collision.y + a.collision.height <= a.height * 32),
    'Collision must fit inside the asset',
  );
export type DecorAsset = z.infer<typeof assetSchema>;

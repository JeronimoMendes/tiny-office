/** Compile per-item authored manifests. No artwork is created or modified. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { assetNameSchema, assetSchema, type DecorAsset } from '../packages/shared/src/asset-schema';

const manifestSchema = z
  .object({
    name: assetNameSchema,
    label: z.string(),
    variants: z
      .array(z.object({ name: assetNameSchema, label: z.string() }).passthrough())
      .nonempty(),
  })
  .passthrough();
export function collectCatalog(root: string): DecorAsset[] {
  const catalog: DecorAsset[] = [];
  const names = new Set<string>(),
    sprites = new Set<string>();
  for (const folder of readdirSync(resolve(root, 'items'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(resolve(root, 'items', folder.name, 'asset.json'), 'utf8')),
    );
    const { name: family, label: familyLabel, variants, ...defaults } = manifest;
    if (family !== folder.name)
      throw new Error(`Asset family ${family} must match its folder ${folder.name}`);
    for (const { name, label: variantLabel, ...variant } of variants) {
      const image = variant.image;
      if (image !== undefined && (typeof image !== 'string' || !/^[a-z0-9-]+\.png$/.test(image)))
        throw new Error(`Variant ${name} needs a bare PNG filename`);
      const asset = assetSchema.parse({
        ...defaults,
        ...variant,
        name,
        family,
        familyLabel,
        variantLabel,
        label: variants.length === 1 ? familyLabel : `${familyLabel} · ${variantLabel}`,
        ...(image ? { image: `items/${family}/${image}` } : {}),
      });
      if (names.has(name) || (asset.sprite && sprites.has(asset.sprite)))
        throw new Error(`Duplicate asset or sprite ID: ${name}`);
      names.add(name);
      if (asset.sprite) sprites.add(asset.sprite);
      catalog.push(asset);
    }
  }
  return catalog;
}

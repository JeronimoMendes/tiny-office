/** Compile asset manifests and alpha bounds. PNGs remain hand-authored source files. */
import { existsSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCatalog } from './asset-catalog';
import { collectBounds } from './item-bounds';

export function prepareAssets(root: string) {
  const catalog = collectCatalog(root);
  const bounds = collectBounds(root, catalog);
  // Validate every manifest and PNG before replacing either generated artifact.
  for (const [name, value] of [
    ['catalog.json', catalog],
    ['item-bounds.json', bounds],
  ] as const) {
    const output = resolve(root, name);
    if (
      existsSync(output) &&
      JSON.stringify(JSON.parse(readFileSync(output, 'utf8'))) === JSON.stringify(value)
    )
      continue;
    writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
    console.log(`Updated ${name} from asset sources`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../assets/', import.meta.url));
  prepareAssets(root);
  if (process.argv.includes('--watch')) {
    let pending: ReturnType<typeof setTimeout> | undefined;
    watch(root, { recursive: true }, (_event, filename) => {
      if (
        filename &&
        !filename.endsWith('.png') &&
        !filename.endsWith('asset.json') &&
        filename !== 'props.json'
      )
        return;
      clearTimeout(pending);
      pending = setTimeout(() => {
        try {
          prepareAssets(root);
        } catch (error) {
          console.error('Unable to prepare assets; check the manifest or artwork export:', error);
        }
      }, 150);
    });
  }
}

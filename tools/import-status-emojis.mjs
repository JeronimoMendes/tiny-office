// Usage: node tools/import-status-emojis.mjs /path/to/emoji-test.txt
// Source: https://unicode.org/Public/emoji/16.0/emoji-test.txt
// Unicode data license: packages/shared/src/emoji-data/LICENSE.txt
import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(process.argv[2], 'utf8');
const entries = [];
let group = '';
let subgroup = '';
for (const line of source.split('\n')) {
  if (line.startsWith('# group: ')) group = line.slice(9);
  if (line.startsWith('# subgroup: ')) subgroup = line.slice(12);
  const match = line.match(/^([0-9A-F ]+)\s*; fully-qualified\s*# \S+ E[\d.]+ (.+)$/);
  if (!match) continue;
  entries.push({
    emoji: String.fromCodePoint(
      ...match[1]
        .trim()
        .split(/\s+/)
        .map((code) => parseInt(code, 16)),
    ),
    name: match[2],
    keywords: `${group} ${subgroup}`.toLowerCase().replaceAll('-', ' '),
  });
}
if (entries.length < 3000) throw new Error('Expected the complete Unicode emoji-test catalog');
await writeFile(
  new URL('../packages/shared/src/emoji-data/catalog.json', import.meta.url),
  `${JSON.stringify(entries, null, 2)}\n`,
);
console.log(`Imported ${entries.length} emojis`);

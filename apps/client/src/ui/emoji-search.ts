import { statusEmojiCatalog } from '@office/shared';

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    }
    previous = row;
  }
  return previous[b.length];
}

function wordScore(query: string, word: string): number {
  if (query === word) return 0;
  if (word.startsWith(query)) return 1;
  if (word.includes(query)) return 2;
  // Missing letters ("mtg") and small typos ("cofee") both work.
  if (query.length >= 3) {
    let index = 0;
    for (const letter of word) if (letter === query[index]) index++;
    if (index === query.length) return 3 + (word.length - query.length) / word.length;
  }
  const tolerance = query.length >= 7 ? 2 : 1;
  if (
    query.length >= 4 &&
    Math.abs(query.length - word.length) <= tolerance &&
    distance(query, word) <= tolerance
  )
    return 5;
  return Infinity;
}

const searchIndex = statusEmojiCatalog.map((entry) => ({
  entry,
  words: `${entry.name} ${entry.keywords}`.toLowerCase().split(/\s+/),
}));

export function searchStatusEmojis(input: string) {
  const query = input.trim().toLowerCase();
  if (!query) return [...statusEmojiCatalog];
  const tokens = query.split(/\s+/);
  // Skin-tone and gender variants share most words: fuzzy-score each word only once.
  const scores = new Map<string, number>();
  function cachedScore(token: string, word: string) {
    const key = `${token}\0${word}`;
    if (!scores.has(key)) scores.set(key, wordScore(token, word));
    return scores.get(key)!;
  }
  return searchIndex
    .map(({ entry, words }) => {
      const score =
        query === entry.emoji
          ? 0
          : tokens.reduce(
              (sum, token) => sum + Math.min(...words.map((word) => cachedScore(token, word))),
              0,
            );
      return { entry, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score)
    .map(({ entry }) => entry);
}

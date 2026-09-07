import { expect, it } from 'vitest';
import { statusEmojiCatalog } from '@office/shared';
import { searchStatusEmojis } from '../../apps/client/src/ui/emoji-search';

it('lists the catalog and matches names, aliases, emoji and multiple words', () => {
  expect(searchStatusEmojis('  ')).toEqual(statusEmojiCatalog);
  expect(searchStatusEmojis(' COFFEE ')[0].emoji).toBe('☕');
  expect(searchStatusEmojis('coding')[0].emoji).toBe('💻');
  expect(searchStatusEmojis('☕')[0].emoji).toBe('☕');
  expect(searchStatusEmojis('remote work')[0].emoji).toBe('🏠');
});

it('includes the full catalog without duplicates and searches beyond work emojis', () => {
  expect(statusEmojiCatalog.length).toBeGreaterThan(3700);
  expect(new Set(statusEmojiCatalog.map((entry) => entry.emoji)).size).toBe(
    statusEmojiCatalog.length,
  );
  expect(searchStatusEmojis('hedgehog')[0].emoji).toBe('🦔');
  expect(searchStatusEmojis('sushi')[0].emoji).toBe('🍣');
  expect(searchStatusEmojis('Argentina')[0].emoji).toBe('🇦🇷');
  expect(
    searchStatusEmojis('thumbs up medium skin tone').some((entry) => entry.emoji === '👍🏽'),
  ).toBe(true);
});

it('supports missing letters and typos, and returns no unrelated results', () => {
  expect(searchStatusEmojis('cofee')[0].emoji).toBe('☕');
  expect(searchStatusEmojis('mtg').some((entry) => entry.emoji === '💬')).toBe(true);
  expect(searchStatusEmojis('vacaton')[0].emoji).toBe('🌴');
  expect(searchStatusEmojis('zzzzzz')).toEqual([]);
});

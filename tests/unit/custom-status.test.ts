import { expect, it } from 'vitest';
import { customStatusSchema, statusEmojis } from '@office/shared';

it('accepts text with an optional emoji and trims whitespace', () => {
  expect(customStatusSchema.parse({ text: '  Writing docs  ', emoji: null })).toEqual({
    text: 'Writing docs',
    emoji: null,
  });
  for (const emoji of statusEmojis)
    expect(customStatusSchema.safeParse({ text: 'Working', emoji }).success).toBe(true);
  expect(customStatusSchema.parse({ text: ' ', emoji: null })).toEqual({ text: '', emoji: null });
});

it('rejects oversized text, unsupported emoji, empty emoji-only statuses and availability fields', () => {
  for (const input of [
    { text: 'a'.repeat(101), emoji: null },
    { text: 'Working', emoji: 'not an emoji' },
    { text: '', emoji: '💻' },
    { text: 'Working', emoji: null, status: 'focus' },
  ])
    expect(customStatusSchema.safeParse(input).success).toBe(false);
});

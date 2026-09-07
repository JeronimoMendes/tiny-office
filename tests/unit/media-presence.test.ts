import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_MEDIA_IDLE_MS,
  shouldPauseAvailableMedia,
  shouldResumeAvailableMedia,
} from '../../apps/client/src/ui/media-presence';

describe('client media presence', () => {
  it('pauses available media after three minutes only while hidden and alone', () => {
    expect(AVAILABLE_MEDIA_IDLE_MS).toBe(180_000);
    expect(shouldPauseAvailableMedia('free', false, false)).toBe(true);
    expect(shouldPauseAvailableMedia('free', false, true)).toBe(false);
    expect(shouldPauseAvailableMedia('free', true, false)).toBe(false);
    expect(shouldPauseAvailableMedia('focus', false, false)).toBe(false);
  });

  it('resumes available media when a peer arrives or the idle user returns', () => {
    expect(shouldResumeAvailableMedia('free', false, true, false)).toBe(true);
    expect(shouldResumeAvailableMedia('free', true, false, true)).toBe(true);
    expect(shouldResumeAvailableMedia('free', false, false, true)).toBe(false);
    expect(shouldResumeAvailableMedia('focus', true, true, true)).toBe(false);
  });
});

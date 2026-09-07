import { describe, expect, it } from 'vitest';
import { conversationRoom, mediaPolicy } from '../../apps/server/src/media/policy';

const workspace = '00000000-0000-4000-8000-000000000001';
const player = (zoneId: string | null, status: 'free' | 'focus' | 'do-not-disturb') => ({
  zoneId,
  status,
});

describe('media policy', () => {
  it('keeps open floor silent and excludes DND', () => {
    expect(mediaPolicy(player(null, 'free')).eligible).toBe(false);
    expect(mediaPolicy(player('cedar', 'do-not-disturb'))).toEqual({
      eligible: false,
      canPublishMicrophone: false,
      canPublishCamera: false,
      canReceive: false,
    });
    expect(conversationRoom(workspace, player(null, 'free'))).toBeNull();
    expect(conversationRoom(workspace, player('cedar', 'do-not-disturb'))).toBeNull();
  });

  it('lets focus receive media and explicitly publish microphone or camera', () => {
    expect(mediaPolicy(player('cedar', 'focus'))).toEqual({
      eligible: true,
      canPublishMicrophone: true,
      canPublishCamera: true,
      canReceive: true,
    });
    expect(conversationRoom(workspace, player('cedar', 'focus'))).toBe(
      conversationRoom(workspace, player('cedar', 'free')),
    );
  });

  it('gives each zone its own conversation', () => {
    expect(conversationRoom(workspace, player('cedar', 'free'))).toBe(
      `workspace-${workspace}-zone-cedar`,
    );
    expect(conversationRoom(workspace, player('oak', 'free'))).not.toBe(
      conversationRoom(workspace, player('cedar', 'free')),
    );
  });
});

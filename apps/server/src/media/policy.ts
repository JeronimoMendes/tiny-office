import type { Player } from '@office/shared';

export type MediaPolicy = {
  eligible: boolean;
  canPublishMicrophone: boolean;
  canPublishCamera: boolean;
  canPublishScreen: boolean;
  canReceive: boolean;
};

/** Pure policy used by both token issuance and live permission reconciliation. */
export function mediaPolicy(player: Pick<Player, 'zoneId' | 'status'>): MediaPolicy {
  const inConversation = player.zoneId !== null;
  if (!inConversation || player.status === 'do-not-disturb')
    return {
      eligible: false,
      canPublishMicrophone: false,
      canPublishCamera: false,
      canPublishScreen: false,
      canReceive: false,
    };
  if (player.status === 'focus')
    return {
      eligible: true,
      canPublishMicrophone: true,
      canPublishCamera: true,
      canPublishScreen: true,
      canReceive: true,
    };
  return {
    eligible: true,
    canPublishMicrophone: true,
    canPublishCamera: true,
    canPublishScreen: true,
    canReceive: true,
  };
}

/**
 * The single conversation a person may be part of, or null when media is
 * excluded. One SFU room per zone: a credential names one room, so a client
 * cannot reach another zone's conversation even with a modified browser.
 */
export function conversationRoom(
  workspaceId: string,
  player: Pick<Player, 'zoneId' | 'status'>,
): string | null {
  return mediaPolicy(player).eligible ? `workspace-${workspaceId}-zone-${player.zoneId}` : null;
}

export const roomPrefix = (workspaceId: string) => `workspace-${workspaceId}-zone-`;

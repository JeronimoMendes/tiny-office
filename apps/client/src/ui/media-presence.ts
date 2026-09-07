import type { Status } from '@office/shared';

export const AVAILABLE_MEDIA_IDLE_MS = 3 * 60 * 1000;

export function shouldPauseAvailableMedia(
  status: Status,
  pageVisible: boolean,
  hasPeerInZone: boolean,
) {
  return status === 'free' && !pageVisible && !hasPeerInZone;
}

export function shouldResumeAvailableMedia(
  status: Status,
  pageVisible: boolean,
  hasPeerInZone: boolean,
  idlePaused: boolean,
) {
  return status === 'free' && (hasPeerInZone || (pageVisible && idlePaused));
}

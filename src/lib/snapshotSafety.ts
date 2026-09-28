import type { AppSnapshot } from './types';

export function stablePhotoUrls(previousPaths: string[], previousUrls: string[], nextPaths: string[], nextUrls: string[]) {
  const previousUrlByPath = new Map(previousPaths.map((path, index) => [path, previousUrls[index] ?? '']));
  return nextPaths.map((path, index) => {
    const previous = previousUrlByPath.get(path) || '';
    const next = nextUrls[index] || '';
    const expires = Number(previous.match(/[?&]Expires=(\d+)/i)?.[1] || 0) * 1000;
    // Retain a still-valid URL to avoid flicker, but renew before its signature expires.
    if (previous && expires > Date.now() + 60000) return previous;
    return next;
  });
}

export function keepStableSnapshotPhotos(previous: AppSnapshot, next: AppSnapshot): AppSnapshot {
  if (previous.profile.id !== next.profile.id) return next;
  return {
    ...next,
    journalPhotoUrls: stablePhotoUrls(previous.journalPhotoPaths, previous.journalPhotoUrls, next.journalPhotoPaths, next.journalPhotoUrls),
  };
}

/**
 * The avatar URL worth drawing, or null for "no photo".
 *
 * Strava answers a member with no photo with its own grey placeholder silhouette
 * (".../avatar/athlete/large.png", see src/lib/strava/avatar-refresh.ts). Rows stored
 * before that filter still carry it, and drawn as a photo it is an empty grey circle
 * where the initials should be. Every avatar that takes a raw URL goes through here.
 */
export function usableAvatarUrl(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  if (/avatar\/athlete\//.test(url)) return null;
  return url;
}

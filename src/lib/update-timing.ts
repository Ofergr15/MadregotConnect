/**
 * When a new build may take over the page without asking.
 *
 * The app ships several times a day, and a "new version — tap to refresh"
 * banner on every deploy was noise: most releases are one small fix, and the
 * banner could not tell them from a big one. So an update now applies itself,
 * but only at a moment when the reload costs nothing:
 *
 * - START: the app has only just opened and nobody has touched it yet. Nothing
 *   is on screen that anyone is reading or typing into.
 * - RETURN: the app comes back after being away long enough that whatever was
 *   on screen is stale anyway. A quick switch to WhatsApp to copy something and
 *   back is shorter than this, so a half-written message survives it.
 *
 * Anything else waits for the next such moment. Nobody is ever interrupted.
 */

/** Opened this recently, with no tap or key yet, counts as START. */
export const START_WINDOW_MS = 8_000;

/** Away at least this long counts as RETURN. */
export const AWAY_MS = 10 * 60_000;

export interface UpdateMoment {
  /** ms since the page loaded */
  sinceLoadMs: number;
  /** the user has tapped or typed on this page */
  interacted: boolean;
  /** the page is visible right now */
  visible: boolean;
  /** ms the page was hidden before it became visible again; 0 if it never was */
  awayMs: number;
}

export function canApplyUpdate(m: UpdateMoment): boolean {
  if (!m.visible) return false; // applied on the way back instead, where it can be seen to be safe
  if (!m.interacted && m.sinceLoadMs <= START_WINDOW_MS) return true;
  return m.awayMs >= AWAY_MS;
}

/**
 * The app shell's scroll container.
 *
 * ── WHY THE WINDOW STOPPED BEING THE SCROLLER ───────────────────────────────
 * The bottom tab bar drifting up the page on iOS has now been fixed three times
 * and come back three times: remove `backdrop-filter`, remove `transform-gpu`,
 * then `fixed` → `sticky`. Each attempt narrowed the trigger without removing
 * the cause, because both `fixed` and `sticky bottom-0` ask the browser to keep
 * an element aligned with the VISIBLE BOTTOM of a scrolling viewport — and on
 * iOS that bottom edge is not a stable thing. It moves when the Safari toolbar
 * collapses, when the software keyboard opens, and during momentum scroll it is
 * whatever the compositor last committed. Nothing expressed in CSS on the bar
 * itself can win that argument.
 *
 * So the shell no longer scrolls. It is exactly one viewport tall and does not
 * overflow; `<main>` is the scroll container and the tab bar is a plain flex
 * sibling below it. The bar is then never positioned relative to a viewport at
 * all — it is the bottom row of a box that cannot move — and the whole class of
 * bug goes away rather than getting quieter.
 *
 * The cost is that `window.scrollY` and `window.scrollTo` are dead inside the
 * app: the window never scrolls. Everything that reads or sets a scroll offset
 * has to go through here instead — pull-to-refresh's "am I at the top?" test
 * most of all, since answering it wrong either eats the gesture or reloads the
 * page mid-list.
 */

/** Set as the id on <main> in app/(app)/layout.tsx. */
export const APP_SCROLL_ID = 'app-scroll';

/** The scrolling element, or null on a surface that isn't the app shell (auth pages). */
export function getAppScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(APP_SCROLL_ID);
}

/**
 * How far the app is scrolled. Falls back to the window so this is still correct
 * on the surfaces outside the (app) group, where the document does scroll.
 */
export function appScrollTop(): number {
  const el = getAppScroller();
  if (el) return el.scrollTop;
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

// ── REMEMBERING WHERE YOU WERE ──────────────────────────────────────────────
// Because <main> is the scroller, the browser's own back-scroll restoration is
// dead too: it restores the WINDOW, which never moved. The app shell therefore
// has to remember offsets itself. Reported by a member 2026-09-08: open somebody
// from the feed, come back, and the feed has jumped to the top.
//
// Keyed by pathname, not by history entry: the router doesn't expose a stable
// key per entry, and pathname is also the granularity the shell already chose
// for its scroll reset (a ?tab= change keeps your place). Two history entries on
// the same path share one offset, which is only ever wrong by the difference
// between two visits to the same screen.

/** Roughly a session's worth of screens; the oldest is dropped first. */
const MEMORY_LIMIT = 24;
const offsets = new Map<string, number>();

/** Record how far `key` is scrolled. Call this while the user scrolls, not on the way out — by the time the pathname has changed, the element is already being reset. */
export function rememberAppScroll(key: string, top: number): void {
  offsets.delete(key); // re-insert so Map order is least-recently-used first
  offsets.set(key, Math.max(0, top));
  for (const oldest of offsets.keys()) {
    if (offsets.size <= MEMORY_LIMIT) break;
    offsets.delete(oldest);
  }
}

/** Where `key` was left, or 0 for a screen never visited. */
export function recallAppScroll(key: string): number {
  return offsets.get(key) ?? 0;
}

// ── A PUSH THAT MEANS "BACK" ────────────────────────────────────────────────
// The shell decides "reset to the top" vs "restore where you were" from
// `popstate`, which is right for every back affordance that pops. But not all of
// them can: /dashboard/review is reached from the More sheet, from a fresh tab and
// from a link, so `router.back()` there is a sheet reopening or nothing at all,
// and its way out is a deliberate `router.push(originPath)`. The shell can't tell
// that from a forward navigation, so filing a bug report from halfway down the
// feed and coming back dumped you at the top of the feed — with a full reload of
// it to sit through. Reported as part of 71806857: "coming back from the bug
// report screen to a normal screen doesn't work well".
//
// So a caller can say what the navigation MEANS. Same one-second window as the
// popstate flag, and consumed once, so a stale intent can't turn the next genuine
// forward navigation into a restore.
const BACK_INTENT_TTL_MS = 1000;
let backIntentAt = 0;

/** Declare that the navigation about to happen is a way BACK, not a way forward. */
export function noteBackNavigation(now = Date.now()): void {
  backIntentAt = now;
}

/** Whether a back-intent was declared just now. Answers true at most once. */
export function consumeBackNavigation(now = Date.now()): boolean {
  const fresh = backIntentAt > 0 && now - backIntentAt < BACK_INTENT_TTL_MS;
  backIntentAt = 0;
  return fresh;
}

/** Drop one screen's offset, or all of them. */
export function forgetAppScroll(key?: string): void {
  if (key === undefined) offsets.clear();
  else offsets.delete(key);
}

/**
 * One step of a restore, as a pure decision.
 *
 * A restore cannot be a single assignment. The screen being restored fetches its
 * own content, so at the moment it mounts the container is often one card tall
 * and `scrollTop = 4000` silently becomes `scrollTop = 0` — the browser clamps
 * to what exists. So the restore retries as content arrives, and this is the
 * per-frame verdict: how far to scroll now, and whether to look again.
 *
 * `at` is where the container currently sits. If it is somewhere neither we nor
 * the clamp put it, the user has taken over — scrolling them back is worse than
 * giving up, so the retry stops.
 */
export function nextRestoreStep(
  want: number,
  box: { at: number; scrollHeight: number; clientHeight: number },
  elapsedMs: number,
  deadlineMs: number,
  lastSet: number | null,
): { set: number; retry: boolean } {
  const reachable = Math.max(0, Math.min(want, box.scrollHeight - box.clientHeight));
  const userTookOver = lastSet !== null && Math.abs(box.at - lastSet) > 4;
  if (userTookOver) return { set: box.at, retry: false };
  // Keep looking only while the content is still too short to hold the offset.
  const retry = reachable < want && elapsedMs < deadlineMs;
  return { set: reachable, retry };
}

/** How long to keep waiting for content tall enough to hold the offset. */
export const RESTORE_DEADLINE_MS = 1500;

/**
 * Scroll the app back to `top`, following the content as it loads.
 * Returns a canceller — call it if the screen changes again mid-restore.
 */
export function restoreAppScroll(top: number, deadlineMs = RESTORE_DEADLINE_MS): () => void {
  const el = getAppScroller();
  if (!el) return () => {};
  if (top <= 0) {
    el.scrollTop = 0;
    return () => {};
  }
  const startedAt = Date.now();
  let frame = 0;
  let lastSet: number | null = null;
  let cancelled = false;
  const attempt = () => {
    frame = 0;
    if (cancelled) return;
    const step = nextRestoreStep(
      top,
      { at: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
      Date.now() - startedAt,
      deadlineMs,
      lastSet,
    );
    el.scrollTop = step.set;
    lastSet = step.set;
    if (step.retry) frame = requestAnimationFrame(attempt);
  };
  attempt();
  return () => {
    cancelled = true;
    if (frame) cancelAnimationFrame(frame);
  };
}

/** Back to the top of the current screen. */
export function scrollAppToTop(smooth = true): void {
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  const el = getAppScroller();
  if (el) {
    el.scrollTo({ top: 0, behavior });
    return;
  }
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior });
}

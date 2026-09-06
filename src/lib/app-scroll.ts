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

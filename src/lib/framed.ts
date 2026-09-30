/**
 * This page is inside a frame: the release rehearsal
 * (dashboard/release-rehearsal) shows the real feed in an iframe under its own
 * copies of the update sheet and the What's new sheet. The framed copy must not
 * run its own: a What's new that opened in there would spend the ledger, so the
 * evening's real sheet would never come.
 *
 * A cross-origin parent throws on `top`, and that is a frame too.
 */
export function isFramed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** True when running as the installed home-screen app, not a regular browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS only ever shows a web app's push notifications "natively" (no
 * generic-web-page attribution line) when the subscription itself was
 * created while running standalone (launched from the home screen icon) —
 * subscribing from a regular Safari tab permanently tags that subscription
 * as page-origin push, even after later adding the icon. Scoped to iOS only:
 * Android/desktop don't have this quirk, so gating them too would just add
 * needless friction to their opt-in.
 */
export function isIosDevice(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; disambiguate via touch.
    (/macintosh/i.test(ua) && 'ontouchend' in document);
  return isIos;
}

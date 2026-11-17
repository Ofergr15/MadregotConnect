/**
 * Is this the native app shell (a future Capacitor/TWA wrapper) rather than the web
 * app in a browser or installed as a PWA?
 *
 * Always false today: there is no native build yet. It exists so the post-login
 * stack (lib/onboarding-surface.ts) already has the switch it needs — inside a
 * native shell there is nothing to "add to the home screen", the web tour and
 * What's New would duplicate the store's own onboarding, and push is native. When
 * the shell lands, detect it here (e.g. a `window.Capacitor` / UA marker the shell
 * injects) and every one of those surfaces turns itself off in one place.
 */
export function isNativeShell(): boolean {
  return false;
}

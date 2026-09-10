/**
 * Whether this device CAN hold a push subscription at all, and if not, why.
 *
 * Separate from the browser probes in `pwa.ts` because the interesting part is
 * the ordering, not the detection — and ordering is worth a test that doesn't
 * need a DOM.
 *
 * Reported 2026-09-08 from an iPhone on iOS 18.7, in a Safari TAB: "send a test
 * notification" answered "no push subscription on this device — try 'Fix
 * notifications on this device'", and the repair row it named was not on her
 * screen. iOS exposes PushManager only to an app launched from the home screen,
 * so in a tab `Notification` does not exist — which left the permission state
 * null, and both the enable row and the repair row in NotificationPrefs render
 * only on a non-null permission. The single instruction the screen offered
 * pointed at the single row it had hidden.
 */
export type PushEnvironment =
  /** A subscription is possible here. Anything still wrong is permission or a dead endpoint. */
  | 'ready'
  /** iOS, but not launched from the home screen. Nothing to fix — install first. */
  | 'installFirst'
  /** Another app's webview: can neither install nor subscribe. Leave it first. */
  | 'inAppBrowser'
  /** No Notification / service worker / PushManager. In-app notifications only. */
  | 'unsupported';

export type PushEnvironmentFacts = {
  inAppBrowser: boolean;
  ios: boolean;
  standalone: boolean;
  /** Notification AND serviceWorker AND PushManager all present. */
  pushApiAvailable: boolean;
};

/**
 * The decision, as data in and one answer out.
 *
 * `inAppBrowser` is checked FIRST and that is the whole reason this is a
 * function. A WhatsApp webview on iOS is also not standalone, so an
 * iOS-first order would answer "add it to your home screen" — and tell someone
 * to use a Share sheet that has no Add to Home Screen in it. Leaving the webview
 * is the step that unblocks the other one.
 *
 * `installFirst` outranks `unsupported` for the same kind of reason: on iOS the
 * missing push API is a CONSEQUENCE of not being installed, not an unsupported
 * browser, and "your browser doesn't support notifications" would be a dead end
 * where a thirty-second fix exists.
 */
export function pushEnvironment(facts: PushEnvironmentFacts): PushEnvironment {
  if (facts.inAppBrowser) return 'inAppBrowser';
  if (facts.ios && !facts.standalone) return 'installFirst';
  if (!facts.pushApiAvailable) return 'unsupported';
  return 'ready';
}

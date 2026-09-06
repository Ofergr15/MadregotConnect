import { isIosDevice, isStandalone } from '@/lib/pwa';
import type { OnboardingState } from './use-onboarding';

// ═════════════════════════════════════════════════════════════════════════════
// The order of a first run: add to the home screen → the tour → notifications →
// the setup checklist. Four components implement that order (InstallStepProvider,
// InstallPrompt, FirstRunTour, NotificationsStep) and the rules that decide it
// live here, in one place, testable without a DOM.
//
// The order isn't cosmetic. iOS only delivers a web app's push notifications
// app-natively when the subscription was created while running from the
// home-screen icon; subscribing from a Safari tab tags it page-origin
// permanently, even if the icon is added later. "Notifications" is one of the
// five scored setup tasks, so letting it be ticked off in a browser tab hands
// someone a ✓ on something that will look wrong forever.
// ═════════════════════════════════════════════════════════════════════════════

/** Installed, or an explicit "don't offer again". Survives across visits. */
export const INSTALL_DISMISS_KEY = 'pwa_install_dismissed';
/** Soft "not now" — gone for this visit, back on the next one. */
export const INSTALL_SESSION_SKIP_KEY = 'pwa_install_skipped_session';
/** How many visits have been shown the offer and waved it away. */
export const INSTALL_OFFER_COUNT_KEY = 'pwa_install_offers';

/**
 * How many times the offer is allowed back before it retires itself.
 *
 * iOS never reports that the icon was added, and the installed app gets its OWN
 * storage container — so a Safari tab can't read what the home screen already
 * knows, and "ask again next visit" means asking someone who installed weeks
 * ago, on every single visit, forever. (That's the shape of the complaint: the
 * install sheet coming back in a browser tab, and the tour queued up behind it.)
 * Three is where a reminder turns into a nag; past that this device counts as
 * having answered.
 */
export const INSTALL_MAX_OFFERS = 3;

/** How many times this device has waved the offer away. */
export function installOfferCount(): number {
  return Number(localStorage.getItem(INSTALL_OFFER_COUNT_KEY)) || 0;
}

/** Bank one more soft skip, so the offer can count its own way out. */
export function recordInstallOfferSkipped(): void {
  localStorage.setItem(INSTALL_OFFER_COUNT_KEY, String(installOfferCount() + 1));
}

/**
 * How long to wait for `beforeinstallprompt` before concluding this device
 * can't be asked at all. Chromium fires it as part of page load; anything that
 * hasn't by now (desktop Firefox, an in-app webview, Chrome on iOS) never will
 * — and a browser that cannot install must not hold the tour hostage forever.
 */
export const OFFER_SETTLE_MS = 2500;

/** Where the tour runs. Anywhere else and its first step has nothing to point at. */
export const TOUR_HOME = '/dashboard/profile';

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: notifications.
//
// WHY THIS STEP EXISTS AT ALL: until it did, `requestPushOptInPrompt()` had
// exactly ONE caller in the whole app — the workout-feedback page — so an
// athlete who never submitted feedback was never asked for permission, ever.
// The setup checklist's `notifications` task only NAVIGATED to a settings tab
// and hoped. Measured 2026-09-06: 1 of 26 athletes had a push subscription, and
// club-wide sends reached 0 devices while reporting themselves as sent.
//
// The offer is deliberately shaped like the install step rather than the
// feedback-page nudge: a step with two labelled ways out and a bounded number of
// returns. Reason it can't just be a permanent nag — `Notification.requestPermission()`
// is a one-shot per origin, and a "Don't Allow" is not recoverable in-app on
// iOS, so a screen that pesters until someone taps through it is a screen that
// manufactures permanent denials. The OS prompt is only ever reached from an
// explicit tap on OUR button, so declining this sheet costs nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** Subscribed, or an explicit "don't offer again". Survives across visits. */
export const PUSH_STEP_DISMISS_KEY = 'push_step_dismissed';
/** Soft "not now" — gone for this visit, back on the next one. */
export const PUSH_STEP_SESSION_SKIP_KEY = 'push_step_skipped_session';
/** How many visits have been shown the step and waved it away. */
export const PUSH_STEP_OFFER_COUNT_KEY = 'push_step_offers';

/**
 * How many times the step is allowed back before it retires itself. Same three
 * as the install offer, for the same reason: past that a reminder is a nag. The
 * setup checklist still carries the task afterwards, so retiring the sheet never
 * removes the athlete's way in — it just stops interrupting them.
 */
export const PUSH_STEP_MAX_OFFERS = 3;

/** What the browser will tell us, plus the case where it can't be asked. */
export type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

/** How many times this device has waved the notifications step away. */
export function pushStepOfferCount(): number {
  return Number(localStorage.getItem(PUSH_STEP_OFFER_COUNT_KEY)) || 0;
}

/** Bank one more soft skip, so the step can count its own way out. */
export function recordPushStepSkipped(): void {
  localStorage.setItem(PUSH_STEP_OFFER_COUNT_KEY, String(pushStepOfferCount() + 1));
}

/**
 * May the notifications step show right now?
 *
 * `permission` is passed in rather than read here because `Notification` is
 * absent entirely on some browsers, and "unsupported" is a real answer this has
 * to be able to receive rather than crash on.
 *
 * Only `'default'` is askable. `'granted'` has nothing to ask — and notably does
 * NOT mean push works: permission survives while iOS quietly drops the
 * subscription underneath it, which is what `ensurePushSubscription`'s daily
 * heal in PushOptIn repairs. `'denied'` means the one prompt this origin ever
 * gets is already spent, so showing a sheet whose button cannot function would
 * only teach the athlete the app is broken.
 */
export function canShowNotificationsStep(
  data: OnboardingState | undefined,
  installAnswered: boolean,
  permission: PushPermissionState,
): boolean {
  if (!data || !data.applicable) return false; // staff with no athlete row
  if (!installAnswered) return false; // step 1 comes first
  // Step 2 comes first — but never let a missing column strand this step. When
  // 078 hasn't been applied `tourSeen` is a guess (see use-onboarding), and
  // blocking on a guess would mean nobody is ever asked for permission on an
  // un-migrated database. The layout's `popupsAllowed` already keeps this sheet
  // off the screen while the tour is actually running, so leaning on that here
  // costs nothing and removes a way for onboarding to fail silently.
  if (data.migrated && !data.tourSeen) return false;
  if (permission !== 'default') return false;
  // The whole reason install is step 1: a subscription created in a Safari tab
  // is tagged page-origin PERMANENTLY, even if the icon is added later. On iOS,
  // asking before the app runs from the home screen doesn't get notifications
  // early — it costs that device app-native notifications for good.
  if (isIosDevice() && !isStandalone()) return false;
  if (localStorage.getItem(PUSH_STEP_DISMISS_KEY) === '1') return false;
  if (sessionStorage.getItem(PUSH_STEP_SESSION_SKIP_KEY) === '1') return false;
  return pushStepOfferCount() < PUSH_STEP_MAX_OFFERS;
}

/**
 * Has this device already settled the install question before we ask anything?
 * Installed, opted out for good, waved away this visit, or waved away enough
 * visits to have made its point — all of them mean there is nothing to show and
 * the tour is free to start immediately.
 *
 * Deliberately device-local: being installed is a property of a DEVICE, not of
 * a person, so the same runner on a phone and a laptop is two different
 * answers and a column on `athletes` would be actively wrong for one of them.
 */
export function isInstallStepAnswered(): boolean {
  return (
    isStandalone() ||
    localStorage.getItem(INSTALL_DISMISS_KEY) === '1' ||
    sessionStorage.getItem(INSTALL_SESSION_SKIP_KEY) === '1' ||
    installOfferCount() >= INSTALL_MAX_OFFERS
  );
}

/**
 * Whether the first-run tour may arm itself yet.
 *
 * On iOS the wait for `installAnswered` spans a context switch — they leave
 * Safari, add the icon, and come back through it in a brand-new session — which
 * is exactly why that answer is device-local state rather than a step counter
 * the tour could hold itself.
 */
export function canStartTour(data: OnboardingState | undefined, installAnswered: boolean): boolean {
  if (!data || !data.applicable) return false; // staff with no athlete row
  if (data.tourSeen) return false; // once, ever
  return installAnswered;
}

/**
 * Where the last press of the tour lands, or null to just close.
 *
 * The final step points AT the setup card, so ending the tour there left the
 * athlete facing a card they still had to find and tap themselves — "יאללה,
 * מתחילים" has to start something. Only when that step is the one actually
 * being shown: steps whose anchors aren't on the page are filtered out before
 * the tour runs (the tab bar is md:hidden on desktop), so any of them can end
 * up last.
 */
export function tourExitTarget(steps: { anchor: string }[], index: number): string | null {
  return steps[index]?.anchor === 'setupCard' ? `${TOUR_HOME}?tab=setup` : null;
}

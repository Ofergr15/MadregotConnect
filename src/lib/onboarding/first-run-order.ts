import { isStandalone } from '@/lib/pwa';
import type { OnboardingState } from './use-onboarding';

// ═════════════════════════════════════════════════════════════════════════════
// The order of a first run: add to the home screen → the tour → the setup
// checklist. Three components implement that order (InstallStepProvider,
// InstallPrompt, FirstRunTour) and the rules that decide it live here, in one
// place, testable without a DOM.
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

/**
 * How long to wait for `beforeinstallprompt` before concluding this device
 * can't be asked at all. Chromium fires it as part of page load; anything that
 * hasn't by now (desktop Firefox, an in-app webview, Chrome on iOS) never will
 * — and a browser that cannot install must not hold the tour hostage forever.
 */
export const OFFER_SETTLE_MS = 2500;

/** Where the tour runs. Anywhere else and its first step has nothing to point at. */
export const TOUR_HOME = '/dashboard/profile';

/**
 * Has this device already settled the install question before we ask anything?
 * Installed, opted out for good, or waved away this visit — all three mean
 * there is nothing to show and the tour is free to start immediately.
 *
 * Deliberately device-local: being installed is a property of a DEVICE, not of
 * a person, so the same runner on a phone and a laptop is two different
 * answers and a column on `athletes` would be actively wrong for one of them.
 */
export function isInstallStepAnswered(): boolean {
  return (
    isStandalone() ||
    localStorage.getItem(INSTALL_DISMISS_KEY) === '1' ||
    sessionStorage.getItem(INSTALL_SESSION_SKIP_KEY) === '1'
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

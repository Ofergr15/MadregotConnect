import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  INSTALL_DISMISS_KEY,
  INSTALL_MAX_OFFERS,
  INSTALL_OFFER_COUNT_KEY,
  INSTALL_SESSION_SKIP_KEY,
  PUSH_STEP_DISMISS_KEY,
  PUSH_STEP_MAX_OFFERS,
  PUSH_STEP_OFFER_COUNT_KEY,
  PUSH_STEP_SESSION_SKIP_KEY,
  TOUR_HOME,
  canShowNotificationsStep,
  canStartTour,
  isInstallStepAnswered,
  pushStepOfferCount,
  resetInstallOffer,
  recordInstallOfferSkipped,
  recordPushStepSkipped,
  tourExitTarget,
} from '@/lib/onboarding/first-run-order';
import { isInAppBrowser, isIosSafari } from '@/lib/pwa';
import type { OnboardingState } from '@/lib/onboarding/use-onboarding';

// The first run has an ORDER — install, then the tour, then notifications, then
// the setup checklist — and its two failure modes are opposites. Ask too early
// and an iOS athlete subscribes to push from a Safari tab, which permanently
// tags that subscription as page-origin (the reason install comes first at all).
// Ask too late, or wait for an answer that can never arrive, and the tour never
// starts for anyone on a browser that can't install — a silent, total loss of
// onboarding. Both are covered below.

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function browser(opts: {
  ua?: string;
  standalone?: boolean;
  displayMode?: boolean;
  local?: Record<string, string>;
  session?: Record<string, string>;
  touch?: boolean;
} = {}) {
  const local = { ...(opts.local ?? {}) };
  const session = { ...(opts.session ?? {}) };
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: opts.displayMode ?? false }),
    navigator: { userAgent: opts.ua ?? IPHONE_SAFARI, standalone: opts.standalone },
  });
  vi.stubGlobal('document', opts.touch ? { ontouchend: null } : {});
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => local[k] ?? null,
    setItem: (k: string, v: string) => { local[k] = v; },
    removeItem: (k: string) => { delete local[k]; },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => session[k] ?? null,
    removeItem: (k: string) => { delete session[k]; },
  });
  return { local, session };
}

beforeEach(() => vi.unstubAllGlobals());

describe('isInstallStepAnswered', () => {
  it('is unanswered on a fresh browser tab — this is the one case that shows the step', () => {
    browser();
    expect(isInstallStepAnswered()).toBe(false);
  });

  it('is answered when already launched from the home screen icon', () => {
    // The iOS resume path: they left Safari, added the icon, and came back
    // through it in a brand-new session. Nothing else could tell us they did it.
    browser({ standalone: true });
    expect(isInstallStepAnswered()).toBe(true);
  });

  it('is answered when running standalone by display-mode (Android/desktop PWA)', () => {
    browser({ displayMode: true });
    expect(isInstallStepAnswered()).toBe(true);
  });

  it('is answered for good after "do not ask again"', () => {
    browser({ local: { [INSTALL_DISMISS_KEY]: '1' } });
    expect(isInstallStepAnswered()).toBe(true);
  });

  it('is answered for this visit after a soft skip', () => {
    browser({ session: { [INSTALL_SESSION_SKIP_KEY]: '1' } });
    expect(isInstallStepAnswered()).toBe(true);
  });

  it('reads the soft skip from sessionStorage only, so it comes back next visit', () => {
    // The soft skip living in localStorage would be indistinguishable from
    // "never ask again" — the whole difference between the two buttons.
    browser({ local: { [INSTALL_SESSION_SKIP_KEY]: '1' } });
    expect(isInstallStepAnswered()).toBe(false);
  });

  it('is answered once the offer has come back enough times to have made its point', () => {
    // The iOS dead end: they added the icon, but the installed app has its own
    // storage container, so this Safari tab will never hear about it. Coming
    // back "next visit" forever is a nag aimed at someone who already installed.
    browser({ local: { [INSTALL_OFFER_COUNT_KEY]: String(INSTALL_MAX_OFFERS) } });
    expect(isInstallStepAnswered()).toBe(true);
  });

  it('still asks one visit below the cap — a reminder is the whole point', () => {
    browser({ local: { [INSTALL_OFFER_COUNT_KEY]: String(INSTALL_MAX_OFFERS - 1) } });
    expect(isInstallStepAnswered()).toBe(false);
  });

  it('treats a junk count as no count, rather than locking the offer out', () => {
    browser({ local: { [INSTALL_OFFER_COUNT_KEY]: 'nonsense' } });
    expect(isInstallStepAnswered()).toBe(false);
  });
});

describe('recordInstallOfferSkipped', () => {
  it('counts the soft skips, and the last allowed one retires the offer', () => {
    const { local } = browser();
    for (let i = 1; i < INSTALL_MAX_OFFERS; i++) recordInstallOfferSkipped();
    expect(isInstallStepAnswered()).toBe(false);
    recordInstallOfferSkipped();
    expect(local[INSTALL_OFFER_COUNT_KEY]).toBe(String(INSTALL_MAX_OFFERS));
    expect(isInstallStepAnswered()).toBe(true);
  });
});

describe('isIosSafari — who gets the manual Share-sheet instructions', () => {
  it('shows them to iPhone Safari, which has no beforeinstallprompt', () => {
    browser();
    expect(isIosSafari()).toBe(true);
  });

  it('shows them on an iPad reporting itself as a Mac, disambiguated by touch', () => {
    browser({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      touch: true,
    });
    expect(isIosSafari()).toBe(true);
  });

  it('does not show them on desktop Safari — same UA, no touch', () => {
    browser({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    });
    expect(isIosSafari()).toBe(false);
  });

  it('does not show them in Chrome on iOS, which cannot install at all', () => {
    // Its UA contains "Safari"; instructions for Safari's Share sheet would be
    // directions for a different app.
    browser({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
    });
    expect(isIosSafari()).toBe(false);
  });

  it('does not show them in Firefox on iOS either', () => {
    browser({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
    });
    expect(isIosSafari()).toBe(false);
  });

  it('does not show them on Android Chrome, which gets a real install button', () => {
    browser({
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    });
    expect(isIosSafari()).toBe(false);
  });
});

describe('canStartTour', () => {
  const fresh = { applicable: true, tourSeen: false } as OnboardingState;

  it('waits for the install step before showing anything', () => {
    expect(canStartTour(fresh, false)).toBe(false);
    expect(canStartTour(fresh, true)).toBe(true);
  });

  it('stays silent while the onboarding read is still in flight', () => {
    expect(canStartTour(undefined, true)).toBe(false);
  });

  it('never runs for staff with no athlete row — there is nothing to tour them through', () => {
    expect(canStartTour({ applicable: false }, true)).toBe(false);
  });

  it('runs once, ever', () => {
    expect(canStartTour({ ...fresh, tourSeen: true } as OnboardingState, true)).toBe(false);
  });
});

describe('tourExitTarget', () => {
  const STEPS = [{ anchor: 'upcomingWorkout' }, { anchor: 'tabbar' }, { anchor: 'setupCard' }];

  it('hands off into the setup checklist when the tour ends on the setup card', () => {
    expect(tourExitTarget(STEPS, 2)).toBe(`${TOUR_HOME}?tab=setup`);
  });

  it('just closes when some other step ended up last', () => {
    // Steps whose anchors aren't on the page are filtered out before the tour
    // runs — the tab bar is md:hidden, and an athlete with no plan yet has
    // neither workout card nor week strip — so any step can land last, and only
    // the setup one has somewhere to hand off to.
    expect(tourExitTarget([{ anchor: 'upcomingWorkout' }, { anchor: 'tabbar' }], 1)).toBeNull();
  });

  it('does not navigate mid-tour', () => {
    expect(tourExitTarget(STEPS, 0)).toBeNull();
  });

  it('survives an out-of-range index instead of throwing at the athlete', () => {
    expect(tourExitTarget([], 0)).toBeNull();
  });
});

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('canShowNotificationsStep', () => {
  // An athlete who has installed the app and finished the tour: the one state
  // the step is FOR. Every test below turns exactly one thing off from here.
  const ready = { applicable: true, migrated: true, tourSeen: true } as OnboardingState;

  it('asks an installed athlete who has finished the tour', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
  });

  it('waits for the install step', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, false, 'default')).toBe(false);
  });

  it('waits for the tour, so two first-run screens never stack', () => {
    browser({ standalone: true });
    const midTour = { applicable: true, migrated: true, tourSeen: false } as OnboardingState;
    expect(canShowNotificationsStep(midTour, true, 'default')).toBe(false);
  });

  it('does NOT wait for the tour when the database has no column to record it', () => {
    // Migration 078 not applied: `tourSeen` is a guess, and blocking on a guess
    // would mean nobody is ever asked for push permission at all. The layout's
    // popupsAllowed still keeps this sheet off a running tour.
    browser({ standalone: true });
    const unmigrated = { applicable: true, migrated: false, tourSeen: false } as OnboardingState;
    expect(canShowNotificationsStep(unmigrated, true, 'default')).toBe(true);
  });

  it('stays silent while the onboarding read is still in flight', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(undefined, true, 'default')).toBe(false);
  });

  it('stays silent for staff with no athlete row', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep({ applicable: false }, true, 'default')).toBe(false);
  });

  // ── The reason the whole step exists where it does ────────────────────────
  it('never asks on iOS from a Safari tab, however ready everything else is', () => {
    // Subscribing here tags the subscription page-origin PERMANENTLY, even if
    // the icon is added afterwards. Asking early doesn't win notifications
    // sooner — it costs this device app-native notifications for good.
    browser({ standalone: false });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(false);
  });

  it('asks on iOS as soon as the app is launched from the icon', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
  });

  it('asks in a plain Android tab, which has nothing to taint', () => {
    browser({ ua: ANDROID_CHROME });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
  });

  // ── Permission states ─────────────────────────────────────────────────────
  it('has nothing to ask once permission is granted', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, true, 'granted')).toBe(false);
  });

  it('never shows on a denial, because that prompt cannot be asked again', () => {
    // requestPermission() is one-shot per origin and iOS offers no in-app way
    // back. A sheet whose button provably cannot work only teaches the athlete
    // that the app is broken; the settings screen holds the recovery steps.
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, true, 'denied')).toBe(false);
  });

  it('never shows on a browser with no push support at all', () => {
    browser({ standalone: true });
    expect(canShowNotificationsStep(ready, true, 'unsupported')).toBe(false);
  });

  // ── The two ways out, which must stay distinguishable ─────────────────────
  it('is gone for good after "don\'t ask again"', () => {
    browser({ standalone: true, local: { [PUSH_STEP_DISMISS_KEY]: '1' } });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(false);
  });

  it('is gone for this visit after a soft skip', () => {
    browser({ standalone: true, session: { [PUSH_STEP_SESSION_SKIP_KEY]: '1' } });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(false);
  });

  it('reads the soft skip from sessionStorage only, so it returns next visit', () => {
    // Same distinction the install step draws: a soft skip in localStorage
    // would be indistinguishable from "never ask again", collapsing the two
    // buttons into one.
    browser({ standalone: true, local: { [PUSH_STEP_SESSION_SKIP_KEY]: '1' } });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
  });

  it('retires itself once it has come back enough times to have made its point', () => {
    browser({ standalone: true, local: { [PUSH_STEP_OFFER_COUNT_KEY]: String(PUSH_STEP_MAX_OFFERS - 1) } });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
    browser({ standalone: true, local: { [PUSH_STEP_OFFER_COUNT_KEY]: String(PUSH_STEP_MAX_OFFERS) } });
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(false);
  });

  it('counts a skip, so the step can count its own way out', () => {
    const { local } = browser({ standalone: true });
    expect(pushStepOfferCount()).toBe(0);
    recordPushStepSkipped();
    expect(local[PUSH_STEP_OFFER_COUNT_KEY]).toBe('1');
    recordPushStepSkipped();
    expect(pushStepOfferCount()).toBe(2);
  });

  it('treats a corrupt offer count as zero rather than retiring the step', () => {
    browser({ standalone: true, local: { [PUSH_STEP_OFFER_COUNT_KEY]: 'not-a-number' } });
    expect(pushStepOfferCount()).toBe(0);
    expect(canShowNotificationsStep(ready, true, 'default')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The webview the club actually arrives in.
//
// Invites go out on WhatsApp, and a link tapped there opens in WhatsApp's own
// browser — which cannot install a PWA: no Add to Home Screen in its share sheet
// and no `beforeinstallprompt`. It used to be handed Safari's steps, pointing at
// a menu item that isn't there, so those members stayed in a webview for good:
// no icon, and on iOS no working notification ever (a subscription made outside
// standalone is page-origin permanently). It needs its own offer — leave this
// browser first — which means first being able to tell that we're in one.
// ─────────────────────────────────────────────────────────────────────────────
describe('isInAppBrowser', () => {
  const IOS_WEBVIEW =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

  it('spots the webviews that name themselves', () => {
    for (const ua of [
      `${IOS_WEBVIEW} WhatsApp/2.24`,
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Instagram 300.0.0',
      'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/450]',
    ]) {
      browser({ ua });
      expect(isInAppBrowser()).toBe(true);
    }
  });

  it('spots the ones that name nothing, by the Safari product they omit', () => {
    // The WhatsApp versions that send a bare WKWebView UA. Real Safari always
    // sends `Safari/<build>`; a WKWebView never does.
    browser({ ua: IOS_WEBVIEW });
    expect(isInAppBrowser()).toBe(true);
  });

  it('leaves real iPhone Safari alone — it has the Share-sheet route', () => {
    browser();
    expect(isInAppBrowser()).toBe(false);
    expect(isIosSafari()).toBe(true);
  });

  it('never fires for the installed app, which is a webview by definition', () => {
    // Getting this wrong would tell somebody who already installed to go and
    // install — inside the very icon they installed.
    browser({ ua: IOS_WEBVIEW, standalone: true });
    expect(isInAppBrowser()).toBe(false);
  });

  it('spots an Android webview and leaves Chrome alone', () => {
    browser({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
    expect(isInAppBrowser()).toBe(true);
    browser({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
    expect(isInAppBrowser()).toBe(false);
  });

  it('leaves desktop alone', () => {
    browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' });
    expect(isInAppBrowser()).toBe(false);
  });
});

describe('resetInstallOffer — the door back to step 1', () => {
  it('undoes every sticky answer, so the offer can be asked for on purpose', () => {
    // Without this the flow had an exit and no entrance: a dismissal, or three
    // visits of "not now", and this device could never be offered the icon again
    // — which on iOS also means it can never be asked for notifications, since
    // that step waits for standalone.
    const { local, session } = browser({
      local: { [INSTALL_DISMISS_KEY]: '1', [INSTALL_OFFER_COUNT_KEY]: String(INSTALL_MAX_OFFERS) },
      session: { [INSTALL_SESSION_SKIP_KEY]: '1' },
    });
    expect(isInstallStepAnswered()).toBe(true);
    resetInstallOffer();
    expect(local[INSTALL_DISMISS_KEY]).toBeUndefined();
    expect(local[INSTALL_OFFER_COUNT_KEY]).toBeUndefined();
    expect(session[INSTALL_SESSION_SKIP_KEY]).toBeUndefined();
    expect(isInstallStepAnswered()).toBe(false);
  });

  it('cannot un-install an installed app', () => {
    // The one answer that isn't a preference. Asking here would be asking
    // somebody to install the icon they already launched us from.
    browser({ standalone: true, local: { [INSTALL_DISMISS_KEY]: '1' } });
    resetInstallOffer();
    expect(isInstallStepAnswered()).toBe(true);
  });
});

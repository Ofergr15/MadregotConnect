'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isInAppBrowser, isIosDevice, isIosSafari, isStandalone } from '@/lib/pwa';
import {
  INSTALL_DISMISS_KEY,
  INSTALL_SESSION_SKIP_KEY,
  OFFER_SETTLE_MS,
  isInstallStepAnswered,
  recordInstallOfferSkipped,
  resetInstallOffer,
} from '@/lib/onboarding/first-run-order';

// ═════════════════════════════════════════════════════════════════════════════
// Step 1 of the first run: add to the home screen — BEFORE the tour, and before
// the setup checklist. Why that order, and why the answer is device-local:
// see first-run-order.ts, which holds the rules this component runs on.
//
// Why the step needs its own state machine instead of living inside
// InstallPrompt: two components need the same answer for opposite reasons.
// InstallPrompt renders the offer; FirstRunTour has to stay silent until it has
// been answered. One provider also means `beforeinstallprompt` is captured
// exactly once — it fires a single time per load and the deferred prompt it
// carries can only be used once, so two independent listeners would be two
// components fighting over one event.
// ═════════════════════════════════════════════════════════════════════════════

/** The `beforeinstallprompt` event isn't in the DOM lib types. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOffer =
  | { kind: 'prompt'; prompt: BeforeInstallPromptEvent }
  | { kind: 'ios' }
  // A webview that cannot install anything (WhatsApp, Instagram, Gmail). The
  // offer there is to leave it — see isInAppBrowser().
  | { kind: 'inapp' };

export interface InstallStepValue {
  /** What to render, or null when there is nothing to ask. */
  offer: InstallOffer | null;
  /** True once this device has answered — or can't be asked. Gates the tour. */
  answered: boolean;
  /** Installed, or an explicit "don't offer again". */
  dismissForever: () => void;
  /** "Not now" — closes for this visit, returns on the next. */
  skipForSession: () => void;
  /** Ask me again — from the setup checklist, after any kind of dismissal. */
  reopen: () => void;
  /**
   * Is there anything reopen() could usefully show on this device? False once it
   * IS the installed app, and false on a browser that cannot install at all —
   * desktop Firefox would otherwise be handed iPhone instructions.
   */
  canOffer: boolean;
}

/**
 * No provider in the tree reads as already answered. A missing install step
 * must never be able to block the tour — that's the failure mode where a unit
 * test, or any surface outside (app)/layout, silently disables onboarding.
 */
const FALLBACK: InstallStepValue = {
  offer: null,
  answered: true,
  dismissForever: () => {},
  skipForSession: () => {},
  reopen: () => {},
  canOffer: false,
};

const InstallStepContext = createContext<InstallStepValue | null>(null);

export function useInstallStep(): InstallStepValue {
  return useContext(InstallStepContext) ?? FALLBACK;
}

export function InstallStepProvider({ children }: { children: ReactNode }) {
  const [offer, setOffer] = useState<InstallOffer | null>(null);
  const [answered, setAnswered] = useState(false);
  const [canOffer, setCanOffer] = useState(false);

  // The deferred Chromium prompt, kept even after the sheet closes. It fires once
  // per load, so reopen() has nothing to re-offer unless we hold on to it here.
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  // Mirrors `offer` for the settle timer, which has to read the current value
  // without re-arming itself on every change.
  const offerRef = useRef<InstallOffer | null>(null);
  const show = useCallback((next: InstallOffer | null) => {
    offerRef.current = next;
    setOffer(next);
  }, []);

  useEffect(() => {
    // Anything to offer here at all? An iPhone always has the Share-sheet route,
    // a webview always has "open in the real browser", and Chromium answers for
    // itself when `beforeinstallprompt` arrives below.
    setCanOffer(!isStandalone() && (isIosDevice() || isInAppBrowser()));
    // Already installed, already opted out, or already waved away this visit:
    // nothing to ask, and the tour is free to start straight away.
    if (isInstallStepAnswered()) {
      setAnswered(true);
      return;
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      // Re-check, don't trust the guard above. This provider sits in the
      // persistent (app) layout, so the effect runs ONCE per load while
      // Chromium fires `beforeinstallprompt` again on every client-side
      // navigation. Without this line, pressing "לא עכשיו" and then tapping any
      // tab brought the sheet straight back — a full-screen modal over the app,
      // on every route change, for the rest of the visit. skipForSession() had
      // written the session flag correctly; this stale listener was re-opening
      // the sheet behind it.
      // (iOS Safari never fires this event — it takes the `isIosSafari()` branch
      // below, which runs inside the effect and so was never affected.)
      promptRef.current = event as BeforeInstallPromptEvent;
      setCanOffer(true);
      if (isInstallStepAnswered()) return;
      show({ kind: 'prompt', prompt: event as BeforeInstallPromptEvent });
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      localStorage.setItem(INSTALL_DISMISS_KEY, '1');
      show(null);
      setAnswered(true);
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari has no beforeinstallprompt, and no event ever tells us they
    // added the icon — they leave the browser entirely. The steps are the whole
    // offer, and the flow resumes in a brand-new session, where the standalone
    // check inside isInstallStepAnswered() above is what notices.
    // Order matters: a webview can't install, so telling it to use the Share sheet
    // sends the member looking for a menu item that does not exist there.
    if (isInAppBrowser()) show({ kind: 'inapp' });
    else if (isIosSafari()) show({ kind: 'ios' });

    const timer = setTimeout(() => {
      if (!offerRef.current) setAnswered(true);
    }, OFFER_SETTLE_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
    };
  }, [show]);

  const dismissForever = useCallback(() => {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    show(null);
    setAnswered(true);
  }, [show]);

  const skipForSession = useCallback(() => {
    sessionStorage.setItem(INSTALL_SESSION_SKIP_KEY, '1');
    // Banked across visits as well, so the offer can retire itself after a few
    // of these — on iOS nothing ever tells us the icon was added, so otherwise
    // "back next visit" runs forever (see INSTALL_MAX_OFFERS).
    recordInstallOfferSkipped();
    show(null);
    setAnswered(true);
  }, [show]);

  const reopen = useCallback(() => {
    // Clears the sticky answers first, or isInstallStepAnswered() would shut the
    // sheet again on the next render.
    resetInstallOffer();
    setAnswered(false);
    if (promptRef.current) show({ kind: 'prompt', prompt: promptRef.current });
    else if (isInAppBrowser()) show({ kind: 'inapp' });
    else show({ kind: 'ios' });
  }, [show]);

  const value = useMemo(
    () => ({ offer, answered, dismissForever, skipForSession, reopen, canOffer }),
    [offer, answered, dismissForever, skipForSession, reopen, canOffer],
  );

  return <InstallStepContext.Provider value={value}>{children}</InstallStepContext.Provider>;
}

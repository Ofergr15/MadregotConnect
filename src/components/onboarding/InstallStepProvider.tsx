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
import { isIosSafari } from '@/lib/pwa';
import {
  INSTALL_DISMISS_KEY,
  INSTALL_SESSION_SKIP_KEY,
  OFFER_SETTLE_MS,
  isInstallStepAnswered,
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
  | { kind: 'ios' };

export interface InstallStepValue {
  /** What to render, or null when there is nothing to ask. */
  offer: InstallOffer | null;
  /** True once this device has answered — or can't be asked. Gates the tour. */
  answered: boolean;
  /** Installed, or an explicit "don't offer again". */
  dismissForever: () => void;
  /** "Not now" — closes for this visit, returns on the next. */
  skipForSession: () => void;
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
};

const InstallStepContext = createContext<InstallStepValue | null>(null);

export function useInstallStep(): InstallStepValue {
  return useContext(InstallStepContext) ?? FALLBACK;
}

export function InstallStepProvider({ children }: { children: ReactNode }) {
  const [offer, setOffer] = useState<InstallOffer | null>(null);
  const [answered, setAnswered] = useState(false);

  // Mirrors `offer` for the settle timer, which has to read the current value
  // without re-arming itself on every change.
  const offerRef = useRef<InstallOffer | null>(null);
  const show = useCallback((next: InstallOffer | null) => {
    offerRef.current = next;
    setOffer(next);
  }, []);

  useEffect(() => {
    // Already installed, already opted out, or already waved away this visit:
    // nothing to ask, and the tour is free to start straight away.
    if (isInstallStepAnswered()) {
      setAnswered(true);
      return;
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
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
    if (isIosSafari()) show({ kind: 'ios' });

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
    show(null);
    setAnswered(true);
  }, [show]);

  const value = useMemo(
    () => ({ offer, answered, dismissForever, skipForSession }),
    [offer, answered, dismissForever, skipForSession],
  );

  return <InstallStepContext.Provider value={value}>{children}</InstallStepContext.Provider>;
}

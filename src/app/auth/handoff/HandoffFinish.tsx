'use client';

import { useEffect, useState } from 'react';
import { readPendingVerifier } from '@/lib/auth/login-handoff';

/**
 * Decides whether "close this window" is even true.
 *
 * The page it covers tells the member to close the sheet with the ✕ and let the
 * app finish the login. That is right in exactly one place — the in-app browser
 * sheet iOS forces on a standalone PWA — and the login asks for a handoff
 * unconditionally, so the same page was served to every other context too:
 *
 *   - WhatsApp's in-app browser, which is how the club's invite link actually
 *     gets opened. There is no ✕ anywhere on it.
 *   - an ordinary Safari tab, where the tab IS the app.
 *
 * In both, the instruction is impossible to follow and the screen is a dead end.
 * Reported 2026-09-07 with a screenshot of somebody sitting on it for four
 * minutes.
 *
 * The signal is exact and was already on disk: the PENDING VERIFIER. Whichever
 * browser partition started the login holds it. A sheet never does — it was
 * written in the app's partition, which is the whole reason the handoff exists.
 * So a verifier here means this browser can finish the login itself, and the
 * landing page's own claim does precisely that. No verifier means we really are
 * the sheet, and the ✕ really is the way out.
 */
export function HandoffFinish() {
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!readPendingVerifier()) return; // a real sheet: leave the instruction up
    setFinishing(true);
    // '/' claims the parked login with the verifier this partition kept — the
    // same path a returning app takes. replace(), so Back cannot land them here
    // again after they are signed in.
    window.location.replace('/');
  }, []);

  if (!finishing) return null;

  // Covers the "close this window" card rather than racing it: the instruction is
  // already painted (it is server-rendered, deliberately, so it survives a bad
  // connection) and it is the wrong thing to leave on screen for a browser that
  // is about to sign itself in.
  return (
    <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-page px-6" dir="rtl">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      <p className="text-sm font-medium text-ink-700">מסיימים את ההתחברות…</p>
    </div>
  );
}

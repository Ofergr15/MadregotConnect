'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { handoffContext, readPendingVerifier, type HandoffContext } from '@/lib/auth/login-handoff';

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
  const [ctx, setCtx] = useState<HandoffContext>('sheet');

  useEffect(() => {
    const next = handoffContext(!!readPendingVerifier(), navigator.userAgent, navigator.maxTouchPoints ?? 0);
    setCtx(next);
    // '/' claims the parked login with the verifier this partition kept — the
    // same path a returning app takes. replace(), so Back cannot land them here
    // again after they are signed in.
    if (next === 'finish') window.location.replace('/');
  }, []);

  // A real iOS sheet: leave the server-rendered "close with the ✕" up.
  if (ctx === 'sheet') return null;

  // Covers the "close this window" card rather than racing it: the instruction is
  // already painted (it is server-rendered, deliberately, so it survives a bad
  // connection) and it is the wrong thing to leave on screen elsewhere.
  if (ctx === 'finish') {
    return (
      <div className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-page px-6" dir="rtl">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        <p className="text-sm font-medium text-ink-700">מסיימים את ההתחברות…</p>
      </div>
    );
  }

  // 'browser': a desktop/Android tab with no ✕ and no app underneath — usually
  // the login began on another address, so this tab cannot claim it. Be honest
  // and give one way forward: sign in again from here ('/' stores a verifier in
  // THIS partition, so the second attempt finishes in this tab).
  return (
    <div className="fixed inset-0 z-10 flex flex-col items-center justify-center bg-page px-6" dir="rtl" data-testid="handoff-browser">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-ink-900">ההתחברות אושרה</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          אם התחלתם את ההתחברות בחלון או בלשונית אחרת, חזרו אליה — היא תמשיך מעצמה.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-brand-600 px-6 text-sm font-bold text-white"
        >
          המשיכו בלשונית הזו
        </Link>
      </div>
    </div>
  );
}

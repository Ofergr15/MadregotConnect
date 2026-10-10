'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Share, Plus, PartyPopper, MoreHorizontal, Compass, Link2, Check } from 'lucide-react';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';
import { isIosDevice, isStandalone } from '@/lib/pwa';
import { InstallGuide, INSTALL_GUIDE_SEEN_KEY } from '@/components/install/InstallGuide';
import { JOURNEY } from '@/components/onboarding/journey-ui';
import { useOnboardingV2 } from '@/lib/install/v2';
import { useIsComputer } from '@/lib/install/use-computer';
import { INSTALL_DISMISS_KEY, installOfferCount } from '@/lib/onboarding/first-run-order';

// ═════════════════════════════════════════════════════════════════════════════
// The install offer — step 1 of the first run, and the only screen that comes
// before the tour. All the timing lives in InstallStepProvider; this file just
// renders whichever of the two offers it hands over, because the two platforms
// genuinely differ:
//
//   'prompt' (Chromium) — the browser installs on one tap and tells us when it
//                         happened, so this is a real button.
//   'ios'              — Safari has neither, so it can only be instructions,
//                         and the flow resumes when the app is next launched
//                         from the icon.
//   'inapp'            — WhatsApp's (or Instagram's, or Gmail's) webview, which
//                         is how the club's invite links are actually opened. It
//                         cannot install a PWA at all, so the only useful step is
//                         to leave it. Without this branch these members were
//                         shown Safari's Share-sheet steps for a menu item that
//                         isn't in their browser, and stayed in a webview for
//                         good — which on iOS also means never getting a working
//                         notification.
//
// No X in the corner: this is a step now, not a nag, and every way out is a
// labelled choice — "not now" (comes back next visit) or "don't offer again".
// Tapping the backdrop is still the soft skip, so it can't trap anyone.
//
// Onboarding v2 — the guide shows ONCE (Ofer, 2026-10-10: a new member met it
// on the landing page, at the end of /join, and again here, up to four times).
// A device that has already been shown it anywhere (INSTALL_GUIDE_SEEN_KEY) or
// has already waved the offer away does not get it full screen again: the offer
// is answered for this visit on its behalf (skipForSession — exactly what its own
// "לא עכשיו" would do, so `installAnswered` and the tour behind it move on as
// before), and all the app shows is a small strip that reopens the guide when
// tapped. "×" hides that strip for a week; "don't offer again" and installing
// remove it.
// ═════════════════════════════════════════════════════════════════════════════

/** Until when this phone has hidden the "not on the home screen yet" strip. */
const STRIP_HIDE_KEY = 'pwa_install_strip_hidden_until';
const STRIP_HIDE_MS = 7 * 24 * 3600 * 1000;

export function InstallPrompt() {
  const t = useTranslations('install');
  const { offer, dismissForever, skipForSession, reopen, canOffer } = useInstallStep();
  const [copied, setCopied] = useState(false);
  const v2 = useOnboardingV2();
  const computer = useIsComputer();

  // v2's "once" (see the header). All read after mount: they touch storage.
  const [seen, setSeen] = useState<boolean | null>(null);
  const [asked, setAsked] = useState(false); // the strip was tapped this visit
  const [stripOff, setStripOff] = useState(true); // installed, opted out, or hidden for the week
  useEffect(() => {
    let wasSeen = false, off = true;
    try {
      wasSeen = localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) === '1' || installOfferCount() > 0;
      off = isStandalone() || localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
        || Number(localStorage.getItem(STRIP_HIDE_KEY) || 0) > Date.now();
    } catch { /* private mode: no strip, and the guide as before */ }
    setSeen(wasSeen);
    setStripOff(off);
    const onInstalled = () => setStripOff(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);
  // Seen before and not asked for: answer the step for this visit instead of
  // opening the guide over the app again.
  const quiet = v2 && !!offer && seen === true && !asked;
  useEffect(() => { if (quiet) skipForSession(); }, [quiet, skipForSession]);

  const copyLink = async () => {
    // The fallback for the member whose webview hides its own menu: paste the
    // address into Safari themselves. clipboard can reject (permissions, http),
    // and a failed copy must not look like a broken button — the steps above it
    // are still the primary route.
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // Escape closes it, the one keyboard gesture every dialog is expected to answer.
  // On the document rather than the backdrop div: the div isn't focusable (a
  // click-to-dismiss surface has no business in the tab order), so a handler there
  // would only fire once the user had already tabbed into the dialog. Soft skip,
  // matching a backdrop tap — Escape is "not now", not "never ask again".
  //
  // The hook has to sit above the `!offer` early return, or React sees a different
  // hook count on the render where the offer arrives.
  useEffect(() => {
    if (!offer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skipForSession();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [offer, skipForSession]);

  if (!offer) {
    // v2, phone, not installed, something to offer: the one small reminder.
    if (!v2 || computer || stripOff || !canOffer || seen === null) return null;
    const hide = () => {
      try { localStorage.setItem(STRIP_HIDE_KEY, String(Date.now() + STRIP_HIDE_MS)); } catch { /* ignore */ }
      setStripOff(true);
    };
    return (
      <div className="mx-4 mt-2 flex shrink-0 items-center gap-2 rounded-[18px] ps-3" style={{ background: JOURNEY.tagBg }} dir="rtl" data-testid="install-strip">
        <span aria-hidden className="text-lg">📲</span>
        <button type="button" onClick={() => { setAsked(true); reopen(); }} className="min-h-[44px] min-w-0 flex-1 text-start text-[14px] font-bold leading-snug" style={{ color: JOURNEY.ink }}>
          האפליקציה עוד לא על המסך הראשי · <span className="underline underline-offset-2" style={{ color: JOURNEY.tag }}>להתקנה</span>
        </button>
        <button type="button" onClick={hide} aria-label="להסתיר לשבוע" className="min-h-[44px] min-w-[44px] text-lg" style={{ color: JOURNEY.soft }}>×</button>
      </div>
    );
  }

  const install = async () => {
    if (offer.kind !== 'prompt') return;
    await offer.prompt.prompt();
    await offer.prompt.userChoice;
    // Either outcome is an answer: accepting also fires `appinstalled`, and
    // declining the browser's own dialog is a decision we shouldn't re-ask.
    setStripOff(true);
    dismissForever();
  };

  // The illustrated guide (components/install), while it is tried (lib/install/v2).
  // Same three answers as the sheet below. Not when it has been seen before and
  // nobody asked: that offer is being answered quietly (above), the strip follows.
  if (v2) {
    if (seen === null || quiet) return null;
    return (
      <InstallGuide
        canPrompt={offer.kind === 'prompt'}
        onInstall={offer.kind === 'prompt' ? install : undefined}
        onLater={skipForSession}
        onNever={() => { setStripOff(true); dismissForever(); }}
      />
    );
  }

  return (
    // The backdrop is a click-to-dismiss surface, not a control — WCAG doesn't want
    // it in the tab order, and it has two labelled buttons inside doing the same
    // job. What it was missing is Escape, the one keyboard gesture every dialog is
    // expected to answer: with no X in the corner (see above) a keyboard user's only
    // way out was to tab to "not now". `aria-labelledby` gives the dialog the name
    // it never had, so it announces as more than "dialog".
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-prompt-title"
      onClick={skipForSession}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-card px-5 pb-7 pt-6 shadow-2xl safe-bottom sm:rounded-3xl"
        data-testid="install-step"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600/15">
          <Image src="/images/icon-192.png" alt="" width={40} height={40} className="rounded-xl" />
        </div>

        {offer.kind === 'inapp' ? (
          <>
            <h2 id="install-prompt-title" className="mt-3.5 text-center text-lg font-bold leading-snug text-ink-700">
              {t('inappTitle')}
            </h2>
            <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">
              {t('inappDescription')}
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {[
                { icon: MoreHorizontal, text: t('inappIosStep1') },
                { icon: Compass, text: isIosDevice() ? t('inappIosStep2') : t('inappAndroidStep2') },
                { icon: Plus, text: t('inappIosStep3') },
              ].map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-xs font-black text-brand-600">
                    {i + 1}
                  </span>
                  <step.icon className="h-4 w-4 shrink-0 text-ink-500" />
                  <span className="text-13 text-ink-700">{step.text}</span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={copyLink}
              className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700"
            >
              {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copied ? t('inappCopied') : t('inappCopy')}
            </button>
            {/* Soft only. They have to leave this browser to act on any of it, and
                a webview that comes back is a webview that hasn't done it yet. */}
            <button
              type="button"
              onClick={skipForSession}
              className="mt-2.5 flex min-h-[48px] w-full items-center justify-center rounded-pill border border-page text-[15px] font-bold text-ink-700 active:bg-page"
            >
              {t('skip')}
            </button>
          </>
        ) : offer.kind === 'ios' ? (
          <>
            <h2 id="install-prompt-title" className="mt-3.5 text-center text-lg font-bold leading-snug text-ink-700">{t('title')}</h2>
            <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">
              {t('description')}
            </p>
            <ol className="mt-4 flex flex-col gap-3">
              {[
                { icon: Share, text: t('iosStep1') },
                { icon: Plus, text: t('iosStep2') },
                { icon: PartyPopper, text: t('iosStep3') },
              ].map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-brand-600/15 text-xs font-black text-brand-600">
                    {i + 1}
                  </span>
                  <step.icon className="h-4 w-4 shrink-0 text-ink-500" />
                  <span className="text-13 text-ink-700">{step.text}</span>
                </li>
              ))}
            </ol>
            {/* Soft, not permanent: if they DIDN'T actually add the icon we want
                to ask again next visit, and if they did, isStandalone() means
                they never see this screen again anyway. */}
            <button
              type="button"
              onClick={skipForSession}
              className="mt-5 flex min-h-[48px] w-full items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700"
            >
              {t('understood')}
            </button>
          </>
        ) : (
          <>
            <h2 id="install-prompt-title" className="mt-3.5 text-center text-lg font-bold leading-snug text-ink-700">{t('title')}</h2>
            <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">
              {t('description')}
            </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={install}
              className="flex min-h-[48px] w-full items-center justify-center rounded-pill bg-brand-600 text-[15px] font-bold text-white active:bg-brand-700"
            >
              {t('installButton')}
            </button>
            <button
              type="button"
              onClick={skipForSession}
              className="flex min-h-[48px] w-full items-center justify-center rounded-pill border border-page text-[15px] font-bold text-ink-700 active:bg-page"
            >
              {t('skip')}
            </button>
          </div>
          </>
        )}

        <button
          type="button"
          onClick={dismissForever}
          className="mx-auto mt-3.5 block text-2xs font-light text-ink-400 underline"
        >
          {t('dontAskAgain')}
        </button>
      </div>
    </div>
  );
}

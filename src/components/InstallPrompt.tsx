'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Share, Plus, PartyPopper } from 'lucide-react';
import { useInstallStep } from '@/components/onboarding/InstallStepProvider';

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
//
// No X in the corner: this is a step now, not a nag, and every way out is a
// labelled choice — "not now" (comes back next visit) or "don't offer again".
// Tapping the backdrop is still the soft skip, so it can't trap anyone.
// ═════════════════════════════════════════════════════════════════════════════

export function InstallPrompt() {
  const t = useTranslations('install');
  const { offer, dismissForever, skipForSession } = useInstallStep();

  if (!offer) return null;

  const install = async () => {
    if (offer.kind !== 'prompt') return;
    await offer.prompt.prompt();
    await offer.prompt.userChoice;
    // Either outcome is an answer: accepting also fires `appinstalled`, and
    // declining the browser's own dialog is a decision we shouldn't re-ask.
    dismissForever();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      role="dialog"
      aria-modal="true"
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

        <h2 className="mt-3.5 text-center text-lg font-bold leading-snug text-ink-700">{t('title')}</h2>
        <p className="mx-auto mt-2 max-w-[300px] text-center text-13 font-light leading-relaxed text-ink-400">
          {t('description')}
        </p>

        {offer.kind === 'ios' ? (
          <>
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

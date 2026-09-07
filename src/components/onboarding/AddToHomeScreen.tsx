'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Share, PartyPopper } from 'lucide-react';
import { isIosDevice, isStandalone } from '@/lib/pwa';
import { useInstallStep } from './InstallStepProvider';

// ═════════════════════════════════════════════════════════════════════════════
// "Add it to your home screen" as an INLINE card rather than a modal sheet.
//
// InstallPrompt already offers this, but it is a full-screen sheet mounted in
// (app)/layout — so it exists only for people who are already inside the app, and
// it covers whatever is behind it. Neither works on the waiting screen, which is
// where this belongs most: somebody stuck between signing in and being approved
// has nothing to do, and adding the icon is the one useful thing they CAN do with
// that time. On iOS it is also a precondition rather than a nicety — push
// notifications only arrive app-natively when the subscription was created while
// running from the home-screen icon (see first-run-order.ts), so a member who
// never installs never gets notified about anything, including their approval.
//
// Renders nothing when there is nothing to say: already installed, or a browser
// that can neither install nor be given instructions (desktop Firefox would
// otherwise be handed iPhone Share-sheet steps).
// ═════════════════════════════════════════════════════════════════════════════

export function AddToHomeScreen() {
  const t = useTranslations('install');
  const { offer } = useInstallStep();
  // Read in an effect, not at render: both of these touch `window`, and the page
  // this sits on is server-rendered first.
  const [device, setDevice] = useState<'unknown' | 'installed' | 'ios' | 'other'>('unknown');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDevice(isStandalone() ? 'installed' : isIosDevice() ? 'ios' : 'other');
  }, []);

  // The deferred Chromium prompt, held by the provider. Absent on iOS (no such
  // event) and absent in any browser that cannot install.
  const chromiumPrompt = offer?.kind === 'prompt' ? offer.prompt : null;

  const install = async () => {
    if (!chromiumPrompt) return;
    setBusy(true);
    try {
      await chromiumPrompt.prompt();
      await chromiumPrompt.userChoice;
    } catch {
      // The browser refused to show it (already used once, or the gesture was
      // lost). Nothing to say — the button simply comes back.
    }
    setBusy(false);
  };

  if (device === 'unknown' || device === 'installed') return null;
  // A non-iOS browser with no deferred prompt cannot install and has no steps
  // worth printing.
  if (device === 'other' && !chromiumPrompt) return null;

  return (
    <div className="mt-4 rounded-card bg-page p-3.5 text-start" dir="rtl">
      <p className="text-sm font-bold text-ink-700">{t('title')}</p>
      <p className="mt-1 text-xs font-light leading-relaxed text-ink-500">{t('description')}</p>

      {device === 'ios' ? (
        <ol className="mt-3 space-y-2">
          {[
            { icon: Share, text: t('iosStep1') },
            { icon: Plus, text: t('iosStep2') },
            { icon: PartyPopper, text: t('iosStep3') },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-tile bg-card">
                <Icon className="h-3.5 w-3.5 text-brand-600" />
              </span>
              <span className="pt-1 text-xs font-light leading-relaxed text-ink-600">{text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-pill bg-brand-600 text-sm font-bold text-white active:bg-brand-700 disabled:opacity-60"
        >
          {t('installButton')}
        </button>
      )}
    </div>
  );
}

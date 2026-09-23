'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Volume2, Vibrate, X, ChevronDown, ChevronUp } from 'lucide-react';

const DISMISS_KEY = 'watch_alerts_card_dismissed';

/**
 * Athlete-facing tip explaining that pushed workouts already beep/vibrate at
 * each step on the watch, and how to turn on Garmin Audio Prompts for spoken
 * pace/lap cues. This is the "A" of the A+B audio work — no watch integration
 * needed, just guidance. Dismissible and remembered in localStorage.
 *
 * Copy lives in messages/*.json under `watchAlerts` — it was hard-coded English,
 * the only English card on the Hebrew settings screen.
 */
export function WatchAlertsCard() {
  const t = useTranslations('watchAlerts');
  const [dismissed, setDismissed] = useState(true); // default hidden until we read storage
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (dismissed) return null;

  const strong = (chunks: ReactNode) => <span className="text-ink-700 font-medium">{chunks}</span>;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <section className="bg-card/30 rounded-card border border-page/20 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="bg-brand-600/20 w-10 h-10 rounded-full flex items-center justify-center shrink-0">
          <Volume2 className="h-5 w-5 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink-700">{t('title')}</h3>
            {/* A 44px box around the 16px glyph, pulled into the corner so the
                title row keeps its height. */}
            <button onClick={dismiss} className="-m-3 flex h-11 w-11 shrink-0 items-center justify-center text-ink-400 hover:text-ink-900" aria-label={t('dismiss')}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-1">
            {t.rich('body', { b: strong })}
          </p>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="-mb-2 flex min-h-[44px] items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {t('moreToggle')}
          </button>

          {expanded && (
            <div className="mt-2 space-y-2 text-xs text-ink-400">
              <p className="flex items-start gap-2">
                <Vibrate className="h-3.5 w-3.5 text-ink-400 mt-0.5 shrink-0" />
                <span>
                  {t('autoStep')}
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Volume2 className="h-3.5 w-3.5 text-ink-400 mt-0.5 shrink-0" />
                <span>
                  {t.rich('audioPrompts', { b: strong })}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect } from 'react';
import { wasOffered } from '@/lib/tour/engine';
import { dispatchTour, getTour } from '@/lib/tour/store';
import { useTourPrefs } from '@/lib/tour/use-prefs';

// Offers the coach tour once: the first time a coach lands on the coach area, after the
// screen has drawn (the tour's first step needs "מחכה לך" or the trainees there). "אחר כך",
// "דילוג" and finishing all count as offered (lib/tour/prefs.ts) — it is never pushed again.
export function CoachTourOffer({ enabled }: { enabled: boolean }) {
  const { prefs, ready } = useTourPrefs(enabled);
  useEffect(() => {
    if (!enabled || !ready || wasOffered(prefs.tours.coach)) return;
    const t = window.setTimeout(() => {
      const on = document.querySelector('[data-tour="coach-waiting"], [data-tour="coach-trainees"]');
      if (on && getTour().phase === 'idle') dispatchTour({ type: 'OFFER', tour: 'coach' });
    }, 900);
    return () => window.clearTimeout(t);
  }, [enabled, ready, prefs.tours.coach]);
  return null;
}

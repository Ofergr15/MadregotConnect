'use client';

import { useEffect } from 'react';
import { shouldOfferCoachTour } from '@/lib/tour/switch';
import { dispatchTour, getTour } from '@/lib/tour/store';
import { useTourPrefs } from '@/lib/tour/use-prefs';

// Offers the coach tour once, and only while the club switch is on (lib/tour/switch.ts): the first time a coach lands on the coach area, after the
// screen has drawn (the tour's first step needs "מחכה לך" or the trainees there). "אחר כך",
// "דילוג" and finishing all count as offered (lib/tour/prefs.ts) — it is never pushed again.
export function CoachTourOffer({ enabled }: { enabled: boolean }) {
  const { prefs, ready, on } = useTourPrefs(enabled);
  useEffect(() => {
    if (!enabled || !shouldOfferCoachTour({ on, ready, stored: prefs.tours.coach })) return;
    const t = window.setTimeout(() => {
      const on = document.querySelector('[data-tour="coach-waiting"], [data-tour="coach-trainees"]');
      if (on && getTour().phase === 'idle') dispatchTour({ type: 'OFFER', tour: 'coach' });
    }, 900);
    return () => window.clearTimeout(t);
  }, [enabled, ready, on, prefs.tours.coach]);
  return null;
}

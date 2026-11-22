'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TEST_PREVIEW_NOTE, U21_TRACKS } from '@/lib/u21/intake';
import { u21EntryHref } from '@/lib/u21/entry';
import { cn } from '@/lib/utils';

/**
 * The U21 section at the bottom of the registration page (/register), per
 * Ofer's voice note (Nov 19): a section "למטה" on עמוד ההרשמה where no Strava
 * or Google connection is asked, then track selection and straight in.
 *
 * This is a feasibility demo ("להראות את ההיתכנות"): no prices, no billing,
 * no eligibility check — picking a track only deep-links into the /u21 intake
 * with that track preselected. Protection/verification mechanisms are a later
 * layer, so the test-preview notice rides along here too.
 *
 * A plain white card so the same component reads on both /register looks: the
 * dark photo layout and the light onboarding-v2 journey.
 */
/**
 * Default OFF (gated rollout): renders only when the club-wide server flag `u21_entry` is on,
 * read signed-out from GET /api/features/public. Unknown / error = off, so nothing flashes.
 */
export function useU21EntryOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/features/public', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (live) setOn(j?.features?.u21_entry === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return on;
}

export function U21RegisterEntry({ className }: { className?: string }) {
  const on = useU21EntryOn();
  if (!on) return null;
  return (
    <section dir="rtl" lang="he" aria-label="מאמן אישי U21" className={cn('px-5 py-10', className)}>
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-5 shadow-sm" data-testid="u21-register-entry">
        <h2 className="text-xl font-bold text-gray-900">מאמן אישי U21 · גילאי 16–21</h2>
        <p className="mt-1 text-sm text-gray-600">
          תוכנית שבועית לריצה, כוח ומוביליטי — בלי חיבור לסטראבה או לגוגל. בוחרים מסלול ונכנסים.
        </p>
        <div className="mt-4 space-y-2">
          {U21_TRACKS.map(t => (
            <Link
              key={t.id}
              href={u21EntryHref(t.id)}
              className="flex items-center justify-between rounded-xl border-2 border-gray-200 px-4 py-3 transition hover:border-gray-900"
            >
              <span className="font-bold text-gray-900">{t.name}</span>
              <span className="text-sm text-gray-600">{t.tagline}</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-medium text-red-800">
          {TEST_PREVIEW_NOTE}
        </p>
      </div>
    </section>
  );
}

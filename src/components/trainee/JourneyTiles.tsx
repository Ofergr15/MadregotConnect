'use client';

import { useTranslations } from 'next-intl';
import { fmtKm } from '@/lib/academy/pace-verdict';
import type { HomeJourney } from '@/lib/academy/trainee-home';

// ── "המסע שלי": the long-run numbers ─────────────────────────────────────────────────────
//
// Moved out of AcademyMyView unchanged (the numbers are /api/academy/me's `journey`,
// computed by lib/academy/trainee-home.ts journeyPlanStats / monthsBetween). Shown below
// the fold of 7ג under the trainee experience v2, and still on the old academy home.

export function JourneyTiles({ journey, title = true }: { journey: HomeJourney; title?: boolean }) {
  const t = useTranslations('trainee.tests.journey');
  return (
    <section className="flex flex-col gap-[7px]">
      {title && <h2 className="px-0.5 text-[15px] font-black text-ink-700">{t('title')}</h2>}
      <div className="grid grid-cols-3 gap-[7px]">
        <JourneyTile value={journey.monthsWithUs != null ? String(journey.monthsWithUs) : '—'} label={t('months')} />
        <JourneyTile value={String(journey.runs)} label={t('runs')} />
        <JourneyTile value={String(journey.km)} label={t('km')} />
        <JourneyTile value={journey.planPct != null ? `${journey.planPct}%` : '—'} label={t('planPct')} />
        <JourneyTile value={String(journey.streakWeeks)} label={t('streak')} />
        <JourneyTile value={journey.longestKm != null ? fmtKm(journey.longestKm * 1000) : '—'} label={t('longest')} />
      </div>
    </section>
  );
}

function JourneyTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[14px] bg-card px-2 py-[9px] text-center">
      <b className="block text-[21px] font-black leading-tight text-ink-700"><bdi dir="ltr">{value}</bdi></b>
      <span className="text-2xs text-ink-400">{label}</span>
    </div>
  );
}

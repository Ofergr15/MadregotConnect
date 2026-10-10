'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
import { getViewedPerson, type ViewedPerson } from '@/lib/view-as-person';
import { progressView, type ProgressView } from '@/lib/academy/progress';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import { Segmented } from '@/components/trainee/ui';
import { ProgressScreen } from '@/components/trainee/ProgressScreen';
import { ThresholdScreen } from '@/components/trainee/ThresholdScreen';
import { BodyScreen } from '@/components/trainee/BodyScreen';

// "התקדמות" — the trainee's progress tab (trainee-experience-v2 screens 7, 7ג, 8):
//
//   (no ?view)    7   fitness, fatigue, form, the build rate, the threshold row
//   ?view=tests   7ג  the threshold pace and every test, the next one, the journey
//   ?view=body    8   resting HR, sleep, feel against the trainee's own range
//
// One segmented header switches between the three, in the URL, so the home's chips and
// a push land on the right one. `?athleteId=` is for a coach looking at a trainee; who may
// read whose numbers is each route's decision (`mayCoach`), not this page's — exactly as
// /dashboard/academy/week. Viewing the app as somebody shows theirs.

function Progress() {
  const t = useTranslations('trainee.progress');
  const params = useSearchParams();
  const router = useRouter();
  const own = useAthleteId();
  const [viewed, setViewed] = useState<ViewedPerson | null>(null);
  useEffect(() => { setViewed(getViewedPerson()); }, []);
  const linked = params.get('athleteId');
  const athleteId = linked || (viewed ? viewed.id : own);
  const view = progressView(params.get('view'));

  // The name, gender, coach and journey — the board's own read, so usually already cached.
  const { data: home } = useApi<TraineeHome>(athleteId ? `/api/academy/me?athleteId=${encodeURIComponent(athleteId)}` : null);
  if (!athleteId) return null;

  const hrefFor = (v: ProgressView) => {
    const q = new URLSearchParams();
    if (v !== 'progress') q.set('view', v);
    if (linked) q.set('athleteId', linked);
    const s = q.toString();
    return s ? `/dashboard/academy/progress?${s}` : '/dashboard/academy/progress';
  };
  const gender = home?.athlete?.gender ?? 'other';
  const coach = (home?.coaches?.[0] ?? home?.coach)?.name?.split(' ')[0] ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2.5 sm:px-6 sm:py-8" dir="rtl">
      <h1 className="sr-only">{t('title')}</h1>
      <Segmented value={view} label={t('tabs.label')} onChange={v => router.replace(hrefFor(v), { scroll: false })}
        options={(['progress', 'tests', 'body'] as const).map(v => ({ value: v, label: t(`tabs.${v}`) }))} />
      {view === 'tests' ? (
        <ThresholdScreen athleteId={athleteId} home={home ?? null} />
      ) : view === 'body' ? (
        <BodyScreen athleteId={athleteId} coachName={coach} />
      ) : (
        <ProgressScreen athleteId={athleteId} gender={gender} testsHref={hrefFor('tests')} />
      )}
    </div>
  );
}

export default function AcademyProgressPage() {
  return <Suspense fallback={null}><Progress /></Suspense>;
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { useAthleteId } from '@/lib/use-athlete-id';
import { getViewedPerson, type ViewedPerson } from '@/lib/view-as-person';
import { progressView, type ProgressView } from '@/lib/academy/progress';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { isViewingPerson } from '@/lib/view-as-person';
import { useHideShellHeader } from '@/lib/shell-chrome';
import { ProgressScreen } from '@/components/trainee/ProgressScreen';
import { ThresholdScreen } from '@/components/trainee/ThresholdScreen';
import { BodyScreen } from '@/components/trainee/BodyScreen';
import { TOP_BAR } from '@/components/trainee/ui';

// "התקדמות" — the trainee's progress tab (trainee-experience-v2 screens 7, 7ג, 8):
//
//   (no ?view)    7   fitness, fatigue, form, the build rate, the threshold row
//   ?view=tests   7ג  the threshold pace and every test, the next one, the journey
//   ?view=body    8   resting HR, sleep, feel against the trainee's own range
//
// The mockup's own top rows: 7 is titled "התקדמות"; 7ג and 8 carry "‹ התקדמות" and their
// title, reached from 7's threshold and body rows (and from the home's chips, a push, or
// ?test=mine). On the trainee's own phone the shell's header folds away for them, as on the
// home (lib/shell-chrome.ts), so the numbers start at the top — not under a 103px header and
// a segmented row. `?athleteId=` is for a coach looking at a trainee; who may
// read whose numbers is each route's decision (`mayCoach`), not this page's — exactly as
// /dashboard/academy/week. Viewing the app as somebody shows theirs.

function Progress() {
  const t = useTranslations('trainee.progress');
  const params = useSearchParams();
  const own = useAthleteId();
  const [viewed, setViewed] = useState<ViewedPerson | null>(null);
  useEffect(() => { setViewed(getViewedPerson()); }, []);
  const linked = params.get('athleteId');
  const athleteId = linked || (viewed ? viewed.id : own);
  const view = progressView(params.get('view'));
  const [viewingAs] = useState(isViewingPerson);
  // Only on the trainee's own screens: a coach reading a trainee (?athleteId=) keeps the shell.
  useHideShellHeader(!viewingAs && !linked);

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

  const folded = !viewingAs && !linked;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2.5 sm:px-6 sm:py-8" dir="rtl">
      <div className={cn('relative flex min-h-[44px] items-center justify-center', folded && TOP_BAR)}>
        {view !== 'progress' && (
          <Link href={hrefFor('progress')} replace scroll={false}
            className="absolute start-0 flex min-h-[44px] items-center gap-0.5 text-[16px] font-bold text-brand-600">
            <ChevronRight className="h-5 w-5" aria-hidden />{t('back')}
          </Link>
        )}
        <h1 className="text-[17px] font-black text-ink-900">{view === 'progress' ? t('title') : t(`tabs.${view}`)}</h1>
      </div>
      {view === 'tests' ? (
        <ThresholdScreen athleteId={athleteId} home={home ?? null} focusTests={params.get('test') === 'mine'} />
      ) : view === 'body' ? (
        <BodyScreen athleteId={athleteId} coachName={coach} />
      ) : (
        <ProgressScreen athleteId={athleteId} gender={gender} testsHref={hrefFor('tests')} bodyHref={hrefFor('body')} journey={home?.journey ?? null} />
      )}
    </div>
  );
}

export default function AcademyProgressPage() {
  return <Suspense fallback={null}><Progress /></Suspense>;
}

'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAthleteId } from '@/lib/use-athlete-id';
import { WeekBoard } from '@/components/academy/book/WeekBoard';

// The week (workout book v3, mockup phone 4): `?athleteId=` for a coach looking at a
// trainee, nothing for a trainee looking at their own. Who may read whose week is the
// route's decision (`mayCoach`), not this page's.
function Week() {
  const params = useSearchParams();
  const own = useAthleteId();
  const athleteId = params.get('athleteId') || own;
  if (!athleteId) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <WeekBoard athleteId={athleteId} initialWeek={params.get('weekStart')} />
    </div>
  );
}

export default function AcademyWeekPage() {
  return <Suspense fallback={null}><Week /></Suspense>;
}

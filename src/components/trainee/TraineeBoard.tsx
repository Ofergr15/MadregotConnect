'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { EmptyState, Sheet, SkeletonList } from '@/components/ui';
import { academyBoardUrl, type BoardView } from '@/lib/academy/deep-links';
import { joinHebrewList } from '@/lib/academy/members';
import { weekStartOf } from '@/lib/academy/pmc';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import { WeekBoard } from '@/components/academy/book/WeekBoard';
import { AcademyThreadPanel } from '@/components/academy/AcademyThreadPanel';
import { isViewingPerson } from '@/lib/view-as-person';
import { useHideShellHeader } from '@/lib/shell-chrome';
import { MonthBoard } from './MonthBoard';

// ── "לוח": the trainee lens of /dashboard/academy under the trainee experience v2 ────────
//
// The week (screen 2) or the month (screen 3), one switch between them, both in the URL
// (`?view=month`, `?open=<date>` — lib/academy/deep-links.ts) so a push or a shared link
// lands on the same thing a tap would. `?thread=mine` opens the conversation over the
// board, as it did over the old academy home.
//
// The tests, the invitation and the journey tiles live on the progress tab now (7ג,
// trainee/ThresholdScreen.tsx); `?test=mine` is redirected there by the academy page.

export function TraineeBoard({ athleteId, view, openDate, openThread = false }: {
  /** `null` while the id is still being read from storage; `''` once we've looked and found nobody. */
  athleteId: string | null;
  view: BoardView;
  openDate: string | null;
  openThread?: boolean;
}) {
  const t = useTranslations('academy');
  const tw = useTranslations('trainee.week');
  const router = useRouter();
  // The week a deep-linked day lives in. Kept after the workout is closed, so closing a day
  // opened from the month leaves the trainee on that day's week, not back on this one.
  const [anchor, setAnchor] = useState<string | null>(openDate ? weekStartOf(openDate) : null);
  useEffect(() => { if (openDate) setAnchor(weekStartOf(openDate)); }, [openDate]);
  const [threadOpen, setThreadOpen] = useState(false);
  // Like the home and the progress tab: the board's own title row is the top bar (mockup
  // 2 and 3), so the app header does not push Saturday and the legend off the screen.
  const [viewingAs] = useState(isViewingPerson);
  useHideShellHeader(!viewingAs);

  const { data, isLoading } = useApi<TraineeHome>(athleteId ? `/api/academy/me?athleteId=${encodeURIComponent(athleteId)}` : null);

  const go = useCallback((next: { view?: BoardView; open?: string | null }) => {
    router.replace(academyBoardUrl({ view: next.view ?? view, open: next.open ?? null }), { scroll: false });
  }, [router, view]);

  // A push lands here with `?thread=mine`; followed when it flips, like the old home.
  useEffect(() => { if (openThread) setThreadOpen(true); }, [openThread]);

  if (athleteId === null || (!!athleteId && isLoading && !data)) {
    return <div className="p-4"><SkeletonList count={6} /></div>;
  }
  if (!athleteId || (data && !data.isMember)) {
    return <EmptyState icon={GraduationCap} title={t('notMemberTitle')} description={t('notMemberDesc')} />;
  }

  const coaches = data?.coaches?.length ? data.coaches : data?.coach ? [data.coach] : [];
  const coachFirst = coaches.length ? joinHebrewList(coaches.map(c => c.name.split(' ')[0])) : null;
  const self = data?.athlete?.athleteId ?? athleteId;

  return (
    // -mb-4: the scroll box's bottom padding taken back, as on the home, so a week whose
    // Saturday and legend fit (mockup 2) does not scroll.
    <div className="-mb-4 flex flex-col gap-2.5 md:mb-0" dir="rtl">
      {view === 'month' ? (
        <MonthBoard
          athleteId={self}
          onView={v => go({ view: v })}
          onOpenDay={date => go({ view: 'week', open: date })}
          topBar={!viewingAs}
        />
      ) : (
        <WeekBoard
          // A day opened from the month (or a link) can be in another week: start there.
          key={anchor ?? 'now'}
          athleteId={self}
          initialWeek={anchor}
          openDate={openDate}
          onView={v => go({ view: v })}
          onClosed={() => { if (openDate) go({ view: 'week', open: null }); }}
          topBar={!viewingAs}
        />
      )}

      <Sheet
        open={threadOpen}
        onOpenChange={setThreadOpen}
        title={coachFirst ? tw('thread', { name: coachFirst }) : tw('threadMine')}
        className="h-[88dvh]"
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden pb-3"
      >
        {threadOpen && <AcademyThreadPanel athleteId={self} layout="sheet" className="min-h-0 flex-1" />}
      </Sheet>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { EmptyState, Sheet, SkeletonList } from '@/components/ui';
import { academyBoardUrl, type BoardView } from '@/lib/academy/deep-links';
import { joinHebrewList } from '@/lib/academy/members';
import { weekStartOf } from '@/lib/academy/pmc';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import type { TestInvitation } from '@/lib/academy/testInvite';
import { WeekBoard } from '@/components/academy/book/WeekBoard';
import { AcademyThreadPanel } from '@/components/academy/AcademyThreadPanel';
import { MyInvitation } from '@/components/academy/MyInvitation';
import { MyJourney } from '@/components/academy/AcademyMyView';
import { MonthBoard } from './MonthBoard';

// ── "לוח": the trainee lens of /dashboard/academy under the trainee experience v2 ────────
//
// The week (screen 2) or the month (screen 3), one switch between them, both in the URL
// (`?view=month`, `?open=<date>` — lib/academy/deep-links.ts) so a push or a shared link
// lands on the same thing a tap would. `?thread=mine` opens the conversation over the
// board, as it did over the old academy home.
//
// Until the progress tab (package 4) takes them, the invitation, the journey tiles and the
// tests card sit below the board, and `?test=mine` scrolls to them.

export function TraineeBoard({ athleteId, view, openDate, openThread = false, raiseTest = false }: {
  /** `null` while the id is still being read from storage; `''` once we've looked and found nobody. */
  athleteId: string | null;
  view: BoardView;
  openDate: string | null;
  openThread?: boolean;
  raiseTest?: boolean;
}) {
  const t = useTranslations('academy');
  const tw = useTranslations('trainee.week');
  const router = useRouter();
  // The week a deep-linked day lives in. Kept after the workout is closed, so closing a day
  // opened from the month leaves the trainee on that day's week, not back on this one.
  const [anchor, setAnchor] = useState<string | null>(openDate ? weekStartOf(openDate) : null);
  useEffect(() => { if (openDate) setAnchor(weekStartOf(openDate)); }, [openDate]);
  const [threadOpen, setThreadOpen] = useState(false);
  const [hasInvitation, setHasInvitation] = useState(false);
  const [invitation, setInvitation] = useState<TestInvitation | null>(null);
  const [resultJustSent, setResultJustSent] = useState(false);
  const testsRef = useRef<HTMLDivElement>(null);
  const invitationRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useApi<TraineeHome>(athleteId ? `/api/academy/me?athleteId=${encodeURIComponent(athleteId)}` : null);

  const go = useCallback((next: { view?: BoardView; open?: string | null }) => {
    router.replace(academyBoardUrl({ view: next.view ?? view, open: next.open ?? null }), { scroll: false });
  }, [router, view]);

  // A push lands here with `?thread=mine`; followed when it flips, like the old home.
  useEffect(() => { if (openThread) setThreadOpen(true); }, [openThread]);

  const loaded = !!data?.isMember;
  useEffect(() => {
    if (!raiseTest || !loaded) return;
    const id = setTimeout(() => {
      (hasInvitation ? invitationRef.current : testsRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => clearTimeout(id);
  }, [raiseTest, loaded, hasInvitation]);

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
    <div className="flex flex-col gap-2.5" dir="rtl">
      {view === 'month' ? (
        <MonthBoard
          athleteId={self}
          onView={v => go({ view: v })}
          onOpenDay={date => go({ view: 'week', open: date })}
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
        />
      )}

      {data?.athlete?.athleteId && (
        <div ref={invitationRef} className={hasInvitation ? 'mt-3' : 'hidden'}>
          <MyInvitation
            athleteId={data.athlete.athleteId}
            watchConnected={data.athlete.hasWatch}
            onVisible={setHasInvitation}
            onInvitation={setInvitation}
            resultJustSent={resultJustSent}
          />
        </div>
      )}
      {data?.journey && (
        <MyJourney
          journey={data.journey}
          athlete={data.athlete ?? null}
          invitation={invitation}
          testsRef={testsRef}
          onRecorded={() => setResultJustSent(true)}
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

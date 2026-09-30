'use client';

/**
 * /dashboard/share?what=run|week — where What's new's two headline buttons go
 * (lib/whats-new/evening.ts).
 *
 * It opens the share editor straight on the reader's own material: their last
 * run, or the seven days that end today with the week before them for the
 * comparison. A button that said "try it on your last run" and then left you on
 * a list to find it would not be the button it says it is.
 *
 * Nothing new on the server: the run is the newest row of /api/activities
 * (scope=self) and its feed item comes from the same by-activity lookup the run
 * page's share uses; the week is folded here, like WeekSummaryCard does.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Share2 } from 'lucide-react';
import { Button, EmptyState, LoadingBlock } from '@/components/ui';
import { ShareSheet } from '@/components/ShareSheet';
import { apiHeaders } from '@/lib/api';
import { fetchActivities } from '@/lib/activities-client';
import { fetchFeedItemByActivity } from '@/lib/feed-client';
import {
  buildLast7Report, withWellness, type ReportActivity, type WellnessNight,
} from '@/lib/reports/last-7-days';
import type { ShareSubject } from '@/lib/share/sheet-model';
import { addDaysToDateStr, israelToday } from '@/lib/utils';

async function lastRun(): Promise<ShareSubject | null> {
  const res = await fetchActivities({ selfOnly: true, limit: 1 });
  if (!res.ok) return null;
  const act = ((await res.json()).activities ?? [])[0] as { id?: string } | undefined;
  if (!act?.id) return null;
  const { item } = await fetchFeedItemByActivity(act.id);
  return item?.activity ? { kind: 'workout', item } : null;
}

async function thisWeek(): Promise<ShareSubject | null> {
  // Fifteen days for the week before, and a day of slack either side, as on the feed card.
  const [res, nights] = await Promise.all([
    fetchActivities({ selfOnly: true, sinceDays: 15 }),
    fetch('/api/wellness?days=16', { headers: await apiHeaders() })
      .then(r => (r.ok ? r.json() : { nights: [] }))
      .then(d => (d.nights || []) as WellnessNight[])
      .catch(() => [] as WellnessNight[]),
  ]);
  if (!res.ok) return null;
  const acts = ((await res.json()).activities ?? []) as ReportActivity[];
  const today = israelToday();
  const report = withWellness(buildLast7Report(acts, today), nights);
  if (report.runs === 0) return null;
  return {
    kind: 'week',
    report,
    previous: withWellness(buildLast7Report(acts, addDaysToDateStr(today, -7)), nights),
    nights,
    athleteName: localStorage.getItem('athlete_name') || null,
  };
}

export default function SharePage() {
  const t = useTranslations('sharePage');
  const router = useRouter();
  const [what, setWhat] = useState<'run' | 'week' | null>(null);
  const [subject, setSubject] = useState<ShareSubject | null | undefined>(undefined);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get('what') === 'week' ? 'week' : 'run';
    setWhat(w);
    let cancelled = false;
    (w === 'week' ? thisWeek() : lastRun())
      .catch(() => null)
      .then(s => { if (!cancelled) setSubject(s); });
    return () => { cancelled = true; };
  }, []);

  const leave = () => {
    setOpen(false);
    // Back to wherever the button was (the feed, nearly always); straight in from a
    // link there is nothing behind, so the feed.
    if (window.history.length > 1) router.back();
    else router.replace('/feed');
  };

  if (subject === undefined || !what) return <LoadingBlock className="min-h-[60vh]" />;

  if (!subject) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <EmptyState
          icon={Share2}
          titleAs="h1"
          title={t(what === 'week' ? 'noWeek' : 'noRun')}
          description={t(what === 'week' ? 'noWeekBody' : 'noRunBody')}
          action={<Button onClick={() => router.replace('/feed')}>{t('toFeed')}</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <LoadingBlock className="min-h-[60vh]" />
      {open && <ShareSheet subject={subject} onClose={leave} />}
    </>
  );
}

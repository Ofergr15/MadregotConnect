'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { formatPace } from '@/components/activity/format';
import { apiHeaders } from '@/lib/api';
import { ImprovementChart } from './ImprovementChart';
import { RecordTest } from './RecordTest';
import { metres } from './PendingTests';
import type { PendingSubmission } from './PendingTests';
import type { TrendSeries } from '@/lib/academy/tests';

// ── The trainee's own side of the test ───────────────────────────────────────
//
// Two things the athlete could not do before: see their own improvement graph, and put a
// test in without going through Ofer. The graph is the whole emotional payload of the
// feature — "5:08 → 4:40 over seven months" is why anybody keeps testing — and the entry
// form is what stops every result waiting on one person's evening.
//
// The honesty problem this screen has to solve: a submitted test is NOT a recorded test. It
// counts toward nothing until the coach approves it (the API filters pending out of the
// threshold, the trend, and the staleness clock), so a confirmation that says "נשמר" and a
// graph that does not move would read as a bug in the app. Hence the waiting card, in the
// athlete's own words: the number is in, the coach has to look at it, nothing changed yet.
//
// No `excludedReason` here and none possible: throwing a test out of the trend is a
// coaching judgement, and the route drops the field for a non-staff caller regardless of
// what this component sends.

interface MyTestResponse {
  trend?: TrendSeries;
  pending?: PendingSubmission[];
  tableMissing?: boolean;
}

/** `2026-09-14` → `14.09`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

/**
 * "Sent, and nothing has changed yet."
 *
 * Exported so the preview route can render it without a session, because the athlete lens
 * is unreachable for staff — `dashboard/academy` returns the coach console before it ever
 * gets here — and this card is the one screen in the feature nobody on the coaching side
 * can see on their own account.
 *
 * band-2, not the queue's brand tint: for the coach a submission is a decision waiting on
 * them, and for the athlete it is a state they cannot act on. Naming what does NOT happen
 * is the whole job of the card — a confirmation saying "נשמר" above a graph that has not
 * moved reads as a broken app, not as a pending approval.
 */
export function WaitingCard({ item }: { item: PendingSubmission }) {
  return (
    <div className="rounded-card bg-band-2/10 px-3.5 py-3">
      <p className="flex items-start gap-2 text-xs text-band-2-ink">
        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-bold">הטסט שלך נשלח למאמן.</span>
          {' '}
          <bdi dir="ltr">{shortDate(item.date)}</bdi>
          {', '}
          <bdi dir="ltr">{metres(item.distanceM)}</bdi> מ׳
          {item.paceSec !== null && <> · <bdi dir="ltr">{formatPace(item.paceSec)}</bdi> לק״מ</>}
          {' — '}
          הוא יאשר אותו ואז הוא ייכנס לגרף ויעדכן את קצב הסף שלך. עד אז שום דבר
          בתוכנית לא משתנה.
        </span>
      </p>
    </div>
  );
}

export function MyTest({
  athleteId,
  name,
  protocol = '30min',
}: {
  athleteId: string;
  name: string;
  protocol?: string;
}) {
  const [data, setData] = useState<MyTestResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/academy/tests?protocol=${encodeURIComponent(protocol)}&athleteId=${encodeURIComponent(athleteId)}`,
        { headers: await apiHeaders() },
      );
      if (!res.ok) { setState('error'); return; }
      setData((await res.json()) as MyTestResponse);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [athleteId, protocol]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  // Silent while loading and silent on failure. This sits inside the athlete's weekly
  // screen, and an error banner about a feature they may never have used is worse than
  // the section simply not being there.
  if (state !== 'ready' || !data || data.tableMissing) return null;

  const trend = data.trend;
  const waiting = (data.pending ?? []).filter(p => p.athleteId === athleteId);
  const hasPoints = !!trend && trend.points.length > 0;

  return (
    <div className="space-y-3" dir="rtl">
      {hasPoints && <ImprovementChart trend={trend!} heading="השיפור שלך" />}

      {waiting.length > 0 ? (
        waiting.map(item => <WaitingCard key={item.testId} item={item} />)
      ) : (
        // Only offered when nothing is waiting. Two open submissions for the same person is
        // not a state worth building a screen for, and the form would overwrite the first
        // one anyway.
        <RecordTest
          athletes={[{ athleteId, name }]}
          protocol={protocol}
          selfSubmit
          onSaved={() => { void load(); }}
        />
      )}

      {!hasPoints && waiting.length === 0 && (
        <p className="px-1 text-xs leading-relaxed text-ink-400">
          טסט סף הוא ריצה של 30 דקות בכל הכוח. המרחק שעברת קובע את קצב הסף שלפיו נכתבים
          האימונים שלך, ואחרי שני טסטים יופיע כאן גרף שיפור.
        </p>
      )}
    </div>
  );
}

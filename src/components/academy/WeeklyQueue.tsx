'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCheck, Check, CalendarX, TrendingUp, MessageSquare } from 'lucide-react';
import { cn, planWeekStartOf, shiftWeekStart } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { EmptyState, LoadingBlock } from '@/components/ui';
import { initialsOf } from '@/components/academy/types';
import { WorkoutFeedbackPanel } from '@/components/academy/WorkoutFeedback';
import { useSegmentReport } from '@/components/academy/useSegmentReport';
import type { QueueReason, QueueRow, QueueWeek } from '@/lib/academy/queue';

// ── The mentor's weekly queue ────────────────────────────────────────────────
//
// The same twenty trainees the compliance tab lists, in the order the mentor
// should work through them, opening straight onto the ONE session that put each
// row where it is. The compliance tab answers "how did the club do"; this answers
// "who do I write to now", and the difference is entirely the order plus the fact
// that a tap lands on a workout instead of on a name to expand.
//
// The ordering lives in lib/academy/queue.ts with its tests. Nothing here
// re-sorts: if a row looks wrong the rule is wrong, and it should be fixed where
// it is written down and pinned, not patched in a component.

const REASON: Record<QueueReason, { label: string; icon: React.ComponentType<{ className?: string }>; chip: string }> = {
  // Red for the absence, and it is the only red on the screen: a missed session is
  // the one row a person has to pick up, because the data cannot explain it.
  missed: { label: 'החמצה', icon: CalendarX, chip: 'bg-accent-red/10 text-accent-red-ink' },
  off_target: { label: 'מחוץ ליעד', icon: TrendingUp, chip: 'bg-band-3/10 text-band-3-ink' },
  unreviewed: { label: 'ממתין למשוב', icon: MessageSquare, chip: 'bg-brand-600/10 text-brand-600' },
  reviewed: { label: 'נענה', icon: Check, chip: 'bg-accent-600/10 text-accent-900' },
};

const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return DAY_LABELS[d.getUTCDay()] ?? '';
}

function fmtWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return `${start.toLocaleDateString('he-IL', opts)} – ${end.toLocaleDateString('he-IL', opts)}`;
}

/**
 * The deviation, in the unit the mentor thinks in.
 *
 * The direction is SPOKEN, not drawn as a sign: a bare "‎-12" in an RTL line reads
 * as a minus to some people and as a dash to others, and "12 seconds faster" versus
 * "12 seconds slower" is the entire coaching decision.
 *
 * The number comes back separately from the words on purpose. Wrapping the whole
 * sentence in `<bdi dir="ltr">` forced the Hebrew to lay out left-to-right and put
 * the digits at the far END of the line — "שנ׳/ק״מ מהר מהיעד 27" — so the reader
 * meets the unit before the quantity. Only the digits need isolating.
 */
function deviationText(sec: number | null): { value: number | null; words: string; tone: string } | null {
  if (sec == null) return null;
  if (sec === 0) return { value: null, words: 'בקצב היעד', tone: 'text-accent-900' };
  return sec < 0
    ? { value: Math.abs(sec), words: 'שנ׳/ק״מ מהר מהיעד', tone: 'text-band-2-ink' }
    : { value: Math.abs(sec), words: 'שנ׳/ק״מ אט מהיעד', tone: 'text-band-3-ink' };
}

export function WeeklyQueue() {
  const [weekStart, setWeekStart] = useState(() => planWeekStartOf());

  const { data, isLoading } = useApi<QueueWeek & { unmigrated?: boolean }>(
    `/api/academy/queue?weekStart=${weekStart}`,
  );
  const isCurrentWeek = weekStart === planWeekStartOf();

  return (
    <div dir="rtl">
      {/* Week selector — the same control as the compliance tab, because it is the
          same week and moving between the two should not feel like two screens. */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button
          onClick={() => setWeekStart(w => shiftWeekStart(w, -1))}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          aria-label="השבוע הקודם"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="text-center min-w-[180px]">
          <div className="text-sm font-semibold text-ink-700">{fmtWeekLabel(weekStart)}</div>
          <div className="text-xs text-ink-400">{isCurrentWeek ? 'השבוע' : ''}</div>
        </div>
        <button
          onClick={() => setWeekStart(w => shiftWeekStart(w, 1))}
          disabled={isCurrentWeek}
          className="p-2.5 min-h-[44px] min-w-[44px] rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="השבוע הבא"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      {/* Keyed by the week so moving between weeks closes whatever row was open:
          the open row is a position in THIS week's queue and means nothing in the
          next one. */}
      {isLoading || !data
        ? <LoadingBlock />
        : <QueueList key={weekStart} week={data} unmigrated={data.unmigrated} />}
    </div>
  );
}

/**
 * The queue itself, given a week.
 *
 * Separated from the fetching so the audit's preview route can render it against a
 * fixture the real `buildQueue` produced — the layout that gets checked is then the
 * layout the mentor sees, in rows the real ordering put in that order, with no
 * preview-only prop leaking into the component the app ships.
 */
export function QueueList({ week, unmigrated }: { week: QueueWeek; unmigrated?: boolean }) {
  // One row open at a time. Not an accordion for tidiness — the feedback panel
  // fetches a week of laps per session, and a screen that opens all twenty at once
  // is twenty of those requests for the nineteen the mentor is not looking at.
  const [open, setOpen] = useState<string | null>(null);
  const { rows, totals } = week;

  return (
    <>
      {/* The mentor's own workload, not the club's performance. "3 החמצות" is a
          number of conversations to have, which is why it sits here and the
          completion rate does not. */}
      <div className="flex items-center justify-center gap-2 mb-4 text-xs">
        <span className="rounded-pill bg-brand-600/10 px-2.5 py-1 font-semibold text-brand-600">
          {totals.pending} ממתינים
        </span>
        {totals.missed > 0 && (
          <span className="rounded-pill bg-accent-red/10 px-2.5 py-1 font-semibold text-accent-red-ink">
            {totals.missed} החמצות
          </span>
        )}
        <span className="rounded-pill bg-accent-600/10 px-2.5 py-1 font-semibold text-accent-900">
          {totals.reviewed} נענו
        </span>
      </div>

      {unmigrated && (
        <p className="mb-4 rounded-card bg-band-3/10 px-3 py-2 text-xs text-band-3-ink">
          טבלת המשוב עוד לא הוקמה, ולכן כל השבוע מופיע כממתין. אפשר לעבור על האימונים, אבל שמירה של משוב תיכשל.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="אין למי לכתוב השבוע"
          description="או שאין ספורטאי אקדמיה, או שלא הוגדרה תוכנית לשבוע הזה."
        />
      ) : (
        <div className="space-y-2.5">
          {rows.map(row => (
            <QueueCard
              key={row.athleteId}
              row={row}
              open={open === row.athleteId}
              onToggle={() => setOpen(o => (o === row.athleteId ? null : row.athleteId))}
            />
          ))}
        </div>
      )}
    </>
  );
}

function QueueCard({ row, open, onToggle }: { row: QueueRow; open: boolean; onToggle: () => void }) {
  const reason = REASON[row.reason];
  const Icon = reason.icon;
  const h = row.headline;
  const dev = h ? deviationText(h.deviationSec) : null;
  // A reviewed row is finished work kept visible so the mentor can see they are
  // done, so it recedes rather than disappears.
  const done = row.reason === 'reviewed';

  return (
    <div className={cn('rounded-card overflow-hidden bg-card', done && 'opacity-60')}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 p-3.5 text-start hover:bg-page/70 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-inset"
      >
        <div className="bg-brand-600/20 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-brand-600 shrink-0">
          {initialsOf(row.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink-900 truncate" dir="auto">{row.name}</span>
            <span className={cn('shrink-0 inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold', reason.chip)}>
              <Icon className="h-3 w-3" /> {reason.label}
            </span>
          </div>
          {/* The headline session, i.e. the reason this row is where it is. Naming it
              is what makes the order arguable instead of magic. */}
          {h ? (
            /* Two lines, not one. On one line the spelled-out deviation took the
               width the workout name needed and "אינטרוולים 5×1000 מ׳ בקצב מטרה"
               truncated to "אינטרוולים 5×1…" — which loses WHICH session this row
               is about. Shortening the deviation instead was the wrong lever: the
               direction word is the coaching decision. */
            <>
              <div className="mt-0.5 flex items-baseline gap-1.5 text-xs text-ink-400 min-w-0">
                <span className="shrink-0">{dayLabel(h.date)}</span>
                <span className="truncate" dir="auto">{h.name}</span>
              </div>
              {!h.completed ? (
                <div className="text-xs font-semibold text-accent-red-ink">לא בוצע</div>
              ) : dev ? (
                <div className={cn('text-xs font-semibold', dev.tone)}>
                  {dev.value != null && <><bdi dir="ltr">{dev.value}</bdi>{' '}</>}{dev.words}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-0.5 text-xs text-ink-400">לא הוגדרו אימונים לשבוע הזה</div>
          )}
        </div>
        <div className="shrink-0 text-end">
          <div className="text-sm font-bold tabular-nums text-ink-700">
            <bdi dir="ltr">{row.completedCount}/{row.plannedCount}</bdi>
          </div>
          <div className="text-[11px] text-ink-400">בוצעו</div>
        </div>
      </button>

      {open && h && <QueueCardBody athleteId={row.athleteId} workout={h} />}
      {open && !h && (
        <p className="px-3.5 pb-3.5 text-xs text-ink-400">אין אימון לפתוח.</p>
      )}
    </div>
  );
}

/**
 * The headline session, opened for writing.
 *
 * A missed session has no laps and no feedback form — there is nothing to grade and
 * the mentor's next move is a message, not a review — so it says so and stops. That
 * is the honest end of this screen: the queue can rank an absence to the top but it
 * cannot review one.
 */
function QueueCardBody({ athleteId, workout }: { athleteId: string; workout: QueueRow['workouts'][number] }) {
  const seg = useSegmentReport(athleteId, workout.date, workout.completed);

  if (!workout.completed) {
    return (
      <div className="px-3.5 pb-3.5 -mt-1">
        <p className="rounded-lg bg-page px-3 py-2.5 text-xs text-ink-500">
          האימון הזה לא בוצע, ולכן אין מה לדרג. מה שנשאר הוא לשאול למה.
        </p>
      </div>
    );
  }
  if (seg.loading || !seg.report) {
    return <div className="px-3.5 pb-3.5"><LoadingBlock className="py-6" size={20} /></div>;
  }
  return (
    <div className="px-3.5 pb-3.5 -mt-1">
      <WorkoutFeedbackPanel
        athleteId={athleteId}
        date={workout.date}
        activityId={seg.activityId ?? workout.activityId}
        workoutName={workout.name}
        report={seg.report}
      />
    </div>
  );
}

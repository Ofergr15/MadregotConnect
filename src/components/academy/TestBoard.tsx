'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2, Inbox, MessageSquareQuote } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';
import {
  buildBoard,
  coachActionLabel,
  detailLine,
  entryTime,
  type Board,
  type BoardEntry,
  type BoardRow,
} from '@/lib/academy/testBoard';

/**
 * The coach's open test invitations, in two lists: what needs them, and what does not.
 *
 * The screen the trainee's card implies. Somebody schedules those tests, somebody reads the
 * replies, and until now that somebody had nowhere to look — every invitation existed only on
 * the trainee's own phone.
 *
 * ── THE FIRST LIST IS THE SCREEN ─────────────────────────────────────────────────────────
 *
 * `מחכים לך` is the whole point and everything else is context. The academy does not lose
 * candidates to refusals; it loses them to a message that arrived and a reply that did not, and
 * a chronological board buries exactly that message between two Thursdays that need nothing.
 * So the grouping is by whose move it is (`lib/academy/testBoard.ts`), the coach's list is
 * first, and it is the one that gets a count in the header.
 *
 * It is about SCHEDULING only, and its empty state says exactly that — "nobody is waiting for an
 * answer from you", not "there is nothing to do". A trainee whose submitted result is waiting on
 * approval is also waiting on the coach, and that queue is `PendingTests`, which sits above this
 * one on the tests tab. The two belong together and will be one list once a recorded result is
 * linked back to the invitation it settles (`academy_test_invitations.test_id`); until then, an
 * empty board must not claim the other queue is empty too.
 *
 * ── AND IT IS ALLOWED TO BE EMPTY ────────────────────────────────────────────────────────
 *
 * An empty first list is the normal state and says so in a full sentence. `אין מה לעשות` in
 * grey 11px is how a coach learns to stop reading a queue: the day the list is empty must look
 * deliberately different from the day the screen failed to load, or the two become the same
 * glance. Same reason the pre-migration state names the migration instead of showing a board
 * with nothing on it — "nobody has a test scheduled" is the wrong thing to tell a coach who
 * scheduled three.
 *
 * Read-only, on purpose. Offering new times is a write that sends a trainee a notification, and
 * that belongs to the slice that owns dispatch. What this screen does is make the queue visible,
 * which is the half that was missing.
 */

/**
 * The coach's list wears band-2, the tint the academy already uses for its own setup gaps
 * (`no_coach`, `no_band`, a stale test). That is what these are: nobody is at fault and nothing
 * is broken, there is simply a step the academy owes somebody. Deliberately NOT the red dispatch
 * uses for a watch with no workout on it, which would put an alarm beside the name of a trainee
 * who has done nothing wrong — they answered.
 */
const NEEDS_YOU = 'bg-band-2/10 text-band-2-ink';

/**
 * The chip tones for the trainee's list.
 *
 * `אין תוצאה` used to wear the same grey as everything else, which made a test that has come and
 * gone with nothing recorded look exactly as settled as one in next Tuesday's diary. It is not
 * the coach's move yet — the follow-up reminder has not fired — but it is not fine either, and a
 * single grey for both states hides the difference that the whole board is built to show. band-2
 * at half strength: visibly not-neutral, audibly not an alarm.
 */
const NO_RESULT = 'bg-band-2/[0.06] text-band-2-ink';
const TODAY = 'bg-accent-600/15 text-accent-900';
const NEUTRAL = 'bg-page text-ink-500';

export function BoardLists({
  board,
  onSelectAthlete,
}: {
  board: Board;
  /** Opens the member sheet. Absent in the preview, where the rows are not tappable. */
  onSelectAthlete?: (athleteId: string) => void;
}) {
  const { onCoach, onAthlete, testingThisWeek } = board;

  if (!onCoach.length && !onAthlete.length) {
    return (
      <div className="rounded-card bg-card px-3.5 py-3" dir="rtl">
        <p className="text-sm font-bold text-ink-900">אין טסטים פתוחים.</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          כל מתאמן שהוזמן לטסט יופיע כאן עד שהטסט נרשם — מי שטרם ענה, מי שביקש זמן אחר ומי שרץ
          השבוע.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* The count the coach plans their own week around, and the only number on the screen.
          A row of KPIs here would be four numbers about eleven people; this one answers
          "how much of my week is already booked" and the lists answer everything else. */}
      <div className="flex items-center gap-2 rounded-card bg-card px-3.5 py-3">
        <CalendarCheck2 className="h-4 w-4 shrink-0 text-ink-400" />
        <p className="text-xs text-ink-700">
          {testingThisWeek === 0
            ? 'אין טסט קבוע בשבוע הקרוב.'
            : testingThisWeek === 1
              ? <>מתאמן אחד עם טסט קבוע בשבוע הקרוב.</>
              : <><bdi dir="ltr">{testingThisWeek}</bdi> מתאמנים עם טסט קבוע בשבוע הקרוב.</>}
        </p>
      </div>

      <section>
        <SectionHeader
          icon={<Inbox className="h-3.5 w-3.5" />}
          title="מחכים לך"
          count={onCoach.length}
        />
        {onCoach.length ? (
          <div className="space-y-1.5">
            {onCoach.map(entry => (
              <EntryRow key={entry.row.invite.id} entry={entry} onSelect={onSelectAthlete} needsYou />
            ))}
          </div>
        ) : (
          // A full sentence, in the size the rows are. See the header: an empty queue has to
          // look like a decision rather than like a screen that did not load.
          <p className="rounded-card bg-card px-3.5 py-3 text-xs leading-relaxed text-ink-700">
            אף אחד לא מחכה לתשובה ממך. כל ההזמנות שנשלחו נענו, ואין זמנים שפגו.
          </p>
        )}
      </section>

      {onAthlete.length > 0 && (
        <section>
          <SectionHeader
            icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
            title="אצל המתאמנים"
            count={onAthlete.length}
          />
          <div className="space-y-1.5">
            {onAthlete.map(entry => (
              <EntryRow key={entry.row.invite.id} entry={entry} onSelect={onSelectAthlete} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <span className="text-ink-400">{icon}</span>
      <h3 className="text-xs font-bold text-ink-900">{title}</h3>
      {/* No `0`. `מחכים לך 0` above a sentence that already says nobody is waiting is a number
          whose only job is to be reassuring, and a count is for scanning — there is nothing to
          scan. */}
      {count > 0 && (
        <span className="text-[11px] tabular-nums text-ink-400"><bdi dir="ltr">{count}</bdi></span>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  onSelect,
  needsYou,
}: {
  entry: BoardEntry;
  onSelect?: (athleteId: string) => void;
  needsYou?: boolean;
}) {
  const { row, state } = entry;
  const note = state === 'other_requested' ? row.invite.requestedNote : null;
  const chip = coachActionLabel(entry);
  const detail = detailLine(entry);
  const time = entryTime(entry);

  const tone = needsYou
    ? NEEDS_YOU
    : state === 'today' ? TODAY : state === 'overdue' ? NO_RESULT : NEUTRAL;

  const body = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
        {initialsOf(row.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* Latin name inside a Hebrew screen: isolated, and unbreakable so a chip cannot
              push half of it onto the next line. */}
          <span className="truncate text-sm font-bold text-ink-900" dir="auto">
            <bdi dir="ltr" className="whitespace-nowrap">{row.name}</bdi>
          </span>
          {/* Only where there is something to say — a scheduled test has no chip, because its
              own time column already says it. See `coachActionLabel`. */}
          {chip && (
            <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold', tone)}>
              {chip}
            </span>
          )}
        </div>
        {/* Second line, never the same line — a date competing with a name is what truncated
            the name in the weekly queue. A whole sentence, not `label · 2 days`: see
            `detailLine`, where a bare duration could be read forwards or backwards. */}
        {detail && <p className="mt-0.5 text-[11px] text-ink-400" dir="auto">{detail}</p>}
        {/* What the trainee actually wrote, on the row and not behind a tap. It is usually the
            answer to the question the coach is about to ask — "עובד במשמרות עד ה-20" is the
            whole reason a new time has to be a different kind of time. */}
        {note && (
          <p className="mt-1 flex items-start gap-1.5 rounded-card bg-page px-2 py-1.5 text-[11px] leading-relaxed text-ink-700" dir="auto">
            <MessageSquareQuote className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
            <span>{note}</span>
          </p>
        )}
      </div>

      {/* The diary column, in the position the registry puts its pace: the number that makes the
          row worth scanning, at the end, aligned down the list. Without it every row was a name
          and a caption against an empty half-card, and the time — the thing a coach is actually
          reading a week's board for — was buried mid-sentence in 11px grey. */}
      {time && (
        <div className="shrink-0 text-end">
          <div className="text-[11px] text-ink-400" dir="auto">{time.day}</div>
          <div className="text-sm font-bold tabular-nums text-ink-900"><bdi dir="ltr">{time.time}</bdi></div>
        </div>
      )}
    </>
  );

  if (!onSelect) {
    return <div className="flex items-start gap-3 rounded-card bg-card px-3 py-3 text-right">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(row.invite.athleteId)}
      className="flex min-h-[48px] w-full items-start gap-3 rounded-card bg-card px-3 py-3 text-right"
    >
      {body}
    </button>
  );
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function TestBoard({ onSelectAthlete }: { onSelectAthlete?: (athleteId: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/test-invitation/board', { headers: await apiHeaders() });
      const data = await res.json();
      if (!res.ok) { setState('error'); return; }
      if (data?.tableMissing) { setState('missing'); return; }
      // The clock is read HERE, once per load, rather than inside the lib — so the states on
      // screen all agree with each other even if the render straddles midnight.
      setBoard(buildBoard((data?.rows ?? []) as BoardRow[], new Date().toISOString()));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  if (state === 'loading') return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  if (state === 'missing') {
    return (
      <p className="py-6 text-center text-xs leading-relaxed text-ink-400" dir="rtl">
        טבלת הזמנות הטסט עוד לא הוקמה במסד הנתונים.
        <br />צריך להריץ את מיגרציה <bdi dir="ltr">112</bdi>.
      </p>
    );
  }
  if (state === 'error' || !board) {
    return <p className="py-6 text-center text-xs text-accent-red-ink" dir="rtl">לא הצלחנו לטעון את הזמנות הטסט</p>;
  }
  return <BoardLists board={board} onSelectAthlete={onSelectAthlete} />;
}

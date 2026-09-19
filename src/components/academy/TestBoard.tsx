'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2, CalendarPlus, Inbox, MessageSquareQuote } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Sheet } from '@/components/ui';
import { initialsOf } from './types';
import { InviteToTestSheet, type InviteTarget } from './InviteToTestSheet';
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
 * ── THE ONE ACTION, AND WHERE IT LIVES ───────────────────────────────────────────────────
 *
 * Every row in `מחכים לך` has the same answer — offer times — whichever of the three states put
 * it there: the trainee asked for another time, the offered times ran out, or the test came and
 * went after the app had already asked twice. So the action is on the row and not behind the
 * member sheet, and it is the same button in all three cases. A board that names the move and
 * then makes you go somewhere else to make it is a board that gets read once.
 *
 * The header button is the other direction: a trainee with NO open invitation cannot appear on
 * this board at all, so without it the only way to start one is a hand-run `POST`. `invitable`
 * comes down with the rows for that reason — one fetch, two halves that cannot disagree.
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
/** A trainee the board cannot show, because they have no open invitation to show. */
interface Invitable { athleteId: string; name: string }

const NO_RESULT = 'bg-band-2/[0.06] text-band-2-ink';
const TODAY = 'bg-accent-600/15 text-accent-900';
const NEUTRAL = 'bg-page text-ink-500';

export function BoardLists({
  board,
  onSelectAthlete,
  onOffer,
  onInvite,
  invitable,
}: {
  board: Board;
  /** Opens the member sheet. Absent in the preview, where the rows are not tappable. */
  onSelectAthlete?: (athleteId: string) => void;
  /** Offer this entry new times. Absent in the preview, which writes nothing. */
  onOffer?: (entry: BoardEntry) => void;
  /** Start an invitation for somebody with none open. */
  onInvite?: () => void;
  /** How many trainees could be invited — the header button says so instead of just appearing. */
  invitable?: number;
}) {
  const { onCoach, onAthlete, testingThisWeek } = board;

  const inviteButton = onInvite && !!invitable && (
    <button
      type="button"
      onClick={onInvite}
      className="flex min-h-[48px] w-full items-center gap-2 rounded-card bg-card px-3.5 text-start"
    >
      <CalendarPlus className="h-4 w-4 shrink-0 text-brand-600" />
      <span className="text-sm font-bold text-brand-600">הזמנה לטסט</span>
      {/* The count, because "who is even left?" is the question the button answers. */}
      <span className="text-[11px] text-ink-400">
        <bdi dir="ltr">{invitable}</bdi> בלי הזמנה פתוחה
      </span>
    </button>
  );

  if (!onCoach.length && !onAthlete.length) {
    return (
      <div className="space-y-3" dir="rtl">
        <div className="rounded-card bg-card px-3.5 py-3">
          <p className="text-sm font-bold text-ink-900">אין טסטים פתוחים.</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            כל מתאמן שהוזמן לטסט יופיע כאן עד שהטסט נרשם — מי שטרם ענה, מי שביקש זמן אחר ומי שרץ
            השבוע.
          </p>
        </div>
        {/* The empty board is exactly where the invite button matters most: nothing is open, so
            every trainee is invitable, and this is the screen a coach is on when they decide to
            start a testing week. */}
        {inviteButton}
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
              <EntryRow
                key={entry.row.invite.id}
                entry={entry}
                onSelect={onSelectAthlete}
                onOffer={onOffer}
                needsYou
              />
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

      {/* Last, not first: the queue is the screen, and a create button above `מחכים לך` would put
          the optional action above the one somebody is waiting on. */}
      {inviteButton}
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
  onOffer,
  needsYou,
}: {
  entry: BoardEntry;
  onSelect?: (athleteId: string) => void;
  onOffer?: (entry: BoardEntry) => void;
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

  // The name area and the action are siblings, never nested: a button inside a button is invalid
  // HTML and Safari resolves it by giving the tap to whichever it feels like.
  const head = onSelect ? (
    <button
      type="button"
      onClick={() => onSelect(row.invite.athleteId)}
      className="flex min-h-[48px] w-full items-start gap-3 px-3 py-3 text-right"
    >
      {body}
    </button>
  ) : (
    <div className="flex items-start gap-3 px-3 py-3 text-right">{body}</div>
  );

  if (!onOffer) return <div className="rounded-card bg-card">{head}</div>;

  return (
    <div className="rounded-card bg-card">
      {head}
      {/* One action, the same for all three states in this list — see the header. Full width and
          48px, because it is the thing the row exists to make happen. */}
      <button
        type="button"
        onClick={() => onOffer(entry)}
        className="min-h-[48px] w-full border-t border-page px-3 text-start text-xs font-bold text-brand-600"
      >
        הצע זמנים
      </button>
    </div>
  );
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function TestBoard({ onSelectAthlete }: { onSelectAthlete?: (athleteId: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [invitable, setInvitable] = useState<Invitable[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  /** Null when the sheet is closed. Holds who, and whether it is a re-offer. */
  const [target, setTarget] = useState<InviteTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/academy/test-invitation/board', { headers: await apiHeaders() });
      const data = await res.json();
      if (!res.ok) { setState('error'); return; }
      if (data?.tableMissing) { setState('missing'); return; }
      // The clock is read HERE, once per load, rather than inside the lib — so the states on
      // screen all agree with each other even if the render straddles midnight.
      setBoard(buildBoard((data?.rows ?? []) as BoardRow[], new Date().toISOString()));
      setInvitable((data?.invitable ?? []) as Invitable[]);
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

  /**
   * The write. It lives here and not in the sheet, so that the sheet can be rendered by a preview
   * with no session — a screen whose send button could post a real invitation to a real person is
   * not a screen anybody should be shooting screenshots of.
   */
  const send = async (offer: { protocol: string; slots: string[] }) => {
    if (!target) return;
    setSending(true);
    setSendError(null);
    try {
      const reOffer = !!target.invitationId;
      const res = await fetch('/api/academy/test-invitation', {
        method: reOffer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify(reOffer
          ? { id: target.invitationId, action: 'offer', slots: offer.slots }
          : { athleteId: target.athleteId, protocol: offer.protocol, slots: offer.slots }),
      });
      if (!res.ok) {
        // 409 is the one failure whose next move is different: an open invitation already exists,
        // so the answer is to look at it rather than to try again.
        setSendError(res.status === 409
          ? 'למתאמן הזה כבר יש הזמנה פתוחה. רענן את הלוח כדי לראות אותה.'
          : 'ההזמנה לא נשלחה. אפשר לנסות שוב.');
        return;
      }
      setTarget(null);
      await load();
    } catch {
      setSendError('ההזמנה לא נשלחה. אפשר לנסות שוב.');
    } finally {
      setSending(false);
    }
  };

  const startInvite = () => {
    setSendError(null);
    // One trainee left means there is nothing to choose, and a picker with a single row is a tap
    // that asks a question whose answer is already known.
    if (invitable.length === 1) {
      setTarget({ athleteId: invitable[0].athleteId, name: invitable[0].name });
      return;
    }
    setPicking(true);
  };

  return (
    <>
      <BoardLists
        board={board}
        onSelectAthlete={onSelectAthlete}
        invitable={invitable.length}
        onInvite={startInvite}
        onOffer={entry => {
          setSendError(null);
          setTarget({
            athleteId: entry.row.invite.athleteId,
            name: entry.row.name,
            invitationId: entry.row.invite.id,
            protocol: entry.row.invite.protocol,
            note: entry.row.invite.requestedNote,
          });
        }}
      />

      {/* Who, then when — two sheets in sequence rather than one nested in the other, which is
          what makes the back gesture mean "pick somebody else" instead of dropping the whole flow. */}
      <Sheet open={picking} onOpenChange={setPicking} title="למי לשלוח הזמנה">
        <div className="px-4 pb-4" dir="rtl">
          <div className="divide-y divide-page">
            {invitable.map(person => (
              <button
                key={person.athleteId}
                type="button"
                onClick={() => {
                  setPicking(false);
                  setTarget({ athleteId: person.athleteId, name: person.name });
                }}
                className="flex min-h-[48px] w-full items-center gap-3 text-start"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
                  {initialsOf(person.name)}
                </span>
                <span className="truncate text-sm font-bold text-ink-900">
                  <bdi dir="ltr">{person.name}</bdi>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>

      <InviteToTestSheet
        open={!!target}
        onOpenChange={open => { if (!open) setTarget(null); }}
        target={target}
        onSend={offer => { void send(offer); }}
        busy={sending}
        error={sendError}
      />
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Clock, MessageCircle, MoonStar } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';
import type { Inbox, InboxReason, InboxRow } from '@/lib/academy/thread';

// ── "What needs me" across every academy thread ─────────────────────────────
//
// The manager sits in all ~18 threads. A list sorted by recency puts the chattiest
// trainee on top and the one who has said nothing for a month at the bottom, which
// is exactly backwards — so this screen is ordered by obligation, computed and
// pinned in `lib/academy/thread.ts`. Nothing here re-sorts.
//
// What it deliberately does NOT show: who still needs this week's review. That is
// the weekly queue's question, and it already answers it, ranked. Two screens
// answering one question is how the kudos tables in this repo drifted apart.

// RED APPEARS EXACTLY ONCE, on the row that is actually owed an answer.
//
// The first version painted `silent` with `band-3`, and the screenshot is what
// caught it: `ממתין לתשובה` measured rgb(143,43,43) and `שקט` rgb(138,43,8) — two
// colours that differ only in the blue channel, so at 11px on a 10% wash three of
// five rows read as one warm smear, and "somebody is waiting on you" stopped being
// distinguishable from "this thread is dormant". `band-3` was the wrong token
// twice over: it is a דבוקה squad colour off the league table, not a semantic one.
//
// So dormant is neutral ink — the same quiet treatment FeedbackCard gives a chip
// that is a note rather than praise. It is not a downgrade: an empty thread IS an
// absence, the moon says so, and the urgency is carried by the ORDER and by the
// count in the header, which is where a ranked list should carry it.
const REASON: Record<InboxReason, { label: string; chip: string; icon: React.ReactNode }> = {
  awaiting_reply: {
    label: 'ממתין לתשובה',
    chip: 'bg-accent-red/10 text-accent-red-ink',
    icon: <Clock className="h-3 w-3" />,
  },
  silent: {
    label: 'שקט',
    chip: 'bg-page text-ink-700',
    icon: <MoonStar className="h-3 w-3" />,
  },
  unread: {
    label: 'לא נקרא',
    chip: 'bg-brand-600/10 text-brand-600',
    icon: <MessageCircle className="h-3 w-3" />,
  },
  quiet: {
    label: 'מעודכן',
    chip: 'bg-accent-600/10 text-accent-900',
    icon: null,
  },
};

/**
 * The pure list. Split out so the audit harness can mount it with a fixture that
 * has been through the real `buildInbox` — a row in the wrong place in the preview
 * is then a real bug rather than a fixture typo.
 */
export function InboxList({
  inbox,
  onOpen,
}: {
  inbox: Inbox;
  onOpen?: (athleteId: string) => void;
}) {
  if (!inbox.rows.length) {
    return <p className="py-6 text-center text-xs text-ink-400">אין מתאמנים באקדמיה.</p>;
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* The one honest headline number. Counts what is OWED, not what is unread:
          unread is what the bell already means, and a number that mixes "somebody is
          waiting on you" with "there is something to read" is a number nobody acts
          on twice. */}
      <div className="rounded-card bg-card px-3.5 py-3">
        {inbox.needsAttention > 0 ? (
          <p className="text-sm text-ink-700">
            <span className="font-bold text-ink-900">{inbox.needsAttention}</span>{' '}
            {inbox.needsAttention === 1 ? 'שיחה מחכה לך' : 'שיחות מחכות לך'}
          </p>
        ) : (
          <p className="text-sm font-semibold text-accent-900">אף אחד לא מחכה לתשובה.</p>
        )}
      </div>

      <div className="space-y-1.5">
        {inbox.rows.map(row => (
          <Row key={row.athleteId} row={row} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function Row({ row, onOpen }: { row: InboxRow; onOpen?: (athleteId: string) => void }) {
  const r = REASON[row.reason];
  const detail = detailText(row);

  return (
    <button
      onClick={() => onOpen?.(row.athleteId)}
      className="flex w-full items-center gap-3 rounded-card bg-card px-3 py-3 text-right active:bg-page/60"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
        {initialsOf(row.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-ink-900" dir="auto">{row.name}</span>
          <span className={cn('flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold', r.chip)}>
            {r.icon}
            {r.label}
          </span>
        </div>
        {/* Second line, not the same line: the name is what you scan for and a wait
            time competing with it truncated the name in the weekly queue. */}
        {detail && <p className="mt-0.5 text-[11px] text-ink-400">{detail}</p>}
      </div>

      {row.unreadCount > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white tabular-nums">
          {row.unreadCount}
        </span>
      )}
    </button>
  );
}

/**
 * The one line under the name. Only the digits are isolated, never the surrounding
 * Hebrew — wrapping the whole sentence in `<bdi dir="ltr">` lays it out
 * left-to-right and throws the number to the far visual end, which is the defect
 * that got through every measured audit rule on the weekly queue.
 */
function detailText(row: InboxRow): React.ReactNode {
  if (row.reason === 'awaiting_reply' && row.waitingHours != null) {
    const h = Math.round(row.waitingHours);
    if (h < 1) return 'שאל עכשיו';
    if (h < 24) return <>מחכה <bdi dir="ltr">{h}</bdi> שעות</>;
    const d = Math.round(h / 24);
    return d === 1 ? 'מחכה יום' : <>מחכה <bdi dir="ltr">{d}</bdi> ימים</>;
  }
  if (row.reason === 'silent') {
    // A thread nobody ever opened is not "quiet for N days" — there is no N. Saying
    // so is more useful than a number, because it is a different problem.
    if (row.quietDays == null) return 'אף אחד עוד לא כתב בשיחה הזאת';
    const d = Math.round(row.quietDays);
    return <><bdi dir="ltr">{d}</bdi> ימים בלי מילה משני הצדדים</>;
  }
  return null;
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function ThreadInbox({ onOpen }: { onOpen?: (athleteId: string) => void }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/academy/threads/inbox', { headers: await apiHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data?.error || 'לא הצלחנו לטעון את השיחות'); return; }
        setInbox(data as Inbox);
      } catch {
        if (!cancelled) setError('לא הצלחנו לטעון את השיחות');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="py-6 text-center text-xs text-accent-red-ink">{error}</p>;
  if (!inbox) return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  return <InboxList inbox={inbox} onOpen={onOpen} />;
}

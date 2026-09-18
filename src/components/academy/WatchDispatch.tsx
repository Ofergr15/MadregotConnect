'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, EyeOff, Send, Watch } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';
import type { DispatchReport, DispatchRow, DispatchState } from '@/lib/academy/dispatch';

// ── "Did the week reach the watches?" ────────────────────────────────────────
//
// Section 4's `שליחה לשעונים` screen. The ORDER and every verdict come from
// `lib/academy/dispatch.ts`, which is pure and tested; nothing here re-sorts and
// nothing here decides what a row means.
//
// The mockup drew a column headed "confirmed on the watch" filled in minutes after
// the send. Garmin cannot answer that — no endpoint reports that a device holds a
// workout, and the first thing we ever learn is an ACTIVITY stamped with the
// workout's id, i.e. after it was run. So the column here is headed by what it
// actually contains, and the state that used to be a green tick is now three
// honest ones: on Garmin, ran from it, and "we cannot see".
//
// `blind` is the reason this screen is worth building rather than eyeballing the
// plan page. An athlete whose activities have stopped arriving produces the exact
// same empty row as an athlete who skipped the session — and telling a trainee who
// ran that they missed it is the one output that would cost the coach the
// relationship. It is called out separately, in the athlete's own row, with the
// action that fixes it.
// The colours are the academy's existing ones, taken from `ATTENTION_STYLE` in
// ./types.ts rather than chosen here: the designer's palette has exactly ONE
// warning colour (band 3, with `band-3-ink` for a label sitting on its own wash),
// red for something broken, and neutral ink for an absence that has no severity.
// Inventing an amber for this screen is what would put two near-identical warm
// chips side by side — the smear `ThreadInbox` records having already fixed once.
//
// Red appears on the two states that mean the SAME thing — nothing is on the watch
// — which is why it appears twice here and not as two different colours.
const STATE: Record<DispatchState, { label: string; chip: string; icon: React.ReactNode }> = {
  send_failed: {
    label: 'לא נשלח',
    chip: 'bg-accent-red/10 text-accent-red-ink',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  unconfirmed: {
    label: 'לא אושר',
    chip: 'bg-band-3/10 text-band-3-ink',
    icon: <Clock className="h-3 w-3" />,
  },
  blind: {
    // band-2, which `ATTENTION_STYLE` uses for `no_coach`/`no_band` — a gap in the
    // academy's own setup rather than a fault of the athlete. That is exactly this
    // state: a dead Garmin connection, not a missed session. It must NOT wear a
    // warning colour, because that would paint a fault next to the name of someone
    // who may have run the session perfectly; and it must not be neutral either,
    // because neutral is what `no_run` wears, and telling those two apart is the
    // entire reason this screen is computed rather than eyeballed.
    label: 'אין לנו נתונים',
    chip: 'bg-band-2/10 text-band-2-ink',
    icon: <EyeOff className="h-3 w-3" />,
  },
  not_sent: {
    label: 'לא נדחף',
    chip: 'bg-accent-red/10 text-accent-red-ink',
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  ran_from_it: {
    label: 'רץ מהאימון',
    chip: 'bg-accent-600/10 text-accent-900',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  on_account: {
    label: 'מחכה בגרמין',
    chip: 'bg-brand-600/10 text-brand-600',
    icon: <Watch className="h-3 w-3" />,
  },
  ran_freestyle: {
    label: 'רץ בלי המבנה',
    chip: 'bg-page text-ink-700',
    icon: null,
  },
  no_run: {
    label: 'לא נרשמה ריצה',
    chip: 'bg-page text-ink-700',
    icon: null,
  },
};

/** `2026-09-16` → `16.09`, LTR-isolated so RTL cannot swap the two numbers. */
function shortDate(date: string): React.ReactNode {
  const [, month, day] = date.split('-');
  return <bdi dir="ltr">{day}.{month}</bdi>;
}

/** `2026-09-14T21:04:00.000Z` → `21:04` in the club's own wall clock. */
function clockTime(timestamp: string | null): React.ReactNode {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return (
    <bdi dir="ltr">
      {new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(parsed)}
    </bdi>
  );
}

/**
 * The pure view. Split out for the same reason `InboxList` is: the audit harness
 * mounts it with a fixture that has been through the real `buildDispatchReport`,
 * so a row in the wrong place in the preview is a real bug and not a fixture typo.
 */
export function DispatchList({ report }: { report: DispatchReport }) {
  const { rows, summary, needsAttention } = report;
  // The two boxes below split `needsAttention` by whose problem it is: `broken` is
  // ours to fix by re-pushing, `blind` is the athlete's to fix by reconnecting.
  // Both come out of the same pre-ordered list, so the boxes and the table can
  // never disagree about who is in trouble.
  const blind = needsAttention.filter(r => r.state === 'blind');
  const broken = needsAttention.filter(r => r.state !== 'blind');

  if (!rows.length) {
    return <p className="py-6 text-center text-xs text-ink-400">לא נדחפו אימונים בשבוע הזה.</p>;
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* Three numbers, and the middle one is the only one that proves anything.
          `נשלחו` is "verified on the Garmin account" — the strongest claim the push
          side can make (see lib/garmin/delivery.ts), and deliberately not called
          "on the watch". */}
      <div className="grid grid-cols-3 gap-2">
        <Kpi value={summary.onAccount} label="נשלחו לגרמין" tone="text-brand-600" />
        <Kpi value={summary.ranFromIt} label="רצו מהאימון" tone="text-accent-900" />
        {/* Exactly the people the red box names — `summary.unconfirmed` is
            `needsAttention` minus the blind rows, by construction. It used to count
            only the two failure states while the box also listed `not_sent`, so the
            screen showed "2" above a sentence naming three people. */}
        <Kpi
          value={summary.unconfirmed}
          label="בלי אימון מאושר"
          tone={summary.unconfirmed > 0 ? 'text-accent-red-ink' : 'text-ink-400'}
        />
      </div>

      {/* The one line worth reading first. Named people, because "1 failed" sends
          nobody anywhere — the coach needs to know who to message.

          Deliberately NOT every actionable row: `blind` is actionable and belongs in
          its own box below, because printing a blind athlete's name in a red box is
          the same fault-attribution the lib refuses to make. Red here means the
          workout is not on their watch. */}
      {broken.length > 0 ? (
        <div className="rounded-card bg-accent-red/10 px-3.5 py-3">
          <p className="flex items-start gap-2 text-xs text-accent-red-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-bold">
                {/* "no confirmed workout", not "no workout": one of these states is
                    `unconfirmed`, where Garmin took the workout and never confirmed
                    it. It may well be on the watch. Saying flatly that it is not
                    would be the same overclaim in the other direction. */}
                {broken.length === 1
                  ? 'אצל מתאמן אחד אין אימון מאושר'
                  : <>אצל <bdi dir="ltr">{broken.length}</bdi> מתאמנים אין אימון מאושר</>}
              </span>
              {' — '}
              {broken.map(r => r.name).join(', ')}
            </span>
          </p>
        </div>
      ) : (
        <div className="rounded-card bg-card px-3.5 py-3">
          <p className="text-sm font-semibold text-accent-900">כל האימונים יצאו. אין מה לתקן.</p>
        </div>
      )}

      {blind.length > 0 && (
        // Its own box, in the setup-gap colour rather than the failure one. Said out
        // loud because the alternative is a coach reading these rows as skipped
        // sessions — and the fix is the athlete's, and it is a reconnect.
        <div className="rounded-card bg-band-2/10 px-3.5 py-3">
          <p className="flex items-start gap-2 text-xs text-band-2-ink">
            <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {blind.length === 1 ? 'מתאמן אחד' : <><bdi dir="ltr">{blind.length}</bdi> מתאמנים</>}
              {' '}לא מסונכרנים — <b>אי אפשר לדעת</b> אם ביצעו, וזה לא אומר שלא רצו.
              {' '}צריך לחבר מחדש את גרמין: {blind.map(r => r.name).join(', ')}
            </span>
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map(row => (
          <Row key={`${row.athleteId}:${row.date}`} row={row} />
        ))}
      </div>
    </div>
  );
}

function Kpi({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-card bg-card px-2 py-2.5 text-center">
      <div className={cn('text-lg font-bold tabular-nums', tone)}><bdi dir="ltr">{value}</bdi></div>
      <div className="text-[11px] text-ink-500">{label}</div>
    </div>
  );
}

function Row({ row }: { row: DispatchRow }) {
  const s = STATE[row.state];
  const detail = detailText(row);

  return (
    <div className="flex items-center gap-3 rounded-card bg-card px-3 py-3 text-right">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
        {initialsOf(row.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-ink-900" dir="auto">{row.name}</span>
          <span className={cn('flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold', s.chip)}>
            {s.icon}
            {s.label}
          </span>
        </div>
        {/* Second line, never the same line — a time competing with the name is
            what truncated the name in the weekly queue. */}
        {detail && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{detail}</p>}
      </div>

      <span className="shrink-0 text-[11px] font-semibold text-ink-500 tabular-nums">{shortDate(row.date)}</span>
    </div>
  );
}

/**
 * The one line under the name. Only digits are LTR-isolated, never the surrounding
 * Hebrew — isolating a whole sentence lays it out left-to-right and throws the
 * number to the far visual end, the defect that got through every measured audit
 * rule on the weekly queue.
 */
function detailText(row: DispatchRow): React.ReactNode {
  switch (row.state) {
    case 'send_failed':
      // Garmin's own words, verbatim and untranslated. A paraphrase of "No Garmin
      // auth token" is how a coach ends up re-pushing instead of asking the athlete
      // to reconnect.
      return row.detail ? <span dir="auto">{row.detail}</span> : 'הדחיפה נכשלה';
    case 'unconfirmed':
      return 'גרמין קיבל אבל לא אישר — כדאי לדחוף שוב';
    case 'not_sent':
      return 'התוכנית ביקשה אימון ביום הזה ולא נדחף אף פעם';
    case 'blind':
      return row.connection === 'none'
        ? 'אין חיבור גרמין, אז ביצוע לא יכול לחזור'
        : 'הריצות שלו לא מגיעות אלינו, אז אין מה להסיק';
    case 'ran_from_it': {
      const at = clockTime(row.confirmedAt);
      return at ? <>חזר מהשעון ב-{at}</> : 'חזר מהשעון';
    }
    case 'on_account': {
      const at = clockTime(row.sentAt);
      return at ? <>נשלח ב-{at}, מחכה ליום האימון</> : 'מחכה ליום האימון';
    }
    case 'ran_freestyle':
      return 'רץ באותו יום, אבל לא התחיל מהאימון בשעון';
    case 'no_run':
      return 'לא נרשמה ריצה ביום הזה';
  }
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function WatchDispatch({ weekStart }: { weekStart: string }) {
  const [report, setReport] = useState<DispatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/academy/dispatch?weekStart=${encodeURIComponent(weekStart)}`, {
          headers: await apiHeaders(),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data?.error || 'לא הצלחנו לטעון את מצב השליחה'); return; }
        setReport(data as DispatchReport);
      } catch {
        if (!cancelled) setError('לא הצלחנו לטעון את מצב השליחה');
      }
    })();
    return () => { cancelled = true; };
  }, [weekStart]);

  if (error) return <p className="py-6 text-center text-xs text-accent-red-ink">{error}</p>;
  if (!report) return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  return <DispatchList report={report} />;
}

/** The icon the tab uses, exported so the page does not import lucide twice. */
export const DispatchIcon = Send;

'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { formatPace } from '@/components/activity/format';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { initialsOf } from './types';
import { RecordTest } from './RecordTest';
import type { Direction, Registry, RegistryRow } from '@/lib/academy/tests';

// ── The test registry, in place of the Excel ─────────────────────────────────
//
// Section 5's `מרשם הטסטים`. The club already records these tests; what it cannot get out
// of a spreadsheet is the line the mockup itself writes: "4 trainees have not tested in
// over four months — without a test there is no threshold update, and their plans are
// running on old data."
//
// So the screen is ranked on THAT and not on who improved. A trainee getting slower is
// information for their coach and is often entirely expected — a base block, a return from
// injury, a hot week. An athlete whose threshold is four months old is the academy's own
// process failing: every workout written for them is priced for a runner who no longer
// exists. One of those is a coaching conversation and the other is a queue, and only the
// queue belongs at the top of a screen.
//
// The ordering, the staleness rule, and every direction come from `lib/academy/tests.ts`.
// Nothing here re-sorts and nothing here decides what counts as improvement.

/**
 * Overdue wears band-2, the colour `ATTENTION_STYLE` already uses for `no_coach` and
 * `no_band` — a gap in the academy's own setup rather than a fault of the athlete. That is
 * exactly what a missing test is: nobody scheduled one. It deliberately does NOT wear the
 * red that dispatch uses for "there is no workout on that watch", because nothing is
 * broken here, and it does not wear the single warning colour either, which would put an
 * alarm next to the name of someone who is training perfectly well.
 */
const OVERDUE_CHIP = 'bg-band-2/10 text-band-2-ink';

/**
 * A regression is coloured on the NUMBER only, never as a wash behind the athlete's name.
 * Getting slower between two tests is a fact worth reading, not an accusation, and a red
 * card would make every base block look like a failure.
 */
const DIRECTION_TONE: Record<Direction, string> = {
  improved: 'text-accent-900',
  regressed: 'text-accent-red-ink',
  same: 'text-ink-500',
};

function DeltaText({ sec }: { sec: number }) {
  const rounded = Math.round(sec);
  if (rounded === 0) return <bdi dir="ltr">±0</bdi>;
  return <bdi dir="ltr">{rounded < 0 ? '−' : '+'}{Math.abs(rounded)}</bdi>;
}

/** `2026-09-14` → `14.09`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

/** How long ago, in the unit a person would say it in. */
function ageText(days: number): string {
  if (days < 31) return `לפני ${days} ימים`;
  const months = Math.round(days / 30);
  return `לפני ${months} חודשים`;
}

/** The pure view, mounted by the preview so the audit measures the real component. */
export function RegistryList({ registry }: { registry: Registry }) {
  const { rows, summary, byBand } = registry;
  const stale = rows.filter(r => r.overdue);

  if (!rows.length) {
    return <p className="py-6 text-center text-xs text-ink-400">אין מתאמנים באקדמיה להצגה.</p>;
  }

  return (
    <div className="space-y-3" dir="rtl">
      {/* Four buckets, not three, because these have to add up to the list below them.
          With only the three directions the header read 2/1/1 above seven rows and the
          other three people were nowhere in it — the dispatch screen's defect exactly.
          `noDelta` is everyone with one test or none, so the row always totals the roster. */}
      <div className="grid grid-cols-4 gap-1.5">
        <Kpi value={summary.improved} label="שיפרו" tone="text-accent-900" />
        <Kpi value={summary.same} label="ללא שינוי" tone="text-ink-500" />
        <Kpi value={summary.regressed} label="נסיגה" tone={summary.regressed ? 'text-accent-red-ink' : 'text-ink-400'} />
        <Kpi value={summary.noDelta} label="טרם נמדד" tone="text-ink-400" />
      </div>

      {/* The one line worth reading first, and the reason the screen exists. Named
          people, because a count sends nobody anywhere. */}
      {stale.length > 0 ? (
        <div className="rounded-card bg-band-2/10 px-3.5 py-3">
          <p className="flex items-start gap-2 text-xs text-band-2-ink">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-bold">
                {stale.length === 1
                  ? 'מתאמן אחד בלי טסט עדכני'
                  : <><bdi dir="ltr">{stale.length}</bdi> מתאמנים בלי טסט עדכני</>}
              </span>
              {' — '}בלי טסט אין עדכון ספים, והתוכניות שלהם רצות על נתונים ישנים:
              {' '}
              {/* Each name isolated AND unbreakable. The roster is Latin-only inside a
                  Hebrew sentence, so `<bdi>` is what keeps a comma from landing against the
                  wrong name — but isolation is not the same as cohesion, and it did not stop
                  the wrap: "Tamar Gold" still broke across the line end, which turned three
                  named people into what reads as four ("…, Tamar" / "Gold, …"). A count of 3
                  above a list of 4 is the kind of thing that makes a coach distrust the
                  whole panel. `whitespace-nowrap` moves the whole name to the next line. */}
              {stale.map((r, i) => (
                <span key={r.athleteId}>
                  {i > 0 && ', '}
                  <bdi dir="ltr" className="whitespace-nowrap">{r.name}</bdi>
                </span>
              ))}
            </span>
          </p>
        </div>
      ) : (
        <div className="rounded-card bg-card px-3.5 py-3">
          <p className="text-sm font-semibold text-accent-900">לכולם יש טסט עדכני.</p>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map(row => <Row key={row.athleteId} row={row} />)}
      </div>

      {/* The manager's question, which no single athlete's graph answers: does the method
          work, and does it work the same at every level? */}
      {byBand.length > 1 && (
        <div className="rounded-card bg-card p-3.5 space-y-2">
          <h3 className="text-xs font-bold text-ink-900">לפי דבוקה</h3>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-1 text-[10px] font-semibold text-ink-400">
            <span>דבוקה</span><span className="text-end">מתאמנים</span><span className="text-end">שיפור ממוצע</span>
          </div>
          {byBand.map(band => (
            <div
              key={String(band.bandNumber)}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-pill bg-page px-2 py-1.5 text-[11px]"
            >
              <span className="text-ink-700">
                {band.bandNumber === null ? 'ללא דבוקה' : <>דבוקה <bdi dir="ltr">{band.bandNumber}</bdi></>}
              </span>
              <span className="text-end tabular-nums text-ink-500"><bdi dir="ltr">{band.athletes}</bdi></span>
              <span className={cn('text-end font-semibold tabular-nums', band.direction ? DIRECTION_TONE[band.direction] : 'text-ink-400')}>
                {/* "Not yet" rather than a flattering zero: a band whose members have one
                    test each has no average to report. */}
                {band.averageDeltaSec === null
                  ? <span className="font-normal text-ink-400">טרם</span>
                  : <><DeltaText sec={band.averageDeltaSec} /> שנ׳</>}
              </span>
            </div>
          ))}
        </div>
      )}
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

function Row({ row }: { row: RegistryRow }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-card px-3 py-3 text-right">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-page text-xs font-bold text-ink-500">
        {initialsOf(row.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold text-ink-900" dir="auto">{row.name}</span>
          {row.overdue && (
            <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-semibold', OVERDUE_CHIP)}>
              {row.lastTestDate !== null
                ? 'טסט לא עדכני'
                : row.excludedCount > 0 ? 'הטסט נזרק' : 'אין טסט'}
            </span>
          )}
        </div>
        {/* Second line, never the same line — a date competing with a name is what
            truncated the name in the weekly queue. */}
        <p className="mt-0.5 text-[11px] text-ink-400">
          {/* Two different silences, and they used to read as one. An athlete who never
              tested and an athlete whose only test the coach threw out both have no usable
              date, and telling the coach "no test was ever recorded" about a test he
              recorded himself sends him looking for data loss. */}
          {row.lastTestDate === null
            ? row.excludedCount > 0
              ? row.excludedCount === 1 ? 'הטסט היחיד לא נכלל' : 'כל הטסטים לא נכללו'
              : 'לא נרשם טסט מעולם'
            : <>
                <bdi dir="ltr">{shortDate(row.lastTestDate)}</bdi>
                {row.ageDays !== null && <> · {ageText(row.ageDays)}</>}
              </>}
        </p>
      </div>

      <div className="shrink-0 text-end">
        <div className="text-sm font-bold tabular-nums text-ink-900">
          <bdi dir="ltr">{row.lastPaceSec === null ? '—' : formatPace(row.lastPaceSec)}</bdi>
        </div>
        <div className={cn('text-[11px] font-semibold tabular-nums', row.direction ? DIRECTION_TONE[row.direction] : 'text-ink-400')}>
          {/* `בסיס` for a first test and `—` for none: one is a baseline, the other is a
              missing measurement, and both used to render as an empty cell. */}
          {row.deltaSec === null
            ? (row.lastTestDate === null ? '—' : 'בסיס')
            : <DeltaText sec={row.deltaSec} />}
        </div>
      </div>
    </div>
  );
}

/** The fetching wrapper. Staff-only screen, so it does not guard on identity here. */
export function TestRegistry({ protocol = '30min' }: { protocol?: string }) {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/academy/tests?protocol=${encodeURIComponent(protocol)}`, {
        headers: await apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { setState('error'); return; }
      if (data?.tableMissing) { setState('missing'); return; }
      setRegistry(data as Registry);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [protocol]);

  useEffect(() => {
    setState('loading');
    void load();
  }, [load]);

  if (state === 'loading') return <p className="py-6 text-center text-xs text-ink-400">טוען…</p>;
  if (state === 'missing') {
    // Migration 105 is pasted in by hand. Said plainly, because "no tests" would send
    // Ofer looking for a bug in the wrong place — the club's tests exist, in a spreadsheet.
    return (
      <p className="py-6 text-center text-xs leading-relaxed text-ink-400">
        מרשם הטסטים עוד לא הוקם במסד הנתונים.
        <br />צריך להריץ את מיגרציה <bdi dir="ltr">105</bdi>.
      </p>
    );
  }
  if (state === 'error' || !registry) {
    return <p className="py-6 text-center text-xs text-accent-red-ink">לא הצלחנו לטעון את מרשם הטסטים</p>;
  }
  return (
    <div className="space-y-3">
      {/* The entry form sits ABOVE the list, and the list is what it changes. Recording a
          test is the action this screen exists to make possible — before this the table was
          applied and empty with no way to put anything in it — but the queue is what the
          coach came to read, so the form stays collapsed until asked for. The candidate
          list is the registry's own rows, so the picker can never offer somebody this
          caller is not allowed to record for. */}
      <RecordTest
        athletes={registry.rows.map(r => ({ athleteId: r.athleteId, name: r.name }))}
        protocol={protocol}
        onSaved={() => { void load(); }}
      />
      <RegistryList registry={registry} />
    </div>
  );
}

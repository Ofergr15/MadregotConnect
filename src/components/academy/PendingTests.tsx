'use client';

import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { formatPace } from '@/components/activity/format';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── The approval queue ───────────────────────────────────────────────────────
//
// A trainee submitted a test. Until staff approve it, it counts toward nothing — not the
// threshold, not the trend, not the staleness clock (the API filters it out of all three,
// see `api/academy/tests/route.ts`). So this card is the only place the number exists, and
// if it is easy to miss then the feature has quietly made the registry LESS accurate: the
// athlete believes they have tested and the screen still says they are overdue.
//
// Which is why it sits above the overdue banner, and in the brand tint rather than band-2 —
// band-2 is the academy's colour for a setup gap nobody is at fault for, and this is the
// opposite: a decision waiting on one named person.
//
// It says the pace in full, because the question is not "is this form valid" but "is this the
// number I am willing to price their next block against" — and that is unanswerable without
// the pace. `4:40` is a judgement a coach makes in a second; `6500 metres in 1800 seconds`
// is arithmetic they have to do first.
//
// Rejection deletes the row. There is no third state, and no "rejected" list to review
// later: a wrong number is not history worth keeping, and a test that really was run but
// should not count is what `excluded_reason` is for, on an approved row.

export interface PendingSubmission {
  testId: string;
  athleteId: string;
  name: string | null;
  date: string;
  protocol: string;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  paceSec: number | null;
  submittedAt: string | null;
  /** The pace is outside anything a human runs — usually metres typed as kilometres. */
  implausible: boolean;
}

/** `2026-09-14` → `14.09`. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

/**
 * The distance as it was entered, not a tidied version of it.
 *
 * This was `Math.round`, which rendered the single most likely bad submission — `6.42`
 * typed into a metres field, i.e. kilometres — as a confident "6 מ׳". That hides the exact
 * mistake this card exists to catch: the coach sees an absurd pace next to a distance that
 * looks merely wrong rather than obviously in the wrong units, and has nothing to quote back
 * to the athlete. Rounding is only ever cosmetic here; being able to read `6.42` is not.
 */
export function metres(m: number): string {
  return Number.isInteger(m) ? String(m) : String(Number(m.toFixed(2)));
}

export function PendingTests({
  pending,
  onDecided,
}: {
  pending: PendingSubmission[];
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(testId: string, action: 'approve' | 'reject') {
    if (busy) return;
    setBusy(testId);
    setError(null);
    try {
      const res = await fetch('/api/academy/tests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await apiHeaders()) },
        body: JSON.stringify({ testId, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ? String(data.error) : 'לא הצלחנו לעדכן את הטסט');
        return;
      }
      onDecided();
    } catch {
      setError('לא הצלחנו לעדכן את הטסט');
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <div className="rounded-card bg-brand-600/10 p-3.5 space-y-2.5" dir="rtl">
      <h3 className="text-sm font-bold text-brand-700">
        {pending.length === 1
          ? 'טסט אחד ממתין לאישור'
          : <><bdi dir="ltr">{pending.length}</bdi> טסטים ממתינים לאישור</>}
      </h3>
      {/* Said once, at the top: nothing here is affecting anybody's training yet. Without
          this line an unapproved submission looks like a recorded test that the registry
          below is inexplicably ignoring. */}
      <p className="text-xs leading-relaxed text-ink-500">
        המתאמן הזין את המספר בעצמו. עד שתאשר, הטסט לא נכנס לגרף, לא מעדכן את קצב הסף ולא
        מוריד את ההתראה על טסט לא עדכני.
      </p>

      {pending.map(item => (
        <div key={item.testId} className="rounded-card bg-card p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink-900" dir="auto">
                {item.name ?? item.athleteId}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                <bdi dir="ltr">{shortDate(item.date)}</bdi>
                {' · '}
                {/* The two halves, so the coach can check the pace rather than trust it. */}
                <bdi dir="ltr">{metres(item.distanceM)}</bdi> מ׳
                {item.avgHr !== null && <> · דופק <bdi dir="ltr">{item.avgHr}</bdi></>}
              </p>
            </div>
            <div className="shrink-0 text-end">
              <div className={cn(
                'text-base font-bold tabular-nums',
                item.implausible ? 'text-band-3-ink' : 'text-ink-900',
              )}>
                <bdi dir="ltr">{item.paceSec === null ? '—' : formatPace(item.paceSec)}</bdi>
              </div>
              {/* 11px, not 10: the audit flags 10px as unreadable, and `RecordTest` already
                  writes this same unit at 11 under its own computed pace. */}
              <div className="text-[11px] text-ink-400">לק״מ</div>
            </div>
          </div>

          {item.implausible && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-band-3-ink">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>הקצב הזה לא נראה סביר — כנראה מרחק בק״מ במקום במטרים. כדאי לשאול לפני אישור.</span>
            </p>
          )}

          <div className="flex gap-2">
            {/* Approve first and wider: it is the common answer, and the one a thumb
                should find without aiming. Reject deletes, so it is the quieter button. */}
            <button
              type="button"
              onClick={() => decide(item.testId, 'approve')}
              disabled={busy === item.testId}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-card bg-brand-600 text-sm font-bold text-white disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {busy === item.testId ? 'מעדכן…' : 'אישור'}
            </button>
            <button
              type="button"
              onClick={() => decide(item.testId, 'reject')}
              disabled={busy === item.testId}
              className="flex h-11 items-center justify-center gap-1.5 rounded-card bg-page px-4 text-sm font-semibold text-ink-500 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              דחייה
            </button>
          </div>
        </div>
      ))}

      {error && <p className="text-[11px] text-accent-red-ink">{error}</p>}
    </div>
  );
}

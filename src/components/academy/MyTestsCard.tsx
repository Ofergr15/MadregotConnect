'use client';

import { forwardRef, useCallback, useEffect, useState } from 'react';
import { apiHeaders } from '@/lib/api';
import { fmtPace } from '@/lib/academy/pace-verdict';
import type { TrendSeries } from '@/lib/academy/tests';
import type { TestInvitation } from '@/lib/academy/testInvite';
import { RecordTest } from './RecordTest';
import { WaitingCard } from './MyTest';
import type { PendingSubmission } from './PendingTests';

// ── "הטסטים שלי" — the latest test and the one before it, side by side ─────
//
// NEUTRAL by design (mockup academy-trainee-home-v4): no arrow, no green or red,
// no "improved by". When the number moved, the two figures say so; when it did
// not, nothing on the screen says "no improvement" — that conversation belongs
// to the coach, not to a colour. Which is why this replaced the improvement graph
// on the trainee's own screen.
//
// The entry form stays reachable underneath (a trainee can still send a result
// without waiting on anybody's evening), and a submitted result shows the same
// "sent, nothing changed yet" card MyTest always did.

interface TestsResponse {
  trend?: TrendSeries;
  pending?: PendingSubmission[];
  tableMissing?: boolean;
}

/** `2026-09-02` → `2.9`. */
function dm(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}`;
}

/** When the next test is, from the invitation: "בעוד 5 ימים" / "היום" / its date. */
function nextLabel(invitation: TestInvitation, now: Date): { big: string; small: string } {
  const slot = invitation.confirmedSlot || invitation.proposedSlots[0] || null;
  if (!slot) return { big: 'בתיאום', small: 'עם המאמן' };
  const days = Math.round((Date.parse(slot.slice(0, 10)) - Date.parse(now.toISOString().slice(0, 10))) / 86_400_000);
  const small = invitation.confirmedSlot ? 'מאושר' : 'מוצע';
  if (days <= 0) return { big: 'היום', small };
  if (days === 1) return { big: 'מחר', small };
  if (days < 14) return { big: `בעוד ${days} ימים`, small };
  return { big: dm(slot.slice(0, 10)), small };
}

export const MyTestsCard = forwardRef<HTMLDivElement, {
  athleteId: string;
  name: string;
  invitation: TestInvitation | null;
  protocol?: string;
  /** A result was just sent from here — the invitation above stands down. */
  onRecorded?: () => void;
}>(function MyTestsCard({ athleteId, name, invitation, protocol = '30min', onRecorded }, ref) {
  const [data, setData] = useState<TestsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/academy/tests?protocol=${encodeURIComponent(protocol)}&athleteId=${encodeURIComponent(athleteId)}`,
        { headers: await apiHeaders() },
      );
      if (!res.ok) { setState('error'); return; }
      setData((await res.json()) as TestsResponse);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [athleteId, protocol]);

  useEffect(() => { setState('loading'); void load(); }, [load]);

  // Silent while loading and on failure, as MyTest always was: an error card about a
  // feature somebody may never have used is worse than its absence.
  if (state !== 'ready' || !data || data.tableMissing) return null;

  const points = (data.trend?.points ?? []).filter((p) => p.paceSec != null);
  const latest = points[points.length - 1] ?? null;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const waiting = (data.pending ?? []).filter((p) => p.athleteId === athleteId);
  const next = invitation ? nextLabel(invitation, new Date()) : null;
  const tiles = [latest, previous, next].filter(Boolean).length;

  return (
    <div ref={ref} className="rounded-2xl bg-card px-3 py-2.5 scroll-mt-4" dir="rtl">
      <div className="flex items-baseline justify-between">
        <b className="text-[13.5px] font-black text-ink-700">הטסטים שלי</b>
        <span className="text-xs font-bold text-ink-400">טסט סף</span>
      </div>

      {tiles === 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
          טסט סף הוא ריצה של 30 דקות בכל הכוח. המרחק שעברת קובע את הקצבים שלפיהם נכתבים האימונים שלך.
        </p>
      ) : (
        <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(tiles, 2)}, 1fr)` }}>
          {latest && (
            <div className="rounded-xl bg-page/40 p-2 text-center">
              <span className="block text-3xs text-ink-400">האחרון · <bdi dir="ltr">{dm(latest.date)}</bdi></span>
              <b className="mt-0.5 block text-lg font-black text-ink-700"><bdi dir="ltr">{fmtPace(latest.paceSec)}</bdi></b>
              <small className="text-3xs text-ink-400">לק״מ</small>
            </div>
          )}
          {previous && (
            <div className="rounded-xl bg-page/40 p-2 text-center">
              <span className="block text-3xs text-ink-400">הקודם · <bdi dir="ltr">{dm(previous.date)}</bdi></span>
              {/* Muted, not coloured: the previous figure is context, not a verdict. */}
              <b className="mt-0.5 block text-lg font-black text-ink-500"><bdi dir="ltr">{fmtPace(previous.paceSec)}</bdi></b>
              <small className="text-3xs text-ink-400">לק״מ</small>
            </div>
          )}
          {next && (
            <div className="rounded-xl bg-page/40 p-2 text-center">
              <span className="block text-3xs text-ink-400">הבא</span>
              <b className="mt-1 block text-13 font-black text-ink-700">{next.big}</b>
              <small className="text-3xs text-ink-400">{next.small}</small>
            </div>
          )}
        </div>
      )}

      {waiting.length > 0 ? (
        <div className="mt-2 space-y-2">{waiting.map((item) => <WaitingCard key={item.testId} item={item} />)}</div>
      ) : (
        <div className="mt-2">
          <RecordTest
            athletes={[{ athleteId, name }]}
            protocol={protocol}
            selfSubmit
            onSaved={() => { void load(); onRecorded?.(); }}
          />
        </div>
      )}
    </div>
  );
});

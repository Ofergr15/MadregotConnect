'use client';

import { notFound } from 'next/navigation';
import { useState } from 'react';

import { TestAnalysisSheet } from '@/components/academy/TestAnalysisSheet';
import { analyzeTest, draftSummary, recommendBand } from '@/lib/academy/testAnalysis';
import type { AcademyBand } from '@/lib/academy/bands';

// ── Login-free preview of the test-analysis sheet ─────────────────────────────
//
// Funnel step 8, the step the process map marks "here there is a lot to take": a coach reads
// 6.42 km in thirty minutes off a watch and turns it into a threshold, five training paces, a
// band and a paragraph of Hebrew. This is that screen, and it is the one screen in the academy
// whose interesting behaviour is invisible from a screenshot, because all of it is sequence:
//
//  1. **An edit is a fact about the coach.** `ערוך`, type `4:52`, and the two derived rows move
//     with it while the source column stops claiming `מחושב` for the threshold. What the app
//     stores keeps both — the formula's number and the signed one — so a coefficient change next
//     year cannot rewrite the paces a plan was written against.
//  2. **Approving is not telling.** `אשר ושבץ` moves the trainee's band, which prices every
//     workout they will ever get, and sends them nothing. Sending is a second, separate tap, and
//     what goes out is the STORED text — so type in the textarea after approving and the send
//     button disables itself and says why. That sequence is the whole reason this preview exists.
//  3. **The band recommendation is blocked on DATA, not code.** The toggle below writes a
//     `thresholdPaceSec` onto the bands, which no real band has. With it, the sheet recommends a
//     דבוקה; without it, it says there is nothing to compare against and why. The second is what
//     the coach sees in production today.
//  4. **Check 4, which has never been run against the real app.** `6.42` typed into a metres
//     field instead of `6420` — the units slip. The orange warning appears and NOTHING is
//     disabled, because a coach who knows the number is right must still be able to approve it.
//  5. **A short test is not a threshold test.** The 3 km case is Riegel-adjusted to a thirty-
//     minute equivalent and says so, because it is the one row that will not match the registry
//     and an unexplained mismatch reads as a bug.
//
// The numbers are all computed by the real `analyzeTest`, `recommendBand` and `draftSummary`;
// the network is stubbed, and the stub keeps the saved row in memory so that approve → edit →
// send behaves the way it does against the database. Every write is swallowed: nothing here
// reaches a trainee's thread.
//
// Development only. In production the route does not exist.

interface Fixture {
  id: string;
  label: string;
  note: string;
  name: string;
  date: string;
  protocol: string;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  previousPaceSec: number | null;
}

const FIXTURES: Fixture[] = [
  {
    id: 't-30min', label: '30 דקות', note: 'הטסט הרגיל של האקדמיה — 6.42 ק"מ בחצי שעה.',
    name: 'Yael Peretz', date: '2026-09-14',
    protocol: '30min', durationSec: 1800, distanceM: 6420, avgHr: 178, previousPaceSec: 288,
  },
  {
    id: 't-3km', label: '3 ק"מ', note: 'קצר מ-30 דקות, ולכן הסף מחושב כשווה-ערך.',
    name: 'Avi Barak', date: '2026-09-12',
    protocol: '3km', durationSec: 720, distanceM: 3000, avgHr: 184, previousPaceSec: null,
  },
  {
    id: 't-units', label: '6.42 במקום 6420', note: 'החלקה ביחידות — בדיקה 4.',
    name: 'Dor Alon', date: '2026-09-13',
    protocol: '30min', durationSec: 1800, distanceM: 6.42, avgHr: 176, previousPaceSec: null,
  },
  {
    id: 't-nohr', label: 'בלי דופק', note: 'שעון בלי רצועה — דופק ממוצע לא נמדד.',
    name: 'Tamar Bar', date: '2026-09-15',
    protocol: '30min', durationSec: 1800, distanceM: 5400, avgHr: null, previousPaceSec: null,
  },
];

/** Three bands, and the one field nobody has ever recorded on a real one. */
const BAND_THRESHOLDS: Record<string, number> = { b5: 265, b6: 281, b7: 302 };

function bands(withPaces: boolean): AcademyBand[] {
  return [5, 6, 7].map(n => ({
    id: `b${n}`,
    bandNumber: n,
    name: `דבוקה ${n}`,
    goal: null,
    paceProfile: withPaces ? { thresholdPaceSec: BAND_THRESHOLDS[`b${n}`] } : {},
  }));
}

/**
 * What the database would be holding.
 *
 * Mutable on purpose: the sheet re-reads after every save, and the properties worth checking here
 * — sending only after an approval, and the send button disabling itself once the textarea has
 * moved away from the stored text — are all about the difference between what is typed and what
 * is stored. A stub that answered with a constant row could not show any of them.
 */
type StoredRow = {
  id: string; approved: Record<string, number>; bandId: string | null;
  summary: string | null; status: string; approvedAt: string | null;
  sentAt: string | null; sentSummary: string | null;
};
const SAVED: Record<string, StoredRow> = {};

/** Which case the stub is answering for, and whether the bands carry paces. */
const ACTIVE = { withPaces: true };

function analysisResponse(testId: string): unknown {
  const fixture = FIXTURES.find(f => f.id === testId) ?? FIXTURES[0];
  const derived = analyzeTest(fixture);
  const list = bands(ACTIVE.withPaces);
  const rec = recommendBand(derived?.thresholdPaceSec ?? null, list);

  return {
    test: {
      id: fixture.id, athleteId: `a-${fixture.id}`, name: fixture.name, date: fixture.date,
      protocol: fixture.protocol, durationSec: fixture.durationSec, distanceM: fixture.distanceM,
      avgHr: fixture.avgHr, excludedReason: null,
    },
    currentBandId: null,
    derived,
    draftSummary: derived
      ? draftSummary(fixture, derived, fixture.previousPaceSec ? { paceSec: fixture.previousPaceSec } : null)
      : '',
    previousPaceSec: fixture.previousPaceSec,
    bands: list,
    recommendation: {
      bandId: rec.band?.id ?? null,
      bandNumber: rec.band?.bandNumber ?? null,
      reason: rec.reason,
      gapSec: rec.gapSec,
    },
    analysis: SAVED[fixture.id] ?? null,
    tableMissing: false,
  };
}

if (typeof window !== 'undefined' && !(window as { __analysisStub?: boolean }).__analysisStub) {
  (window as { __analysisStub?: boolean }).__analysisStub = true;
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/academy/test-analysis')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/send')) {
        // The one outward-facing act on the real screen, and here it only writes to memory. What
        // it records is the STORED summary, exactly as the route does — that is what makes the
        // "the trainee has an earlier version" line appear after the next edit.
        const row = SAVED[body.testId];
        if (!row || row.status !== 'approved') {
          return new Response('{"code":"not_approved"}', { status: 400 });
        }
        row.sentAt = new Date().toISOString();
        row.sentSummary = row.summary;
        return new Response('{"ok":true,"recorded":true}', { status: 200 });
      }

      if (init?.method === 'POST') {
        const previous = SAVED[body.testId];
        SAVED[body.testId] = {
          id: `an-${body.testId}`,
          approved: body.approved ?? {},
          bandId: body.bandId ?? null,
          summary: body.summary ?? null,
          status: body.status,
          approvedAt: body.status === 'approved' ? new Date().toISOString() : null,
          // Delivery survives a re-approval: the trainee is still holding what was sent.
          sentAt: previous?.sentAt ?? null,
          sentSummary: previous?.sentSummary ?? null,
        };
        return new Response('{"ok":true,"bandAssigned":true}', { status: 200 });
      }

      const testId = new URL(url, 'http://x').searchParams.get('testId') || '';
      return new Response(JSON.stringify(analysisResponse(testId)), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('/api/')) return new Response('{"ok":true}', { status: 200 });
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyAnalysis() {
  if (process.env.NODE_ENV === 'production') notFound();

  const [testId, setTestId] = useState(FIXTURES[0].id);
  const [withPaces, setWithPaces] = useState(true);
  const [open, setOpen] = useState(true);
  // Remounts the sheet, which is how a case change re-reads: the sheet loads when it opens, and
  // the stub's answer depends on both of these.
  const key = `${testId}-${withPaces}`;

  const choose = (id: string) => { setTestId(id); setOpen(true); };
  const toggle = () => { ACTIVE.withPaces = !withPaces; setWithPaces(v => !v); setOpen(true); };

  const active = FIXTURES.find(f => f.id === testId) ?? FIXTURES[0];

  return (
    <div className="min-h-screen bg-page p-4" dir="rtl">
      <h1 className="mb-1 text-lg font-bold text-ink-900">ניתוח טסט</h1>
      <p className="mb-3 text-xs leading-relaxed text-ink-400">
        המסך האמיתי על נתוני דמה, בלי התחברות. אישור משבץ דבוקה ולא שולח כלום; שליחה היא הקשה
        נפרדת, ומה שיוצא הוא הנוסח השמור — אחרי אישור, שינוי בטקסט מנטרל את השליחה ואומר למה.
        שום דבר כאן לא יוצא למתאמן.
      </p>

      {/* The chooser is behind the sheet while it is open, and deliberately so: the sheet is a
          modal, and Vaul takes pointer events off the page under it — a z-index high enough to
          paint above it would still not be tappable, so pretending otherwise would just be a
          control that looks live and is not. Close the sheet to switch, which the line below
          says out loud. */}
      <div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {FIXTURES.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => choose(f.id)}
              aria-pressed={f.id === testId}
              className={`min-h-[44px] rounded-pill px-3 text-xs font-semibold ${
                f.id === testId ? 'bg-brand-600 text-white' : 'bg-card text-ink-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-pressed={withPaces}
          className={`min-h-[44px] w-full rounded-card px-3 text-xs font-semibold ${
            withPaces ? 'bg-accent-900/10 text-accent-900' : 'bg-band-2/10 text-band-2-ink'
          }`}
        >
          {withPaces
            ? 'לדבוקות יש טווח קצבים — יש המלצה'
            : 'לדבוקות אין טווח קצבים — זה המצב בפרודקשן היום'}
        </button>

        <p className="mt-2 px-1 text-[11px] leading-relaxed text-ink-400">
          {active.note} להחלפת מקרה צריך לסגור את הגיליון (גרירה למטה) ואז לבחור.
        </p>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 min-h-[48px] w-full rounded-card bg-brand-600 text-sm font-bold text-white"
        >
          פתח את הניתוח
        </button>
      )}

      <TestAnalysisSheet key={key} open={open} onOpenChange={setOpen} testId={testId} />
    </div>
  );
}

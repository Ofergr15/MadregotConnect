'use client';

import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildRegistry, buildTrend, type RegistryAthlete, type TestRow } from '@/lib/academy/tests';
import { ImprovementChart } from '@/components/academy/ImprovementChart';
import { RecordTest } from '@/components/academy/RecordTest';
import { RegistryList } from '@/components/academy/TestRegistry';

// ── Login-free preview of the improvement graph and the test registry ────────
//
// Both fixtures go through the REAL `buildTrend` / `buildRegistry`, so the ranked order,
// every delta, and every direction below are the shipped ones. A row in the wrong place
// here is a bug and not a fixture typo — which is the only way a preview of a ranked list
// is worth auditing.
//
// Deterministic, like every other preview in this directory: fixtures built from
// `Date.now()` at module scope evaluate once on the server and again in the browser, and
// the hydration mismatch makes React discard the tree (it cost a debugging session on
// /preview/academy-thread). Dates are counted back from the Israel calendar day.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/** A date `daysAgo` before the Israel calendar day, as `YYYY-MM-DD`. */
function day(daysAgo: number): string {
  return israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
}

let seq = 0;
/** A 30-minute test covering `meters`. Duration fixed, distance is the measurement. */
const test = (athleteId: string, daysAgo: number, meters: number, over: Partial<TestRow> = {}): TestRow => ({
  id: `t${++seq}`,
  athleteId,
  date: day(daysAgo),
  protocol: '30min',
  durationSec: 1800,
  distanceM: meters,
  ...over,
});

// Dor's own history — the mockup's case: four tests over seven months, steadily faster.
// 5850 → 6420m in 30 minutes is 5:08 → 4:40 per km.
const DOR: TestRow[] = [
  test('dor', 212, 5850),
  test('dor', 138, 6080),
  test('dor', 68, 6280),
  test('dor', 4, 6420),
  // Thrown out, and named on the screen rather than silently dropped.
  test('dor', 100, 5400, { excludedReason: 'רץ עם שפעת' }),
];

const ATHLETES: RegistryAthlete[] = [
  { id: 'dor', name: 'Dor Alon', bandNumber: 5 },
  { id: 'noa', name: 'Noa Shemesh', bandNumber: 5 },
  { id: 'avi', name: 'Avi Barak', bandNumber: 6 },
  { id: 'uri', name: 'Uri Gal', bandNumber: 6 },
  { id: 'michal', name: 'Michal Cohen', bandNumber: 8 },
  { id: 'yael', name: 'Yael Peretz', bandNumber: 8 },
  { id: 'tamar', name: 'Tamar Gold', bandNumber: null },
];

const TESTS: TestRow[] = [
  ...DOR,
  // Improved a lot.
  test('noa', 190, 5500),
  test('noa', 6, 5900),
  // Improved slightly — inside the noise floor, so reported as unchanged rather than as
  // progress. This is the row that proves the floor is doing work.
  test('avi', 120, 7400),
  test('avi', 9, 7420),
  // Got slower, and tested recently. Must NOT outrank the overdue athletes below.
  test('uri', 150, 5400),
  test('uri', 10, 5300),
  // Overdue: tested once, long ago.
  test('yael', 143, 5580),
  // Every test thrown out, so they count as never having produced a threshold.
  test('tamar', 20, 6000, { excludedReason: 'שעון איבד קליטה' }),
  // Michal: no test at all.
];

export default function AcademyTestsPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const trend = buildTrend(DOR, '30min');
  const registry = buildRegistry({
    athletes: ATHLETES,
    tests: TESTS,
    protocol: '30min',
    today: israelToday(),
  });

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-900">שיפור ומגמות</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · נתוני דמה</p>
        </div>

        <ImprovementChart
          trend={trend}
          heading="השיפור של Dor Alon"
          subtitle="דבוקה 5 · טסט 30 דקות"
        />

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-ink-900">מרשם הטסטים</h2>
          {/* The real form. Saving from here hits the API and gets a 401, which is correct —
              the audit is after the layout, the computed pace, and the units warning. */}
          <RecordTest
            athletes={ATHLETES.map(a => ({ athleteId: a.id, name: a.name }))}
            onSaved={() => {}}
          />
          <RegistryList registry={registry} />
        </div>
      </div>
    </div>
  );
}

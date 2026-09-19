'use client';

import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildRegistry } from '@/lib/academy/tests';
import { RecordTest } from '@/components/academy/RecordTest';
import { RegistryList } from '@/components/academy/TestRegistry';

// ── The test registry with an empty academy ──────────────────────────────────
//
// The state the real dashboard is in TODAY, and the first thing Ofer saw when he opened the
// tab: no athlete is marked as an academy trainee, so there is nobody to record a test for.
// Worth its own route rather than a `?state=` branch on the main preview — a client-read
// query param renders one way on the server and another in the browser, and the hydration
// mismatch makes React throw the tree away (it has cost a debugging session on
// /preview/academy-thread already).
//
// What it has to prove: the form does NOT offer itself when the picker would be empty, and
// the panel says what is missing instead of "nothing to show" in grey 11px. An empty academy
// is a setup gap, not a quiet day.
//
// Development only. In production the route does not exist.

export default function AcademyTestsEmptyPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const registry = buildRegistry({
    athletes: [],
    tests: [],
    protocol: '30min',
    today: israelToday(),
  });

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-900">שיפור ומגמות</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · אקדמיה ריקה</p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-ink-900">מרשם הטסטים</h2>
          {/* Mounted on purpose even though it must render nothing: that it renders nothing
              is the assertion. */}
          <RecordTest athletes={[]} onSaved={() => {}} />
          <RegistryList registry={registry} />
        </div>
      </div>
    </div>
  );
}

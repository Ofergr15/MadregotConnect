'use client';

import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildRegistry } from '@/lib/academy/tests';
import { RecordTest } from '@/components/academy/RecordTest';
import { RegistryList } from '@/components/academy/TestRegistry';

// ── One trainee, so there is nothing to choose ────────────────────────────────
//
// The academy's real shape: coaching here is 1:1, so the form's candidate list holds ONE
// person far more often than it holds a roster. Ofer's own account is the live example —
// he is currently the only athlete with `is_academy`, and the form still opened on
// "בחר מתאמן…" above a disabled save button, asking him to make a choice with no
// alternatives before he could type a number.
//
// What this screen has to prove: no `<select>` at all when there is one candidate, the name
// stated as a fact, and the save button reachable on the first number typed rather than
// after a pointless selection. The registry below it is the same single athlete, so the
// screen reads the way the real dashboard does today.
//
// Development only. In production the route does not exist.

const SOLO = [{ athleteId: 'ofer', name: 'Ofer Grosfeld' }];

export default function AcademyTestsSoloPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const registry = buildRegistry({
    athletes: [{ id: 'ofer', name: 'Ofer Grosfeld', bandNumber: 4 }],
    tests: [],
    protocol: '30min',
    today: israelToday(),
  });

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-900">שיפור ומגמות</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · מתאמן אחד</p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-ink-900">מרשם הטסטים</h2>
          <RecordTest athletes={SOLO} onSaved={() => {}} />
          <RegistryList registry={registry} />
        </div>
      </div>
    </div>
  );
}

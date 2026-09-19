'use client';

import { notFound } from 'next/navigation';

import { WaitingCard } from '@/components/academy/MyTest';
import { RecordTest } from '@/components/academy/RecordTest';
import type { PendingSubmission } from '@/components/academy/PendingTests';

// ── The athlete's own side ────────────────────────────────────────────────────
//
// Unreachable on any coaching account: `dashboard/academy` returns the console before it
// reaches the athlete lens, and the academy currently holds one athlete who is also the
// coach. So without this route the trainee's half of the feature ships unseen.
//
// Three states, in the order a runner meets them:
//
//  1. **Before their first test** — the explainer plus a door that says שליחת טסט למאמן and
//     not רישום טסט. The wording is the whole point: a button promising to record something
//     the route will hold for approval is a lie the screen tells on the coach's behalf.
//  2. **The form open** — identical to the coach's form except for the verbs, with the name
//     stated as a fact (one candidate, so nothing to choose) and the computed pace as the
//     check. An athlete has never typed a threshold test before, so `4:37` appearing under
//     the field is where they notice they meant metres.
//  3. **Sent** — the state that decides whether this feature reads as honest. Nothing has
//     moved: no point on the graph, no new threshold, and the overdue flag still up. The
//     card has to say so in the athlete's own words, or the app looks broken.
//
// Development only. In production the route does not exist.

const WAITING: PendingSubmission = {
  testId: 'p1',
  athleteId: 'ofer',
  name: 'Ofer Grosfeld',
  date: '2026-09-18',
  protocol: '30min',
  durationSec: 1800,
  distanceM: 6500,
  avgHr: 172,
  paceSec: 1800 / 6.5,
  submittedAt: '2026-09-18T15:02:00Z',
  implausible: false,
};

const ME = [{ athleteId: 'ofer', name: 'Ofer Grosfeld' }];

export default function AcademyTestsMinePreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <div className="mx-auto max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-bold text-ink-900">טסט סף — הצד של הספורטאי</h1>
          <p className="text-xs text-ink-400">תצוגה מקדימה · שלושה מצבים</p>
        </div>

        <Case label="לפני הטסט הראשון">
          <div className="space-y-3">
            <RecordTest athletes={ME} protocol="30min" selfSubmit onSaved={() => {}} />
            <p className="px-1 text-xs leading-relaxed text-ink-400">
              טסט סף הוא ריצה של 30 דקות בכל הכוח. המרחק שעברת קובע את קצב הסף שלפיו נכתבים
              האימונים שלך, ואחרי שני טסטים יופיע כאן גרף שיפור.
            </p>
          </div>
        </Case>

        <Case label="נשלח, ממתין למאמן">
          <WaitingCard item={WAITING} />
        </Case>
      </div>
    </div>
  );
}

function Case({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      {children}
    </div>
  );
}

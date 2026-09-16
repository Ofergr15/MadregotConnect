import { notFound } from 'next/navigation';
import { QueueList } from '@/components/academy/WeeklyQueue';
import { buildQueue } from '@/lib/academy/queue';
import type { AcademyWeekReport, WorkoutAdherenceRow } from '@/lib/academy/report';
import { DEFAULT_TOLERANCES } from '@/lib/academy/adherence';

// ── Login-free preview of the mentor's weekly queue ─────────────────────────
//
// Same reason as the two previews next door: the real screen is inside the staff
// academy tab, behind a session and a staff flag, and its API is staff-only — so
// checking the layout on a phone means lining three things up first.
//
// What is NOT faked is the ordering. The fixture is a week's adherence report and
// the real `buildQueue` sorts it, so the rows appear here in the order the mentor
// would see, with the reason chips the real rules chose. A row in the wrong place
// in this preview is a real bug, not a fixture typo — which is the only way a
// preview of a QUEUE is worth looking at.
//
// The rows are deliberately one of each case, so every chip and every headline
// shape gets measured for contrast and tap size in one pass: a missed week, a
// badly off-target week, a clean-but-unanswered week, and a finished one.
//
// Development only. In production the route does not exist.

export const dynamic = 'force-dynamic';

function w(over: Partial<WorkoutAdherenceRow> & { date: string; name: string }): WorkoutAdherenceRow {
  return {
    completed: true,
    planned: {} as any,
    actual: { id: `act-${over.date}` } as any,
    distance: { status: 'on_target', plannedMin: 10000, plannedMax: 10000, actual: 10000, pct: 0 },
    duration: { status: 'on_target', planned: 3000, actual: 3000, pct: 0, estimated: false },
    pace: { status: 'on_target', plannedMin: 295, plannedMax: 305, comparedMin: 295, comparedMax: 305, actual: 300 },
    score: 1,
    ...over,
  };
}

/** A run at `actual` s/km against a 4:55–5:05 band. */
function paced(date: string, name: string, actual: number | null): WorkoutAdherenceRow {
  return w({
    date,
    name,
    pace: { status: 'on_target', plannedMin: 295, plannedMax: 305, comparedMin: 295, comparedMax: 305, actual },
  });
}

const missed = (date: string, name: string) => w({ date, name, completed: false, actual: null });

const REPORT: AcademyWeekReport = {
  weekStart: '2026-09-13',
  weekEnd: '2026-09-19',
  tolerances: DEFAULT_TOLERANCES,
  athletes: [
    {
      athleteId: 'a1',
      name: 'Noa Ben Ari',
      week: {
        plannedCount: 4, completedCount: 1, completionRate: 0.25, avgScore: 0.4,
        workouts: [
          missed('2026-09-14', 'ריצה קלה 8 ק״מ'),
          missed('2026-09-16', 'אינטרוולים 5×1000'),
          paced('2026-09-18', 'ריצה קלה 6 ק״מ', 302),
        ],
      },
    },
    {
      athleteId: 'a2',
      name: 'Yuval Shapira',
      week: {
        plannedCount: 3, completedCount: 3, completionRate: 1, avgScore: 0.6,
        workouts: [
          paced('2026-09-14', 'ריצה קלה 8 ק״מ', 271),
          paced('2026-09-16', 'אינטרוולים 5×1000 מ׳ בקצב מטרה', 268),
          paced('2026-09-18', 'ריצה ארוכה 16 ק״מ', 306),
        ],
      },
    },
    {
      athleteId: 'a3',
      name: 'Amit Levi',
      week: {
        plannedCount: 3, completedCount: 3, completionRate: 1, avgScore: 0.95,
        workouts: [
          paced('2026-09-14', 'ריצה קלה 8 ק״מ', 300),
          paced('2026-09-17', 'טמפו 6 ק״מ', 299),
          paced('2026-09-19', 'ריצה ארוכה 18 ק״מ', 301),
        ],
      },
    },
    {
      athleteId: 'a4',
      name: 'Dana Cohen',
      week: {
        plannedCount: 2, completedCount: 2, completionRate: 1, avgScore: 0.7,
        workouts: [
          paced('2026-09-15', 'אינטרוולים 8×400 מ׳', 288),
          paced('2026-09-18', 'ריצה קלה 7 ק״מ', 303),
        ],
      },
    },
  ],
};

// Dana's week is answered; Noa's late easy run is too, which is what makes her row
// a pure "החמצה" instead of a mix — the queue must not headline a session that has
// already been written up.
const REVIEWED = new Set(['a4|2026-09-15', 'a4|2026-09-18', 'a1|2026-09-18']);

export default function AcademyQueuePreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const week = buildQueue(REPORT, REVIEWED);

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[390px]">
        <header className="pt-2 pb-4">
          <h1 className="text-lg font-bold text-ink-900">תור המשוב השבועי</h1>
          <p className="mt-1 text-xs text-ink-400">
            תצוגה מקדימה בלי התחברות. הסדר אמיתי — הוא מחושב על ידי אותו קוד שמסדר את המסך.
          </p>
        </header>
        <QueueList week={week} />
      </div>
    </div>
  );
}

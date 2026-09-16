'use client';

import { notFound } from 'next/navigation';
import { israelToday } from '@/lib/utils';
import { buildInbox, type ThreadSnapshot } from '@/lib/academy/thread';
import { InboxList } from '@/components/academy/ThreadInbox';
import { ThreadTranscript, type ThreadMessage } from '@/components/academy/ThreadTranscript';

// ── Login-free preview of the three-way thread and its inbox ────────────────
//
// Both screens on one page because they are read one after the other: the manager
// scans the inbox, opens a thread, answers. Auditing them apart would miss that
// the chip vocabulary has to agree across the two.
//
// The inbox fixture goes through the REAL `buildInbox`, so the order below is the
// shipped order. That is the only way a preview of a ranked list is worth looking
// at — a row in the wrong place here is a bug, not a fixture typo.
//
// Development only. In production the route does not exist.

const DAY = 24 * 3_600_000;

/**
 * A fixture timestamp: an Israel wall-clock time, on a day counted back from today.
 *
 * Deterministic ON PURPOSE, and this cost a debugging session. The first version of
 * this file built its fixtures with `new Date(Date.now() - 3 * DAY)` at module
 * scope — which is evaluated ONCE on the server and AGAIN in the browser, so every
 * timestamp differed by however long the request took. The audit caught the thread
 * rendering 22:19 on the server and 22:26 on the client: a hydration mismatch that
 * makes React throw out the whole tree. A preview whose fixtures move cannot be
 * audited, and this is the one screen whose defects only the audit can see.
 *
 * Anchored on the Israel calendar day rather than a hard-coded date so "היום" and
 * "אתמול" still get exercised. The `+03:00` is IDT; in winter these render an hour
 * earlier, which is why every fixture below sits mid-day and not near midnight.
 */
function at(daysAgo: number, hhmm: string): string {
  const day = israelToday(new Date(Date.parse(israelToday()) - daysAgo * DAY));
  return new Date(`${day}T${hhmm}:00+03:00`).toISOString();
}

const SNAPSHOTS: ThreadSnapshot[] = [
  // Asked three days ago; the last staff word predates it. Top, and it should be.
  { athleteId: 'a3', name: 'Noa Ben Ari', lastTraineeMessageAt: at(3, '18:30'), lastStaffMessageAt: at(9, '20:00'), unreadCount: 2 },
  // Nobody has ever written in this thread. The strongest version of the problem.
  { athleteId: 'a5', name: 'Tamar Gold', lastTraineeMessageAt: null, lastStaffMessageAt: null, unreadCount: 0 },
  // Dead forty days. A recency-sorted list buries this one at the bottom.
  { athleteId: 'a4', name: 'Yuval Shapira', lastTraineeMessageAt: null, lastStaffMessageAt: at(40, '11:00'), unreadCount: 0 },
  // The loudest thread in the academy, and it needs nothing.
  { athleteId: 'a1', name: 'Amit Levi', lastTraineeMessageAt: null, lastStaffMessageAt: at(1, '21:00'), unreadCount: 12 },
  // Asked and was answered. Nothing owed.
  { athleteId: 'a2', name: 'Dana Cohen', lastTraineeMessageAt: at(1, '19:00'), lastStaffMessageAt: at(1, '20:00'), unreadCount: 0 },
];

const MESSAGES: ThreadMessage[] = [
  {
    id: 'm1',
    authorName: 'יוסי',
    seat: 'coach',
    text: 'נעה, שמתי לך את האינטרוולים למחר. 8×1000 בקצב 4:00, התאוששות 2 דקות.',
    at: at(9, '20:00'),
  },
  {
    id: 'm2',
    authorName: 'יוסי',
    seat: 'coach',
    text: '',
    at: at(8, '19:15'),
    // The weekly review, in the thread. Same card the trainee sees under the run.
    feedback: {
      type: 'academy_feedback',
      version: 1,
      workout_date: '2026-09-08',
      activity_id: null,
      workout_name: 'אינטרוולים 8×1000 מ׳',
      feedback: {
        execution: ['fast_start', 'faded'],
        effort: 'hard',
        action: 'ease_next',
        lapComments: [
          { index: 0, text: 'פתחת ב-3:48 במקום 4:00 — זה נראה קל בחזרה הראשונה וזה מה שגבה את המחיר בסוף.' },
        ],
        note: 'שבוע טוב בסך הכל. בפעם הבאה נתחיל בקצב שנקבע גם אם זה מרגיש איטי מדי.',
        sentAt: at(8, '19:15'),
        mentorName: 'יוסי',
      },
    },
  },
  {
    id: 'm3',
    authorName: 'נעה',
    seat: 'trainee',
    text: 'תודה. האמת שהרגשתי את זה בחזרה השישית, הרגליים נגמרו.',
    at: at(8, '21:40'),
  },
  {
    id: 'm4',
    authorName: 'אופר',
    seat: 'manager',
    text: 'נעה, ראיתי את השבוע שלך. את בכיוון טוב — תני לגוף את ההתאוששות שיוסי כתב.',
    at: at(4, '09:20'),
  },
  {
    id: 'm5',
    authorName: 'נעה',
    seat: 'trainee',
    text: 'שאלה — יש לי חתונה בחמישי ולא אספיק את האימון הארוך. אפשר להעביר אותו לשישי?',
    at: at(3, '18:30'),
  },
];

export default function AcademyThreadPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  const inbox = buildInbox(SNAPSHOTS);

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[390px] space-y-6">
        <section>
          <h1 className="text-lg font-bold text-ink-900">מה מחכה לי</h1>
          <p className="mb-3 mt-1 text-xs text-ink-400">
            חמש שיחות, מסודרות לפי מה שחייבים — לא לפי מי כתב אחרון. הסדר עבר דרך הדירוג האמיתי.
          </p>
          <InboxList inbox={inbox} />
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink-900">השיחה של נעה</h2>
          <p className="mb-3 mt-1 text-xs text-ink-400">
            מלווה, מתאמנת ומנהל אקדמיה באותו חוט. המשוב השבועי יושב בתוך השיחה, לא במסך נפרד.
          </p>
          <div className="rounded-card bg-card p-3">
            <ThreadTranscript
              messages={MESSAGES}
              viewerSeat="manager"
              onSend={() => {}}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-ink-500">אותה שיחה, ריקה</h2>
          <p className="mb-2 mt-1 text-[11px] text-ink-400">
            המצב של תמר: יש מלווה, יש מנהל, ואף אחד עוד לא פתח.
          </p>
          <div className="rounded-card bg-card p-3">
            <ThreadTranscript messages={[]} viewerSeat="coach" onSend={() => {}} />
          </div>
        </section>
      </div>
    </div>
  );
}

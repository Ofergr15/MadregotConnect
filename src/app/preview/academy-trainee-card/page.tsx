import { notFound } from 'next/navigation';
import { FeedbackCard, type TraineeFeedback } from '@/components/academy/FeedbackCard';

// ── Login-free preview of the trainee's feedback card ───────────────────────
//
// The real card sits under the accuracy ring on an activity the trainee owns, so
// seeing it needs a session, an academy trainee, a reviewed run, and a mentor who
// wrote it — four things, which is why it gets a preview like its three
// neighbours.
//
// Four cases, chosen to cover what the card has to survive rather than to look
// good: a full review, a one-line one, a session that went well, and the "צריך
// שיחה" action which is the only one that asks the trainee for something.
//
// Development only. In production the route does not exist.

export const dynamic = 'force-dynamic';

const FULL: TraineeFeedback = {
  execution: ['fast_start', 'faded', 'uneven'],
  effort: 'hard',
  action: 'ease_next',
  // `index` is the segment's own 0-based index and `lapLabel` adds the 1 — so a
  // comment about the FIRST rep is index 0. Getting this backwards in a fixture
  // prints "חזרה 2" over a sentence that says "the first rep", which is the kind of
  // half-degree error a preview exists to catch.
  lapComments: [
    { index: 0, text: 'פתחת ב-3:48 במקום 4:00 — זה נראה קל בחזרה הראשונה וזה מה שגבה את המחיר בסוף.' },
    { index: 7, text: 'כאן כבר ראיתי שאתה נלחם. סיימת, וזה מה שחשוב.' },
  ],
  note: 'שבוע טוב בסך הכל. בפעם הבאה נתחיל את החזרה הראשונה בקצב שנקבע גם אם זה מרגיש איטי מדי — הקצב הזה נבנה כדי שתסיים חזק.',
  sentAt: new Date().toISOString(),
  mentorName: 'יוסי',
};

const MINIMAL: TraineeFeedback = {
  execution: ['on_plan'],
  effort: null,
  action: 'keep',
  lapComments: [],
  note: '',
  sentAt: new Date(Date.now() - 86400000).toISOString(),
  mentorName: 'יוסי',
};

const STRONG: TraineeFeedback = {
  execution: ['on_plan', 'strong_finish'],
  effort: 'right',
  action: 'push_next',
  lapComments: [{ index: 7, text: 'החזרה הכי מהירה שלך הייתה האחרונה. זה בדיוק מה שרצינו לראות.' }],
  note: '',
  sentAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  mentorName: 'יוסי',
};

const TALK: TraineeFeedback = {
  execution: ['too_slow', 'hr_high'],
  effort: 'too_hard',
  action: 'needs_talk',
  lapComments: [],
  note: 'הדופק היה גבוה מהרגיל בקצב איטי יותר מהרגיל. זה לא נראה כמו אימון גרוע, זה נראה כמו גוף עייף.',
  sentAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  mentorName: 'יוסי',
};

const CASES: Array<{ title: string; note: string; fb: TraineeFeedback }> = [
  { title: 'משוב מלא', note: 'שלושה תגים, שתי הערות על חזרות, והערה חופשית.', fb: FULL },
  { title: 'משוב קצר', note: 'האימון בוצע לפי התוכנית ואין מה להוסיף — גם זה משוב.', fb: MINIMAL },
  { title: 'אימון טוב', note: 'שבח הוא התג הירוק היחיד, וההחלטה היא להעלות רמה.', fb: STRONG },
  { title: 'צריך שיחה', note: 'הפעולה היחידה שמבקשת משהו מהמתאמן. גם היא לא אדומה.', fb: TALK },
];

export default function TraineeCardPreview() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-page px-3 py-4" dir="rtl">
      <div className="mx-auto max-w-[390px] space-y-5">
        <header className="pt-2">
          <h1 className="text-lg font-bold text-ink-900">המשוב כפי שהמתאמן רואה אותו</h1>
          <p className="mt-1 text-xs text-ink-400">
            תצוגה מקדימה בלי התחברות. במסך האמיתי הכרטיס יושב מתחת לטבעת הדיוק של אותה ריצה.
          </p>
        </header>
        {CASES.map(c => (
          <section key={c.title}>
            <h2 className="mb-1.5 text-xs font-bold text-ink-500">{c.title}</h2>
            <p className="mb-2 text-[11px] text-ink-400">{c.note}</p>
            <FeedbackCard feedback={c.fb} workoutName="אינטרוולים 8×1000 מ׳" />
          </section>
        ))}
      </div>
    </div>
  );
}

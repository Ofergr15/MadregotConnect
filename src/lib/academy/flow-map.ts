/**
 * The academy's real process, and where each step of it now lives in the app.
 *
 * This is the front door to everything built on `feat/academy-weekly-feedback`: fifteen steps as
 * Ofer described them, each carrying the screen that serves it and the question still open about
 * it. Until now the branch was nineteen preview routes with no index, so seeing the flow meant
 * knowing the URLs.
 *
 * ── WHY THE DATA IS A MODULE AND NOT JSX ──────────────────────────────────────────────────
 *
 * Every `href` here is a claim that a route exists, and a walkthrough that links a screen which
 * was renamed or deleted is worse than no walkthrough — it says the flow is complete when a piece
 * of it is gone. `academyFlowMap.test.ts` resolves each one against the filesystem, which is only
 * possible because the hrefs are data rather than attributes buried in markup.
 *
 * ── WHAT `state` MEANS, AND WHY `outsideApp` IS NOT A GAP ─────────────────────────────────
 *
 * Nine of the fifteen steps were already handled or deliberately stay out of the app: Yossi's
 * phone call is a selling point, and GO holds the money. Marking those `outsideApp` is the honest
 * shape of the flow. A walkthrough that showed them as missing features would invite building
 * things nobody asked for, and would hide how much of the process the app really does cover.
 *
 * Every Hebrew string here is UI copy.
 */

/** Whether the app serves this step, shares it, or deliberately leaves it alone. */
export type StepState =
  /** A screen in the app does this now. */
  | 'inApp'
  /** Part of it is in the app, the rest stays where it was. */
  | 'partly'
  /** By design: another tool or a human owns this, and should. */
  | 'outsideApp';

export interface StepScreen {
  label: string;
  href: string;
  /** `preview` is login-free and dev-only; `app` needs staff and real data. */
  kind: 'preview' | 'app';
}

export interface FlowStep {
  /** 1–15, in the order the process happens. */
  n: number;
  title: string;
  /** Who does this step. */
  owner: string;
  /** What it runs on today, before any of this branch is merged. */
  today: string;
  state: StepState;
  /** What changed for this step, in one sentence. Empty for the untouched ones. */
  built: string;
  screens: StepScreen[];
  /** Decisions waiting on Ofer that would change THIS step. */
  questions: string[];
  /**
   * Parked by Ofer: built, but not on the table now and not to be discussed now.
   *
   * Kept as a flag rather than by deleting the step, because the step is still part of the
   * process — the app simply is not the place it is being decided. Deleting it would make the
   * walkthrough describe a fourteen-step flow, and re-deriving what was already built when it is
   * unparked is the expensive way to save a line of data.
   */
  deferred?: boolean;
}

export const FLOW_STEPS: FlowStep[] = [
  {
    n: 1,
    title: 'פנייה באינסטגרם',
    owner: 'יוסי',
    today: 'אינסטגרם · מענה אוטומטי',
    state: 'outsideApp',
    built: '',
    screens: [],
    questions: [],
  },
  {
    n: 2,
    title: 'מילוי טופס הרשמה',
    owner: 'המועמד',
    today: 'טופס חיצוני',
    state: 'partly',
    // The club's own registration page predates the academy work; a candidate can also be added
    // by hand, which is what an Instagram DM actually is.
    built: 'מועמד נכנס ללוח בין אם הגיע מטופס ובין אם יוסי הוסיף אותו ביד.',
    screens: [
      { label: 'לוח המועמדים', href: '/preview/academy-funnel', kind: 'preview' },
      { label: 'בפועל', href: '/dashboard/academy?tab=funnel', kind: 'app' },
    ],
    questions: [],
  },
  {
    n: 3,
    title: 'שיחת היכרות',
    owner: 'יוסי',
    today: 'טלפון',
    // The instant human answer from the business owner is a selling point. The app records that it
    // happened; it does not try to replace it.
    state: 'partly',
    built: 'השיחה מסומנת על כרטיס המועמד, והלוח אומר מי תקוע ואצל מי.',
    screens: [{ label: 'כרטיס מועמד', href: '/preview/academy-funnel?card=1', kind: 'preview' }],
    questions: [],
  },
  {
    n: 4,
    title: 'שיחת אפיון מקצועית',
    owner: 'אופר',
    today: 'טלפון · בלי תיעוד',
    state: 'inApp',
    built: 'טופס אפיון שנשמר תוך כדי השיחה, והתשובות שלו מגיעות עכשיו ללוח כתיבת התוכנית.',
    screens: [
      { label: 'טופס האפיון', href: '/preview/academy-characterization', kind: 'preview' },
      { label: 'איפה זה מופיע בתוכנית', href: '/preview/academy-composer-book', kind: 'preview' },
    ],
    questions: [],
  },
  {
    n: 5,
    title: 'הרשמה לפלטפורמה',
    owner: 'המתאמן',
    today: 'Caliber',
    state: 'partly',
    built: 'חיבור המועמד לחשבון שנפתח, כדי שהתשובות מהשיחה ישרדו את המעבר.',
    screens: [{ label: 'חיבור לחשבון', href: '/preview/academy-link', kind: 'preview' }],
    questions: ['האם Caliber מוחלף או חי לצד המערכת — הפיצול הגדול ביותר בדרך.'],
  },
  {
    n: 6,
    title: 'תיאום טסט 30 דקות',
    owner: 'אופר',
    today: 'WhatsApp',
    state: 'inApp',
    built: 'הזמנה לטסט עם תזכורת כפולה, שנסגרת מעצמה ברגע שנשמרה תוצאה.',
    screens: [
      { label: 'לוח ההזמנות', href: '/preview/academy-test-board', kind: 'preview' },
      { label: 'מה המתאמן רואה', href: '/preview/academy-scheduled-test', kind: 'preview' },
    ],
    questions: ['האם הטסט הוא פרוטוקול קבוע — זה מה שקובע אם גזירת הסף אוטומטית או טיוטה.'],
  },
  {
    n: 7,
    title: 'ביצוע הטסט וסנכרון',
    owner: 'המתאמן · השעון',
    today: 'Garmin · סנכרון אוטומטי',
    state: 'inApp',
    built: 'המתאמן מזין את התוצאה, המאמן מאשר — ושום קצב לא משתנה לפני האישור.',
    screens: [
      { label: 'הצד של הספורטאי', href: '/preview/academy-tests-mine', kind: 'preview' },
      { label: 'ממתין לאישור', href: '/preview/academy-tests-pending', kind: 'preview' },
    ],
    questions: [],
  },
  {
    n: 8,
    title: 'ניתוח הטסט וכתיבת סיכום',
    owner: 'אופר',
    today: 'Excel · WhatsApp',
    state: 'inApp',
    built: 'ספי אימון מחושבים, המלצת דבוקה, והסיכום המאושר נשלח למתאמן עצמו.',
    screens: [
      { label: 'ניתוח טסט', href: '/preview/academy-analysis', kind: 'preview' },
      { label: 'שיפור ומגמות', href: '/preview/academy-tests', kind: 'preview' },
    ],
    questions: [
      'הטבלה שלך (1500 מ׳ → מרתון, אחוזי דופק) — היא מחליפה את המקדמים שניחשתי.',
      'קצב הסף של כל דבוקה, אחרת המלצת הדבוקה שותקת במקום לנחש.',
    ],
  },
  {
    n: 9,
    title: 'שיבוץ דבוקה או אימון אישי',
    owner: 'אופר',
    today: 'שיקול דעת',
    state: 'inApp',
    built: 'המלצה בלבד, לצד הנתון שעליו היא מתבססת — ההחלטה נשארת שלך.',
    screens: [
      { label: 'המלצת שיבוץ', href: '/preview/academy-analysis', kind: 'preview' },
      { label: 'שיפור ומגמות', href: '/preview/academy-tests', kind: 'preview' },
    ],
    questions: [],
  },
  {
    n: 10,
    title: 'קבוצת WhatsApp עם המלווה',
    owner: 'אופר',
    today: 'WhatsApp',
    state: 'inApp',
    built: 'צ׳אט משולש בתוך המערכת — מתאמן, מלווה ומנהל האקדמיה באותו חוט.',
    screens: [
      { label: 'החוט', href: '/preview/academy-thread', kind: 'preview' },
      { label: 'בפועל', href: '/dashboard/academy?tab=threads', kind: 'app' },
    ],
    questions: ['האם לומר למתאמן במפורש שמנהל האקדמיה נמצא בחוט (כרגע שלושתם מוצגים בגלוי).'],
  },
  {
    n: 11,
    title: 'כתיבת התוכנית הראשונה',
    owner: 'אופר',
    today: 'Caliber · דף חלק',
    state: 'inApp',
    built: 'ספר אימונים לפי אחוז מהסף, ולוח שבועי שמראה מה השיחה אמרה לפני השליחה.',
    screens: [
      { label: 'ספר האימונים', href: '/preview/academy-book', kind: 'preview' },
      { label: 'אימון חדש', href: '/preview/academy-book-editor', kind: 'preview' },
      { label: 'לוח השבוע', href: '/preview/academy-composer-book', kind: 'preview' },
    ],
    questions: [
      'שתי ספריות אימונים חיות זו לצד זו — אחת בקצבים מוחלטים ואחת באחוזים. איזו נשארת.',
      'אחוזי האזורים (קל, טמפו, אינטרוולים) הם ניחוש שלי עד שתיתן את שלך.',
    ],
  },
  {
    n: 12,
    title: 'שליחה לשעונים',
    owner: 'אופר',
    today: 'Garmin Connect',
    state: 'inApp',
    built: 'שליחה לכל השבוע, אימות מול השעון, והודעה למתאמן כשהשעון הוא הסיבה שאין לו אימון.',
    screens: [
      { label: 'שליחה לשעונים', href: '/preview/academy-dispatch', kind: 'preview' },
      { label: 'בפועל', href: '/dashboard/academy?tab=dispatch', kind: 'app' },
    ],
    questions: [],
  },
  {
    n: 13,
    title: 'קבוצת האקדמיה הכללית',
    owner: 'אופר',
    today: 'WhatsApp · לוח אירועים',
    state: 'outsideApp',
    built: '',
    screens: [],
    questions: [],
  },
  {
    n: 14,
    title: 'הוראת קבע ותשלום',
    owner: 'המתאמן · אופר',
    today: 'GO · Excel',
    // GO issues the link and holds the standing order. What the app keeps is the STATUS, because
    // that is the part that sat in a spreadsheet beside a roster that moved without it.
    state: 'partly',
    // Parked 2026-09-20: "כל האיזור של התשלומים תשאיר בתור — יפתח בעתיד, כרגע לא רלוונטי".
    // The screens stay openable, because they are built and green; nothing more gets built on
    // them and the four money questions are off the agenda until Ofer opens this again.
    deferred: true,
    built: 'מצב תשלום מול מצב אימון, ומי מאומן בחינם. הכסף עצמו נשאר ב-GO.',
    screens: [
      { label: 'לוח התשלומים', href: '/preview/academy-payments', kind: 'preview' },
      { label: 'בפועל', href: '/dashboard/academy?tab=payments', kind: 'app' },
    ],
    questions: [
      'האם מייל מ-GO נקרא אוטומטית, או שאתה מסמן בלחיצה.',
      'האם המערכת אמורה לשלוח תזכורת תשלום בעצמה. כרגע היא רק מכינה טקסט להעתקה.',
      'חלק השותפים — אחוז או סכום קבוע.',
      'מה משולם לכל מלווה ולפי איזה מודל, ומה המחיר החודשי האמיתי של כל מתאמן.',
    ],
  },
  {
    n: 15,
    title: 'הלופ השבועי — משוב המלווה',
    owner: 'המלווה · אופר',
    today: 'WhatsApp · טקסט חופשי',
    state: 'inApp',
    built: 'תור שבועי, טופס משוב אחיד, השוואת תוכנית מול ביצוע עם כיוון, והמשוב נכנס לחוט.',
    screens: [
      { label: 'תור המשוב', href: '/preview/academy-queue', kind: 'preview' },
      { label: 'מסך הפידבק', href: '/preview/academy-feedback', kind: 'preview' },
      { label: 'מה המתאמן מקבל', href: '/preview/academy-trainee-card', kind: 'preview' },
    ],
    questions: ['מה נחשב "אימון מפתח" ומה נחשב חריגה — בניסוח שלך.'],
  },
];

/**
 * The decisions that are not about one step.
 *
 * Kept apart on purpose: attaching "which numbers are guesses" to a single step would bury it,
 * and these are the ones that change how the whole thing behaves.
 *
 * One item LEFT this list rather than being answered by Ofer: "type 6.42 instead of 6420 and see
 * that the warning appears and the save stays open". It was here because the rule was unit-tested
 * while the rendered consequence was not, and only a browser can settle that. It is now asserted
 * in the UI audit harness (`academy-test-entry` / `-units`), verified in both directions, so it is
 * a test and not a decision. A question anyone can close without Ofer does not belong here.
 */
export const CROSS_CUTTING_QUESTIONS: string[] = [
  'כל המספרים שניחשתי מסומנים במקום אחד בכל קובץ, ומחכים למספרים שלך.',
  'רק ספורטאי אחד מסומן כאקדמיה, כך שכל מה שקורה לכמה אנשים נבדק מול נתוני דמה בלבד.',
  'שתי התזכורות לטסט נשלחות מעצמן מעכשיו. אף אחת לא יצאה עוד לטלפון אמיתי, כי אין הזמנה אמיתית — יצירת הראשונה היא שלך.',
];

export interface FlowCounts {
  steps: number;
  inApp: number;
  partly: number;
  outsideApp: number;
  /** How many steps still carry a decision. Parked steps do not count. */
  withQuestions: number;
  /** Decisions open FOR NOW: the parked steps' questions are not among them. */
  questions: number;
  /** Questions on parked steps, counted separately so nothing is silently lost. */
  deferredQuestions: number;
}

export function flowCounts(steps: FlowStep[] = FLOW_STEPS): FlowCounts {
  return {
    steps: steps.length,
    inApp: steps.filter(s => s.state === 'inApp').length,
    partly: steps.filter(s => s.state === 'partly').length,
    outsideApp: steps.filter(s => s.state === 'outsideApp').length,
    withQuestions: steps.filter(s => s.questions.length > 0 && !s.deferred).length,
    // The cross-cutting ones are counted too: the header number is "how many decisions are open",
    // and a total that silently dropped four of them would be the wrong number to act on.
    //
    // A parked step's questions are the one exception, and they get their own number rather than
    // vanishing: putting a decision Ofer has explicitly postponed into the count of what he has
    // to decide now is how a list of open questions stops being read.
    questions: steps.filter(s => !s.deferred).reduce((n, s) => n + s.questions.length, 0)
      + CROSS_CUTTING_QUESTIONS.length,
    deferredQuestions: steps.filter(s => s.deferred).reduce((n, s) => n + s.questions.length, 0),
  };
}

/** Every distinct screen the walkthrough links, for the test that resolves them against the repo. */
export function allScreens(steps: FlowStep[] = FLOW_STEPS): StepScreen[] {
  const seen = new Map<string, StepScreen>();
  for (const step of steps) for (const screen of step.screens) if (!seen.has(screen.href)) seen.set(screen.href, screen);
  return [...seen.values()];
}

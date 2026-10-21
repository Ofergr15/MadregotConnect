import type { TourDef } from './engine';

// The coach tour, as approved (mockups/coach-intro/v2.html): two minutes, six steps, and it
// ends with a first workout written and "sent" — a practice one that reaches nobody
// (practice.ts). Steps 2, 3 and 6 are "do": the coach taps the real control.
export const COACH_TOUR: TourDef = {
  id: 'coach',
  name: 'סיור מאמן',
  opening: {
    emoji: '👋',
    title: 'ברוך הבא לאזור המאמן',
    body: 'בשתי דקות נכתוב ונשלח יחד אימון ראשון — תרגול, לא יגיע לאף אחד. אחרי זה תדע הכול.',
    points: ['📋 מה מחכה לך כל יום', '✍️ לכתוב אימון כמו בווטסאפ', '⌚ לשלוח לשעון ולראות שהגיע'],
    cta: 'בוא נתחיל · 2 דקות',
    secondary: 'אחר כך — הסיור נשאר ב״עוד״',
  },
  closing: {
    emoji: '🎉',
    title: 'כתבת ושלחת אימון ראשון',
    body: '(בתרגול — לא נשלח לאף אחד)',
    points: ['מחכה לך — מתחילים כאן כל בוקר', 'יום + טקסט — כותבים אימון בדקה', 'שליחה — ואז ״בשעון ✓״ מאשר שהגיע'],
    note: 'עוד דברים יופיעו כנקודה כחולה כשתגיע אליהם: ספר האימונים, שבוע שלם מהקבוצה, קצבים.',
    cta: 'למתאמנים שלי',
    secondary: 'לחזור לסיור: עוד ← ״סיור מאמן״',
  },
  steps: [
    {
      id: 'waiting', kind: 'see', target: 'coach-waiting|coach-trainees', title: 'מה מחכה לך',
      body: 'כל מה שצריך ממך היום בשורה אחת — מי מחכה לתשובה, למי חסרה תוכנית, מי לא נכנס. הכפתור הכחול בשורה עושה את הפעולה.',
    },
    {
      id: 'trainee', kind: 'do', target: 'coach-trainee', title: 'בואו נכתוב למתאמן',
      body: 'לחצו על מתאמן — נפתח את השבוע שלו.',
    },
    {
      id: 'day', kind: 'do', target: 'week-add-day', title: 'בוחרים יום',
      body: 'זה השבוע של המתאמן. לחצו על יום פנוי — נכתוב לו אימון.',
    },
    {
      id: 'text', kind: 'see', target: 'quick-text', title: 'כותבים כמו בווטסאפ', next: 'הבנתי, הבא',
      body: 'במילים שלכם: ״חימום 15 דק׳, 5×1 ק״מ ב־3:55, שחרור 10״. מתחת רואים מיד איך זה ייראה בשעון.',
    },
    {
      id: 'menu', kind: 'see', target: 'step-menu', title: 'מתקנים כל שלב',
      body: 'כל מספר כחול — נגיעה ומשנים. ״⋯״ פותח: סוג, מרחק או זמן, טווח קצב, הזזה, שכפול ומחיקה.',
    },
    {
      id: 'send', kind: 'do', target: 'day-send', title: 'שולחים לשעון',
      body: 'לחצו על השליחה. בתרגול — לא יישלח באמת. בפעם הבאה זה יגיע לשעון של המתאמן, ותראו ״בשעון ✓״.',
    },
  ],
};

/** The practice run's stand-in threshold (4:30/km) for a trainee with no test or basis yet. */
export const PRACTICE_THRESHOLD_SEC = 270;

/** What the "✨ הקלד בשבילי דוגמה" button types into the quick text box. */
export const SAMPLE_WORKOUT = 'חימום 15 דק׳, 5×1 ק״מ ב־3:55 מנוחה 2 דק׳, שחרור 10';

export const TOURS: Record<string, TourDef> = { coach: COACH_TOUR };

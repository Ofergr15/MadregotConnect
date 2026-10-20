/**
 * The hand-test flows — ONE source for both the staff "בדיקות הרשמה" screen
 * (/dashboard/tests) and the quick-test document, so the two can never disagree. Every
 * step is what Ofer does on his iPhone, with the exact button text read from the real
 * screens (walked on 2026-10-21), the values to paste, what should arrive, and where to
 * look. The live status of each step comes from lib/testing/status. Pure.
 */

export type FlowId = 'club' | 'academy' | 'movein' | 'import';

/** Every address is a +tag of the super user's own Gmail: his inbox, separate accounts. */
export const TEST_EMAILS: Record<FlowId, string> = {
  club: 'grosfeldofer+club20@gmail.com',
  academy: 'grosfeldofer+academy20@gmail.com',
  movein: 'grosfeldofer+movein20@gmail.com',
  import: 'grosfeldofer+import20@gmail.com',
};
export const TEST_EMAIL_LIST = Object.values(TEST_EMAILS);
export const isTestEmail = (e: string | null | undefined) => !!e && TEST_EMAIL_LIST.includes(e.trim().toLowerCase());

export interface CopyValue { label: string; value: string }
export type Where = 'פרטי' | 'האפליקציה שלך' | 'Gmail' | 'אוטומטי';
export interface FlowStepDef {
  /** The fact that proves this step happened — see lib/testing/status. */
  key: string;
  title: string;
  where: Where;
  /** What to do, in order, with the button text exactly as on the screen. */
  do: string[];
  values?: CopyValue[];
  /** What should arrive or show (mail subject, push text, screen title). */
  expect?: string;
  /** Where to check it. */
  look?: string;
  /** Screenshots of this step in the quick-test document (/tmp capture ids). */
  shots?: string[];
}
export interface FlowDef { id: FlowId; title: string; goal: string; email: string; stuck: string[]; steps: FlowStepDef[] }

const BASE = 'www.madregot.app';
const SCREEN = 'מסך "בדיקות הרשמה" (ניהול)';

export const FLOWS: FlowDef[] = [
  {
    id: 'club',
    title: '1 · הרשמה למועדון',
    goal: 'מי שנרשם מבחוץ מגיע אליך, מאושר, נכנס עם קוד במייל (בלי Strava) ומסיים את ההגדרה.',
    email: TEST_EMAILS.club,
    stuck: ['מייל לא הגיע — בדקו בספאם, ובמסך הבדיקות אם נשלח ולאיזו כתובת', 'טעות בכתובת — במסך הבדיקות יופיע "לתקן ל־…"', 'נתקעת בהגדרה — צילום מסך של השלב'],
    steps: [
      {
        key: 'signup', title: 'נרשמים', where: 'פרטי',
        do: ['Safari ← כרטיסיות ← פרטי ← +', `פותחים ${BASE}/register`, 'מסמנים "🏃 המועדון" ← "המשך"', '"כמה פרטים": ממלאים ← "אינסטגרם" ← "המשך"', '"מה הזמן שלך במרתון?": מקלידים ספרות בלבד ← "המשך"', '"באיזו דבוקה?": בודקים שכתוב "דבוקה 2 · מומלץ" ושהמייל נכון ← "שליחה"'],
        values: [{ label: 'שם פרטי', value: 'Test' }, { label: 'שם משפחה', value: 'Club' }, { label: 'אימייל', value: TEST_EMAILS.club }, { label: 'נייד', value: '0500000001' }, { label: 'זמן מרתון', value: '23400' }, { label: 'איפה', value: 'מרתון תל אביב' }, { label: 'שנה', value: '2026' }],
        expect: 'מסך "קיבלנו, Test 🙌"', look: 'בכרטיסייה הפרטית', shots: ['c01-path', 'c02-details', 'c03-marathon', 'c04-pack', 'c05-sent'],
      },
      { key: 'received_mail', title: 'מייל "קיבלנו" נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "קיבלנו את הבקשה שלכם, Test 🏃"', look: `Gmail · ${SCREEN}` },
      { key: 'staff_alert', title: 'התראה לצוות על בקשה חדשה', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'התראה "👋 בקשת הרשמה חדשה" · "Test Club · …" — לחשבון שלך וגם ל־Madregot Admin', look: `התראה בטלפון · ${SCREEN}` },
      { key: 'approved', title: 'מאשרים', where: 'האפליקציה שלך', do: [`פותחים ${BASE}/dashboard/entry-queue`, 'הכרטיס "Test Club": כתוב "ביקש/ה דבוקה 2 — כבר מסומן" ← "אשר ושלח קישור"'], look: SCREEN, shots: ['c06-approve'] },
      { key: 'approved_mail', title: 'מייל "ההרשמה אושרה" נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "✅ ההרשמה אושרה! ככה נכנסים לאפליקציה של מדרגות" · כפתור "להתחלה ←"', look: `Gmail · ${SCREEN}` },
      {
        key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי',
        do: ['ב־Gmail: לחיצה ארוכה על "להתחלה ←" ← העתקת קישור ← מדביקים בכרטיסייה הפרטית', '"ברוכים הבאים, Test 🎉" ← "הכול נכון, ממשיכים"', '"כניסה עם קוד במייל — בלי Strava"', '"שלחו לי קוד" ← מקלידים את 6 הספרות מהמייל ← "כניסה"'],
        expect: 'מייל "XXXXXX הוא קוד הכניסה שלכם למדרגות"', look: `Gmail · ${SCREEN}`, shots: ['c07-join', 'c08-connect', 'c09-welcome', 'c10-code'],
      },
      {
        key: 'setup_done', title: 'מסיימים את ההגדרה', where: 'פרטי',
        do: ['"לא מצליחים להתקין? ממשיכים בדפדפן"', '"מחברים את Garmin" ← "אין לי Garmin — ממשיכים"', '"עוד 7 פרטים": תאריך לידה, גובה, נעליים 43, שלוש פעמים M, גרביים 43-46 ← "שמירה"', '"הכל מוכן" ← "לאפליקציה"'],
        values: [{ label: 'תאריך לידה', value: '01/01/1990' }, { label: 'גובה', value: '178' }],
        expect: 'הפיד נפתח', look: SCREEN, shots: ['c11-install', 'c12-watch', 'c14-details-filled', 'c15-done'],
      },
      { key: 'member', title: 'חבר מועדון בדבוקה 2', where: 'אוטומטי', do: ['נבדק לבד'], look: SCREEN },
    ],
  },
  {
    id: 'academy',
    title: '2 · מועמד חדש לאקדמיה',
    goal: 'מועמד מבחוץ ממלא את הטופס, מגיע למועמדים, מתקבל עם מאמן, ומקבל מייל "התקבלת".',
    email: TEST_EMAILS.academy,
    stuck: ['הכרטיס לא מופיע במועמדים — רעננו את האקדמיה', 'מייל "התקבלת" לא הגיע — במסך הבדיקות אם נשלח'],
    steps: [
      {
        key: 'applied', title: 'ממלאים את טופס האקדמיה', where: 'פרטי',
        do: [`כרטיסייה פרטית חדשה ← ${BASE}/register`, 'מסמנים "🎯 האקדמיה" ← "המשך"', '"כמה פרטים": ממלאים ← "אינסטגרם" ← "המשך"', '"הפרטים שלך": "שילוב של תכנית און ליין עם מפגשים פיזיים" ← "המשך"', '"קצת עליך": תאריך לידה 1 / ינואר / 1990, משקל, גובה, מקום מגורים ← "המשך"', '"הריצה שלך": כותבים רקע, "6 מרתון מלא בכל תוצאה", "אינסטגרם" ← "המשך"', '"בריאות": "בריא לחלוטין" ← "לשלוח"'],
        values: [{ label: 'שם פרטי', value: 'Test' }, { label: 'שם משפחה', value: 'Academy' }, { label: 'אימייל', value: TEST_EMAILS.academy }, { label: 'נייד', value: '0500000002' }, { label: 'משקל', value: '72' }, { label: 'גובה', value: '178' }, { label: 'מקום מגורים', value: 'Tel Aviv' }, { label: 'רקע', value: 'בדיקה — 3 ריצות בשבוע' }],
        expect: 'מסך "קיבלנו, Test 🙌"', look: 'בכרטיסייה הפרטית', shots: ['f2-03-form1', 'f2-04-form2', 'f2-05-form3', 'f2-06-form4', 'f2-07-sent'],
      },
      { key: 'applicant_alert', title: 'התראה לצוות על מועמד', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'התראה "🎓 מועמד חדש לאקדמיה" · "Test Academy · …" — לאלדר ולך', look: `התראה בטלפון · ${SCREEN}` },
      { key: 'accepted', title: 'מקבלים לאקדמיה', where: 'האפליקציה שלך', do: ['אקדמיה ← "אנשים" ← "מועמדים" ← Test Academy', '"לקבל לאקדמיה" ← מסמנים רק את Sahar Azar ← "קבלה ושליחה"'], look: SCREEN, shots: ['f2-20-card', 'f2-21-accept'] },
      { key: 'accepted_mail', title: 'מייל "התקבלת" נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "🎉 התקבלת לאקדמיה של מדרגות — ככה נכנסים לאפליקציה"', look: `Gmail · ${SCREEN}`, shots: ['e-academy_accepted'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל (לחיצה ארוכה ← העתקה ← כרטיסייה פרטית) ← "הכול נכון, ממשיכים" ← "כניסה עם קוד במייל — בלי Strava" ← "שלחו לי קוד"'], look: SCREEN },
      { key: 'coach_linked', title: 'משובץ למאמן', where: 'אוטומטי', do: ['נבדק לבד'], look: SCREEN },
    ],
  },
  {
    id: 'movein',
    title: '3 · מתאמן קיים ("כבר מתאמנים")',
    goal: 'מתאמן שכבר אצלנו מקבל טופס של עמוד אחד, מאושר, ומקבל מייל עם הקישור לאפליקציה.',
    email: TEST_EMAILS.movein,
    stuck: ['"לשלוח לTest טופס פרטים" לא נלחץ — חסר מייל או מאמן', 'הטופס נפתח ריק — הקישור פג או הועתק חלקית'],
    steps: [
      {
        key: 'invited', title: 'שולחים טופס', where: 'האפליקציה שלך',
        do: ['אקדמיה ← "בית" ← "מתאמן"', '"כבר מתאמנים" ← "עוד לא באפליקציה"', 'ממלאים שם, מייל, טלפון', '"מאמנים בלי שיבוץ" ← Sahar Azar', '"לשלוח לTest טופס פרטים"'],
        values: [{ label: 'שם', value: 'Test Movein' }, { label: 'מייל', value: TEST_EMAILS.movein }, { label: 'טלפון', value: '0500000003' }],
        look: SCREEN, shots: ['f3-01-academy', 'f3-02-add', 'f3-05-filled'],
      },
      { key: 'form_mail', title: 'מייל הטופס נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "🎓 Test, האקדמיה עוברת לאפליקציה — נשאר רק למלא פרטים"', look: `Gmail · ${SCREEN}`, shots: ['e-academy_existing_form'] },
      { key: 'form_filled', title: 'ממלאים את הטופס', where: 'פרטי', do: ['הקישור מהמייל ← "כמה פרטים, ואתה באפליקציה" (השם, המייל והטלפון כבר ממולאים)', '"בריא לחלוטין" ← "אינסטגרם" ← "לשלוח"'], expect: 'מסך "תודה, Test! 🙌"', look: 'בכרטיסייה הפרטית', shots: ['f3-10-form', 'f3-11-filled', 'f3-12-sent'] },
      { key: 'accepted', title: 'מאשרים', where: 'האפליקציה שלך', do: ['התראה "📋 Test Movein מילא/ה את הטופס" ← הכרטיס', 'או: אקדמיה ← "אנשים" ← "מועמדים" ← Test Movein', '"לקבל לאקדמיה" ← Sahar Azar ← "קבלה ושליחה"'], look: SCREEN, shots: ['f3-20-card', 'f3-21-accept'] },
      { key: 'install_mail', title: 'מייל "הכל מוכן" נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "✅ Test, הכל מוכן — ככה נכנסים לאפליקציה" · כפתור "להתחלה ←"', look: `Gmail · ${SCREEN}`, shots: ['e-academy_move_in'] },
      { key: 'coach_setup', title: 'המאמן קיבל "טופס התאמה"', where: 'אוטומטי', do: ['נבדק לבד (התראה לסהר)'], look: SCREEN },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל ← "הכול נכון, ממשיכים" ← "כניסה עם קוד במייל — בלי Strava" ← "שלחו לי קוד"'], look: SCREEN },
      { key: 'baseline', title: 'בסיס קצב נקבע', where: 'האפליקציה שלך', do: ['אקדמיה ← Test Movein ← "טופס התאמה" ← "בסיס קצב": 10 ק״מ, מקלידים 4200 (42:00) ← שמירה'], look: SCREEN },
    ],
  },
  {
    id: 'import',
    title: '4 · מתאמן מהקובץ',
    goal: 'כרטיס מהקובץ מוזמן, המתאמן מאשר פרטים שכבר ממולאים, ומקבל מייל התקנה בלי אישור נוסף.',
    email: TEST_EMAILS.import,
    stuck: ['לא ללחוץ "בחירה מהירה" — זה מסמן מתאמנים אמיתיים', 'Test Import לא ברשימה — ליצור אותו קודם במסך הבדיקות'],
    steps: [
      { key: 'card', title: 'כרטיס בדיקה קיים', where: 'האפליקציה שלך', do: [`${SCREEN} ← בדיקה 4 ← "ליצור כרטיס בדיקה מהקובץ"`], look: SCREEN },
      { key: 'invited', title: 'מזמינים', where: 'האפליקציה שלך', do: ['אקדמיה ← "אנשים" ← "מעבר לאפליקציה"', '"מי מוזמן": לא נוגעים ב"בחירה מהירה" — מסמנים רק את "Test Import"', '"שליחת הזמנה ל־ 1 נבחרים" ← "לשלוח הזמנה ל־1?" ← "שליחה"'], look: SCREEN, shots: ['f4-01-import', 'f4-02-picked', 'f4-03-confirm'] },
      { key: 'form_mail', title: 'מייל "הפרטים שלך" נשלח', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "🎓 Test, האקדמיה עוברת לאפליקציה — נשאר רק למלא פרטים"', look: `Gmail · ${SCREEN}`, shots: ['e-academy_existing_form'] },
      { key: 'confirmed', title: 'מאשרים את הפרטים', where: 'פרטי', do: ['הקישור מהמייל ← "הפרטים שלך" (הכל ממולא מהקובץ)', 'תאריך לידה 1 / ינואר / 1990 ← "גבר" ← בריאות "כן" ← "לשלוח"'], expect: 'מסך "תודה, Test! 🙌" · "הפרטים אושרו"', look: 'בכרטיסייה הפרטית', shots: ['f4-10-form', 'f4-11-filled', 'f4-12-sent'] },
      { key: 'install_mail', title: 'מייל "הכל מוכן" נשלח (בלי אישור נוסף)', where: 'אוטומטי', do: ['מחכים כמה שניות'], expect: 'נושא: "✅ Test, הכל מוכן — ככה נכנסים לאפליקציה"', look: `Gmail · ${SCREEN}`, shots: ['e-academy_move_in'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל ← "הכול נכון, ממשיכים" ← "כניסה עם קוד במייל — בלי Strava" ← "שלחו לי קוד"'], look: SCREEN },
      { key: 'baseline', title: 'בסיס הקצב מולא מראש מהקובץ', where: 'האפליקציה שלך', do: ['אקדמיה ← Test Import ← "טופס התאמה" ← הבסיס כבר מוצע ← שמירה'], look: SCREEN },
    ],
  },
];

/** The fastest order across the four flows: start the next while a mail is on its way. */
export const QUICK_ORDER: string[] = [
  `${SCREEN}: "ניקוי והתחלה מחדש", ואז בבדיקה 4 "ליצור כרטיס בדיקה מהקובץ"`,
  'כרטיסייה פרטית א׳: בדיקה 1 "נרשמים"',
  'כרטיסייה פרטית ב׳: בדיקה 2 "ממלאים את טופס האקדמיה"',
  'באפליקציה שלך: מאשרים את Test Club, מקבלים את Test Academy, שולחים טופס ל־Test Movein, מזמינים את Test Import',
  'ב־Gmail: ארבעה מיילים — פותחים כל קישור בכרטיסייה פרטית משלו וממשיכים כל בדיקה עד הסוף',
  `${SCREEN}: כל השלבים ירוקים`,
];

export type StepState = 'done' | 'next' | 'waiting' | 'stuck';
export interface StepStatus { key: string; state: StepState; at?: string | null; note?: string | null; fix?: { action: string; label: string; payload: Record<string, string> } | null }

/** The first not-done step is "next"; everything after it waits. A stuck step stays stuck. */
export function orderStates(facts: Array<{ key: string; done: boolean; at?: string | null; note?: string | null; stuck?: string | null; fix?: StepStatus['fix'] }>): StepStatus[] {
  let nextGiven = false;
  return facts.map((f) => {
    if (f.done) return { key: f.key, state: 'done', at: f.at ?? null, note: f.note ?? null };
    if (f.stuck) { nextGiven = true; return { key: f.key, state: 'stuck', note: f.stuck, fix: f.fix ?? null }; }
    if (!nextGiven) { nextGiven = true; return { key: f.key, state: 'next', note: f.note ?? null, fix: f.fix ?? null }; }
    return { key: f.key, state: 'waiting' };
  });
}

/** Levenshtein, for "you typed grosfeldofr+club20@" — small, local, no dependency. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * The hand-test flows on the staff "בדיקות" screen (/dashboard/tests): one test identity
 * per sign-up door, and every step written as what Ofer does on his iPhone. The status of
 * each step is read live from the database (lib/testing/status) — this file only says
 * what to do and which fact proves it happened. Pure.
 */

export type FlowId = 'club' | 'academy' | 'movein' | 'import';

/** Every address here is a +tag of the super user's own Gmail: his inbox, separate accounts. */
export const TEST_EMAILS: Record<FlowId, string> = {
  club: 'grosfeldofer+club20@gmail.com',
  academy: 'grosfeldofer+academy20@gmail.com',
  movein: 'grosfeldofer+movein20@gmail.com',
  import: 'grosfeldofer+import20@gmail.com',
};
export const TEST_EMAIL_LIST = Object.values(TEST_EMAILS);
export const isTestEmail = (e: string | null | undefined) => !!e && TEST_EMAIL_LIST.includes(e.trim().toLowerCase());

export interface CopyValue { label: string; value: string }
export interface FlowStepDef {
  /** The fact that proves this step happened — see lib/testing/status. */
  key: string;
  title: string;
  /** Where to do it: the private tab (the test person), the regular app (you), Gmail. */
  where: 'פרטי' | 'האפליקציה שלך' | 'Gmail' | 'אוטומטי';
  /** What to do, in order, in his words. */
  do: string[];
  values?: CopyValue[];
}
export interface FlowDef { id: FlowId; title: string; goal: string; email: string; steps: FlowStepDef[] }

const BASE = 'www.madregot.app';

export const FLOWS: FlowDef[] = [
  {
    id: 'club',
    title: '1 · הרשמה למועדון',
    goal: 'מי שנרשם מבחוץ מגיע אליך, מאושר, נכנס בלי Strava ומסיים את ההגדרה.',
    email: TEST_EMAILS.club,
    steps: [
      {
        key: 'signup', title: 'נרשמים', where: 'פרטי',
        do: ['Safari → כרטיסיות → פרטי → +', `פותחים ${BASE}/register`, '"🏃 המועדון" → המשך', 'ממלאים את "כמה פרטים" → "אינסטגרם" → המשך', 'זמן מרתון: מקלידים 23400 (מופיע 2:34:00) → המשך', '"דבוקה 2 · מומלץ" → בודקים שהמייל נכון → שליחה'],
        values: [{ label: 'שם פרטי', value: 'Test' }, { label: 'שם משפחה', value: 'Club' }, { label: 'אימייל', value: TEST_EMAILS.club }, { label: 'נייד', value: '0500000001' }, { label: 'זמן מרתון', value: '23400' }, { label: 'איפה', value: 'מרתון תל אביב' }, { label: 'שנה', value: '2026' }],
      },
      { key: 'received_mail', title: 'מייל "קיבלנו" נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'staff_alert', title: 'התראה לצוות על בקשה חדשה', where: 'אוטומטי', do: ['נבדק לבד — רואים למי היא הגיעה'] },
      { key: 'approved', title: 'מאשרים', where: 'האפליקציה שלך', do: [`פותחים ${BASE}/dashboard/entry-queue`, 'הכרטיס "Test Club" → בודקים שדבוקה 2 מסומנת → "אשר ושלח קישור"'] },
      { key: 'approved_mail', title: 'מייל "ההרשמה אושרה" נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['ב־Gmail: לחיצה ארוכה על "להתחלה" במייל → העתקה → מדביקים בכרטיסייה הפרטית', '"הכול נכון, ממשיכים"', '"כניסה עם קוד במייל — בלי Strava" → "שלחו לי קוד" → מקלידים את 6 הספרות מהמייל'] },
      { key: 'setup_done', title: 'מסיימים את ההגדרה', where: 'פרטי', do: ['התקנה: "לא מצליחים להתקין? ממשיכים בדפדפן"', 'שעון: "אין לי Garmin — ממשיכים"', 'התראות: מאשרים', 'פרטים: תאריך לידה, גובה, מידות'], values: [{ label: 'תאריך לידה', value: '01/01/1990' }, { label: 'גובה', value: '178' }] },
      { key: 'member', title: 'חבר מועדון בדבוקה 2', where: 'אוטומטי', do: ['נבדק לבד'] },
    ],
  },
  {
    id: 'academy',
    title: '2 · מועמד חדש לאקדמיה',
    goal: 'מועמד מבחוץ ממלא את הטופס, מגיע למשפך, מתקבל, נכנס, והמאמן מקבל התראה.',
    email: TEST_EMAILS.academy,
    steps: [
      { key: 'applied', title: 'ממלאים את טופס האקדמיה', where: 'פרטי', do: [`${BASE}/register → "🎯 האקדמיה" → המשך`, 'ממלאים את 4 העמודים → לשלוח'], values: [{ label: 'שם פרטי', value: 'Test' }, { label: 'שם משפחה', value: 'Academy' }, { label: 'אימייל', value: TEST_EMAILS.academy }, { label: 'נייד', value: '0500000002' }] },
      { key: 'applicant_alert', title: 'התראה לצוות על מועמד', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'accepted', title: 'מקבלים לאקדמיה', where: 'האפליקציה שלך', do: ['אקדמיה → מועמדים → Test Academy → "לקבל לאקדמיה" → מאמן Sahar → "קבלה ושליחה"'] },
      { key: 'accepted_mail', title: 'מייל "התקבלת" נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל → "הכול נכון, ממשיכים" → "כניסה עם קוד במייל — בלי Strava"'] },
      { key: 'coach_linked', title: 'משובץ למאמן', where: 'אוטומטי', do: ['נבדק לבד'] },
    ],
  },
  {
    id: 'movein',
    title: '3 · מתאמן קיים ("כבר מתאמנים")',
    goal: 'מתאמן שכבר אצלנו מקבל טופס של עמוד אחד, מאושר, נכנס, והמאמן קובע בסיס קצב.',
    email: TEST_EMAILS.movein,
    steps: [
      { key: 'invited', title: 'שולחים טופס', where: 'האפליקציה שלך', do: ['אקדמיה → "+ הוספה" → "כבר מתאמנים" → "עוד לא באפליקציה"', 'ממלאים → מאמנים: Sahar → "לשלוח … טופס פרטים"'], values: [{ label: 'שם', value: 'Test Movein' }, { label: 'מייל', value: TEST_EMAILS.movein }, { label: 'טלפון', value: '0500000003' }] },
      { key: 'form_mail', title: 'מייל הטופס נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'form_filled', title: 'ממלאים את הטופס', where: 'פרטי', do: ['הקישור מהמייל → מאשרים את הפרטים → בריאות → שליחה'] },
      { key: 'accepted', title: 'מאשרים', where: 'האפליקציה שלך', do: ['אקדמיה → הכרטיס "Test Movein" → אישור'] },
      { key: 'install_mail', title: 'מייל ההתקנה נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'coach_setup', title: 'המאמן קיבל "טופס התאמה"', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל → "כניסה עם קוד במייל — בלי Strava"'] },
      { key: 'baseline', title: 'בסיס קצב נקבע', where: 'האפליקציה שלך', do: ['אקדמיה → Test Movein → "טופס התאמה" → בסיס קצב: 10 ק״מ, 42:00 (מקלידים 4200) → שמירה'] },
    ],
  },
  {
    id: 'import',
    title: '4 · מתאמן מהקובץ',
    goal: 'כרטיס מהקובץ מוזמן, מאשר את הפרטים שמולאו מראש, נכנס, והקצבים כבר שם.',
    email: TEST_EMAILS.import,
    steps: [
      { key: 'card', title: 'כרטיס בדיקה קיים', where: 'האפליקציה שלך', do: ['במסך הזה: "ליצור כרטיס בדיקה מהקובץ"'] },
      { key: 'invited', title: 'מזמינים', where: 'האפליקציה שלך', do: ['אקדמיה → "מעבר לאפליקציה" → "מי מוזמן" → מסמנים רק את "Test Import" → שליחה'] },
      { key: 'form_mail', title: 'מייל "הפרטים שלך" נשלח', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'confirmed', title: 'מאשרים את הפרטים', where: 'פרטי', do: ['הקישור מהמייל → "הפרטים שלך" → תאריך לידה + מגדר → בריאות "כן" → שליחה'], values: [{ label: 'תאריך לידה', value: '01/01/1990' }] },
      { key: 'install_mail', title: 'מייל ההתקנה נשלח (בלי אישור נוסף)', where: 'אוטומטי', do: ['נבדק לבד'] },
      { key: 'signed_in', title: 'נכנסים בפעם הראשונה', where: 'פרטי', do: ['הקישור מהמייל → "כניסה עם קוד במייל — בלי Strava"'] },
      { key: 'baseline', title: 'בסיס הקצב מולא מראש מהקובץ', where: 'האפליקציה שלך', do: ['אקדמיה → Test Import → "טופס התאמה" → הבסיס כבר מוצע → שמירה'] },
    ],
  },
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

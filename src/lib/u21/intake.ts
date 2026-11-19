/**
 * Madregot Personal Coach (U21) — tracks, intake questionnaire, validation and
 * safety screening. Pure module: shared by the public page (/u21), the POST route
 * (/api/u21/register) and the tests.
 *
 * DRAFT questionnaire: derived only from the spec's intake topic areas; questions,
 * red-flag list and guardian-consent wording await coach Roi's and legal review.
 * Nothing here diagnoses anything or produces a plan. Every record, flagged or not,
 * is stored as `pending_review`; a red flag is only highlighted to the admin.
 */

export type U21Track = 'basic' | 'advanced' | 'pro';

export interface U21TrackInfo {
  id: U21Track;
  name: string;
  priceIls: number;
  tagline: string;
  benefits: string[];
}

export const U21_TRACKS: U21TrackInfo[] = [
  {
    id: 'basic', name: 'BASIC', priceIls: 79, tagline: 'תוכנית שבועית מסודרת',
    benefits: [
      'תוכנית ריצה שבועית מותאמת אישית',
      'תרגילי כוח ומוביליטי בסיסיים',
      'התוכנית עוברת בדיקה של המאמן לפני שליחה',
      'הצטרפות לקהילת מדרגות',
    ],
  },
  {
    id: 'advanced', name: 'ADVANCED', priceIls: 119, tagline: 'תוכנית + מעקב ועדכונים',
    benefits: [
      'כל מה שב־BASIC',
      'תוכנית כוח ומוביליטי מלאה',
      'עדכון התוכנית לפי משוב שבועי',
      'מעקב התקדמות לקראת יעד (גיבוש / מבדק / תחרות)',
      'הצטרפות לקהילת מדרגות',
    ],
  },
  {
    id: 'pro', name: 'PRO', priceIls: 219, tagline: 'ליווי אישי צמוד',
    benefits: [
      'כל מה שב־ADVANCED',
      'ליווי אישי צמוד של המאמן',
      'שיחת היכרות ושיחות מעקב',
      'התאמות שוטפות לאורך השבוע',
      'הצטרפות לקהילת מדרגות',
    ],
  },
];

export const isU21Track = (v: unknown): v is U21Track =>
  v === 'basic' || v === 'advanced' || v === 'pro';

export const U21_MIN_AGE = 16;
export const U21_MAX_AGE = 21;

export type U21AgeBand = 'under16' | '16-17' | '18-21' | 'over21';

/** Whole years on `now`'s date. null for an unparseable or future date. */
export function ageOn(birthDate: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

export function ageBand(age: number): U21AgeBand {
  if (age < 16) return 'under16';
  if (age < 18) return '16-17';
  if (age <= 21) return '18-21';
  return 'over21';
}

export const isMinor = (age: number) => age < 18;

// ── Questionnaire ────────────────────────────────────────────────────────────

export type U21Field =
  | { key: string; label: string; type: 'text' | 'email' | 'tel' | 'date' | 'number' | 'textarea'; required?: boolean; placeholder?: string; section: string }
  | { key: string; label: string; type: 'radio'; options: string[]; required?: boolean; section: string }
  | { key: string; label: string; type: 'checkboxes'; options: string[]; required?: boolean; section: string }
  | { key: string; label: string; type: 'yesno'; required?: boolean; section: string; redFlag?: RedFlagKey }
  | { key: string; label: string; type: 'checkbox'; required?: boolean; section: string };

export const FRAMEWORKS = ['מכינה קדם־צבאית', 'שנת שירות', 'תיכון', 'אחר'];
export const WEEK_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export type RedFlagKey =
  | 'chest_pain'
  | 'fainting'
  | 'bone_pain'
  | 'acute_injury';

export const RED_FLAG_KEYS: RedFlagKey[] = ['chest_pain', 'fainting', 'bone_pain', 'acute_injury'];

/** Shown next to the red-flag questions and the guardian consent in the UI. */
export const DRAFT_NOTE = 'טיוטה - ממתין לאישור המאמן והיבטים משפטיים';

/** Under every date field: the native picker's display order varies by device. */
export const DATE_HINT = 'יש לבחור תאריך מלוח השנה. הפורמט: יום/חודש/שנה (לדוגמה 01/05/2007).';

/** Shown at the top of every /u21 screen while this is a protected test preview. */
export const TEST_PREVIEW_NOTE = 'גרסת בדיקה: יש להזין פרטים בדויים בלבד. אין להזין פרטים אישיים או רפואיים אמיתיים.';

/** Guardian fields only show (and are only required) for an applicant under 18. */
export const GUARDIAN_KEYS = ['guardianName', 'guardianPhone', 'guardianConsent'] as const;

export const U21_FIELDS: U21Field[] = [
  // Personal
  { section: 'פרטים אישיים', key: 'firstName', label: 'שם פרטי', type: 'text', required: true },
  { section: 'פרטים אישיים', key: 'lastName', label: 'שם משפחה', type: 'text', required: true },
  { section: 'פרטים אישיים', key: 'email', label: 'אימייל', type: 'email', required: true },
  { section: 'פרטים אישיים', key: 'phone', label: 'מספר נייד', type: 'tel', required: true, placeholder: '050-0000000' },
  { section: 'פרטים אישיים', key: 'birthDate', label: 'תאריך לידה', type: 'date', required: true },
  { section: 'פרטים אישיים', key: 'guardianName', label: 'שם הורה / אפוטרופוס', type: 'text', required: true },
  { section: 'פרטים אישיים', key: 'guardianPhone', label: 'טלפון הורה / אפוטרופוס', type: 'tel', required: true },
  { section: 'פרטים אישיים', key: 'guardianConsent', label: 'אישור הורה / אפוטרופוס להצטרפות (נוסח טיוטה)', type: 'checkbox', required: true },
  // Framework & goal
  { section: 'מסגרת ומטרה', key: 'framework', label: 'מסגרת נוכחית', type: 'radio', options: FRAMEWORKS, required: true },
  { section: 'מסגרת ומטרה', key: 'frameworkOther', label: 'פרט/י (מסגרת אחרת)', type: 'text' },
  { section: 'מסגרת ומטרה', key: 'goal', label: 'מה המטרה הספורטיבית שלך?', type: 'textarea', required: true, placeholder: 'למשל: גיבוש, שיפור 3 ק״מ, מבדק כושר' },
  { section: 'מסגרת ומטרה', key: 'targetDate', label: 'תאריך יעד (אם יש)', type: 'date' },
  // Experience & fitness
  { section: 'ניסיון וכושר', key: 'experience', label: 'ניסיון באימונים', type: 'radio', options: ['אין ניסיון', 'פחות משנה', '1–3 שנים', 'יותר מ־3 שנים'], required: true },
  { section: 'ניסיון וכושר', key: 'fitnessResults', label: 'תוצאות כושר נוכחיות (3 ק״מ, מתח, שכיבות סמיכה...)', type: 'textarea' },
  { section: 'ניסיון וכושר', key: 'runsPerWeek', label: 'כמה פעמים בשבוע את/ה רץ/ה?', type: 'radio', options: ['0', '1–2', '3–4', '5+'], required: true },
  { section: 'ניסיון וכושר', key: 'weeklyKm', label: 'נפח ריצה שבועי משוער (ק״מ)', type: 'number' },
  { section: 'ניסיון וכושר', key: 'strengthExperience', label: 'ניסיון באימוני כוח', type: 'radio', options: ['אין', 'מעט', 'מתאמן/ת באופן קבוע'], required: true },
  { section: 'ניסיון וכושר', key: 'otherTraining', label: 'אימונים במסגרת אחרת (מכינה, קבוצה, חוג...)', type: 'textarea' },
  // Availability
  { section: 'זמינות וציוד', key: 'availableDays', label: 'באילו ימים אפשר להתאמן?', type: 'checkboxes', options: WEEK_DAYS, required: true },
  { section: 'זמינות וציוד', key: 'equipment', label: 'ציוד זמין', type: 'checkboxes', options: ['ללא ציוד', 'מתח', 'משקולות', 'חדר כושר', 'גומיות', 'מסלול / מגרש'] },
  // Recovery
  { section: 'שינה והתאוששות', key: 'sleepHours', label: 'כמה שעות שינה בלילה בממוצע?', type: 'radio', options: ['פחות מ־6', '6–7', '7–8', 'יותר מ־8'], required: true },
  { section: 'שינה והתאוששות', key: 'recovery', label: 'איך את/ה מרגיש/ה מבחינת עייפות והתאוששות?', type: 'radio', options: ['טוב', 'בינוני', 'עייף/ה רוב הזמן'] },
  // Safety
  { section: 'בריאות ובטיחות', key: 'chestPain', label: 'האם חווית כאב / לחץ בחזה במהלך מאמץ?', type: 'yesno', required: true, redFlag: 'chest_pain' },
  { section: 'בריאות ובטיחות', key: 'fainting', label: 'האם התעלפת או כמעט התעלפת במהלך / אחרי מאמץ?', type: 'yesno', required: true, redFlag: 'fainting' },
  { section: 'בריאות ובטיחות', key: 'bonePain', label: 'האם יש כאב נקודתי בעצם (שוק, כף רגל, ירך) שמחמיר בריצה?', type: 'yesno', required: true, redFlag: 'bone_pain' },
  { section: 'בריאות ובטיחות', key: 'acuteInjury', label: 'האם יש כרגע פציעה חריפה (נפיחות, צליעה, כאב חד)?', type: 'yesno', required: true, redFlag: 'acute_injury' },
  { section: 'בריאות ובטיחות', key: 'injuries', label: 'פציעות / כאבים / תסמינים נוספים (עבר או הווה)', type: 'textarea' },
  // Preferences
  { section: 'העדפות', key: 'preferences', label: 'העדפות ומגבלות (שעות, סוגי אימון, דברים שחשוב שנדע)', type: 'textarea' },
];

export type U21Answers = Record<string, string | string[] | boolean | undefined>;

export function fieldVisible(key: string, answers: U21Answers, age: number | null): boolean {
  if ((GUARDIAN_KEYS as readonly string[]).includes(key)) return age !== null && isMinor(age);
  if (key === 'frameworkOther') return answers.framework === 'אחר';
  return true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^0\d{8,9}$/;
const normPhone = (s: string) => s.replace(/[\s-]/g, '');

export interface U21ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
  age: number | null;
}

/** Is `v` the runtime shape this field stores? Checkbox → boolean; checkboxes → string[]; else string. */
export function hasFieldType(f: U21Field, v: unknown): boolean {
  if (f.type === 'checkbox') return typeof v === 'boolean';
  if (f.type === 'checkboxes') return Array.isArray(v) && v.every(x => typeof x === 'string');
  return typeof v === 'string';
}

/** answers must be a plain object — not an array, null or a primitive. */
export function isAnswersObject(v: unknown): v is U21Answers {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The same rules on both sides: the page shows them, the route enforces them. */
export function validateU21Intake(track: unknown, answers: U21Answers, now = new Date()): U21ValidationResult {
  const errors: Record<string, string> = {};
  if (!isU21Track(track)) errors.track = 'יש לבחור מסלול';

  const age = typeof answers.birthDate === 'string' ? ageOn(answers.birthDate, now) : null;

  for (const f of U21_FIELDS) {
    if (!fieldVisible(f.key, answers, age)) continue;
    const v = answers[f.key];
    // Runtime type first, required or not: the route takes JSON from anyone, so a
    // `true` where a name belongs must be refused, not stored as "true".
    if (v !== undefined && v !== null && !hasFieldType(f, v)) { errors[f.key] = 'ערך לא תקין'; continue; }
    if (f.required) {
      const empty =
        v === undefined || v === null ||
        (typeof v === 'string' && !v.trim()) ||
        (Array.isArray(v) && v.length === 0) ||
        (f.type === 'checkbox' && v !== true) ||
        (f.type === 'yesno' && v !== 'yes' && v !== 'no');
      if (empty) { errors[f.key] = f.type === 'checkbox' ? 'נדרש אישור הורה / אפוטרופוס' : 'שדה חובה'; continue; }
    }
    if (v === undefined || v === '' || v === null) continue;
    if (typeof v === 'string' && v.length > 2000) errors[f.key] = 'ארוך מדי';
    if (f.type === 'radio' && typeof v === 'string' && !f.options.includes(v)) errors[f.key] = 'ערך לא תקין';
    if (f.type === 'checkboxes' && (!Array.isArray(v) || v.some(x => !f.options.includes(x)))) errors[f.key] = 'ערך לא תקין';
  }

  if (typeof answers.email === 'string' && answers.email && !EMAIL_RE.test(answers.email.trim())) errors.email = 'אימייל לא תקין';
  for (const k of ['phone', 'guardianPhone']) {
    const v = answers[k];
    if (typeof v === 'string' && v && fieldVisible(k, answers, age) && !PHONE_RE.test(normPhone(v))) errors[k] = 'מספר טלפון לא תקין';
  }
  if (typeof answers.birthDate === 'string' && answers.birthDate && !errors.birthDate) {
    if (age === null) errors.birthDate = 'תאריך לא תקין';
    else if (age < U21_MIN_AGE || age > U21_MAX_AGE) errors.birthDate = `השירות מיועד לגילאי ${U21_MIN_AGE}–${U21_MAX_AGE}`;
  }
  const km = answers.weeklyKm;
  if (typeof km === 'string' && km !== '' && (!/^\d+(\.\d+)?$/.test(km) || Number(km) > 300)) errors.weeklyKm = 'מספר לא תקין';

  return { ok: Object.keys(errors).length === 0, errors, age };
}

export interface U21SafetyResult {
  flagged: boolean;
  flags: Record<RedFlagKey, boolean>;
}

/**
 * DRAFT red-flag list — pending coach Roi's and legal review; not an approved clinical
 * instrument. A flag makes NO decision: every registration lands in pending_review the
 * same way, and the applicant sees the same confirmation. A flag only marks the row
 * "needs attention" for the admin reviewer.
 */
export function screenSafety(answers: U21Answers): U21SafetyResult {
  const flags = Object.fromEntries(RED_FLAG_KEYS.map(k => [k, false])) as Record<RedFlagKey, boolean>;
  for (const f of U21_FIELDS) {
    if (f.type === 'yesno' && f.redFlag && answers[f.key] === 'yes') flags[f.redFlag] = true;
  }
  return { flagged: RED_FLAG_KEYS.some(k => flags[k]), flags };
}

/** Drops anything that is not a known, visible field — the route stores only this. */
export function pickKnownAnswers(answers: U21Answers, age: number | null): U21Answers {
  const out: U21Answers = {};
  for (const f of U21_FIELDS) {
    if (!fieldVisible(f.key, answers, age)) continue;
    const v = answers[f.key];
    if (v === undefined) continue;
    out[f.key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

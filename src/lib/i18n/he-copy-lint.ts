/**
 * Hebrew copy lint — the two gendered patterns the web copy should not use.
 *
 * The club writes to men and women alike. When this was written he.json had
 * 164 masculine imperatives against 196 infinitives and 78 "נסו", so the
 * neutral forms were already the majority; this keeps it that way.
 *
 * 1. Gender slashes — "את/ה", "מגיע/ה", "יודע/ת", "בחר/י", "חבר(ה)". They read
 *    as a form to fill in, and a screen reader spells the slash out. Rephrase
 *    (plural, infinitive, a noun) instead.
 * 2. Masculine imperatives — "בחר", "הזן", "נסה שוב". Buttons and labels take
 *    a noun ("שמירה", "בחירת קבוצה", "ביטול"); sentences take the plural
 *    imperative the app already uses most ("נסו שוב" ×78, "בחרו", "הזינו"),
 *    the infinitive ("לנסות שוב") or "אפשר ל…" / "יש ל…".
 *
 * Units are not gender slashes: "שנ׳/ק״מ", "פעימות/דקה" and "ל/ק" are left
 * alone because the part after the slash is not a gender suffix. Number
 * plurals in parentheses ("אימון(ים)") are not gendered either.
 *
 * Several masculine imperatives are spelled exactly like the past tense
 * ("בחר" = "choose!" and "he chose"; "לחץ", "מחק", "עדכן", "התחבר",
 * "השתמש"). Those are only flagged where an instruction starts — the start of
 * the string or right after sentence punctuation — so "לא בחר דבוקה" is fine.
 * Words with an unrelated everyday meaning ("עבור" = for, "אשר" = which,
 * "המשך" = continuation, "פתח", "סגור", "רשום", "העלה") are not checked at all.
 */

const HEB = 'א-ת';

/** Suffixes that make "X/s" a gendered pair rather than a unit. */
const GENDER_SUFFIX = '(?:ה|ת|י|תה|ית)';

const GENDER_SLASH = new RegExp(`[${HEB}][${HEB}׳"״]+\\/${GENDER_SUFFIX}(?![${HEB}])`, 'g');
const GENDER_PAREN = new RegExp(`[${HEB}][${HEB}]+\\(${GENDER_SUFFIX}\\)`, 'g');

/** Imperatives whose spelling has no other common meaning. */
const ALWAYS_IMPERATIVE = [
  'הקש', 'הזן', 'הוסף', 'ערוך', 'נסה', 'בדוק', 'הכנס', 'צור', 'שתף',
  'הגדר', 'הירשם', 'היכנס', 'סמן', 'גרור', 'הדבק', 'ודא', 'תוודא', 'הקלד',
  'גלול', 'תבחר', 'תלחץ', 'תזין', 'תנסה', 'תבדוק', 'שלח', 'בטל',
];

/** Imperatives spelled like the past tense — flagged only where an instruction starts. */
const IMPERATIVE_AT_START = ['לחץ', 'בחר', 'מחק', 'עדכן', 'התחבר', 'השתמש', 'חזור', 'כתוב', 'שמור'];

// "בטל" (cancelled), "שלח" and "שמור" (saved: "כבר שמור") are ambiguous too.
const START_ONLY = new Set([...IMPERATIVE_AT_START, 'בטל', 'שלח']);

/** Every checked word in one pass: optional conjunction ו, bounded by non-Hebrew. */
const IMPERATIVE = new RegExp(
  `(?<![${HEB}])ו?(${[...ALWAYS_IMPERATIVE, ...IMPERATIVE_AT_START].join('|')})(?![${HEB}])`,
  'g',
);

const HAS_HEBREW = new RegExp(`[${HEB}]`);

/** What may end the text before a word for that word to start an instruction. */
const START_BEFORE = /(?:[.!?:;—–·•\n(]|(?:^|[\s,])או)$/;

/** Openers between a sentence start and its first word: space, quotes, a tag, an ICU brace. */
const OPENERS = /(?:\s|['"`״{}]|<[^<>]*>)+$/;

function startsInstruction(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 40), at).replace(OPENERS, '');
  if (before === '' && at <= 40) return true;
  return START_BEFORE.test(before);
}

export type HeCopyIssue = {
  kind: 'gender-slash' | 'masculine-imperative';
  match: string;
  index: number;
};

export function lintHebrewCopy(text: string): HeCopyIssue[] {
  const issues: HeCopyIssue[] = [];
  if (!HAS_HEBREW.test(text)) return issues;
  for (const re of [GENDER_SLASH, GENDER_PAREN]) {
    for (const m of text.matchAll(re)) {
      issues.push({ kind: 'gender-slash', match: m[0], index: m.index ?? 0 });
    }
  }
  for (const m of text.matchAll(IMPERATIVE)) {
    const at = m.index ?? 0;
    if (START_ONLY.has(m[1])) {
      if (!startsInstruction(text, at)) continue;
    }
    issues.push({ kind: 'masculine-imperative', match: m[0], index: at });
  }
  return issues.sort((a, b) => a.index - b.index);
}

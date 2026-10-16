/**
 * How the academy form's stored answers are SHOWN (mockup academy-form-v3.html).
 *
 * Display only. The form still stores the exact option strings it always has
 * (`academy_intake.group` is `'דבוקה 7 הכנה לחצי מרתון'`, not `7`), because the staff
 * mail, the accept flow and every row already in the table read those strings. This
 * module maps a stored string to the pieces v3 draws: the number badge, a short name,
 * the line under it, and the tag on the manager's card. An answer it does not know
 * (an older form's wording) falls back to the string itself rather than to nothing.
 *
 * Pure, no imports beyond the email helpers, so both the public form and the staff
 * card pull it in.
 */
import { ageFrom, focusShort, whatsappNumber } from '@/lib/email/academy-new-applicant';

// Re-exported so the card reads its age, focus tag and wa.me number from one place.
export { ageFrom, focusShort, whatsappNumber };

export interface GroupDisplay {
  /** The pack number on the badge. */
  n: number;
  /** The short name on the row. */
  name: string;
  /** The line under it, when there is one. */
  sub?: string;
  /** The manager card's tag, after "דבוקה N · ". */
  tag: string;
}

/** Keyed by the form's stored option, word for word. */
export const GROUP_DISPLAY: Record<string, GroupDisplay> = {
  'דבוקה 4 מרתון חזק עם רצון לסאב 3': { n: 4, name: 'מרתון חזק', sub: 'עם רצון לסאב 3', tag: 'סאב 3' },
  'דבוקה 5 אימון למרתון באזור ה-3:30': { n: 5, name: 'מרתון באזור 3:30', tag: 'מרתון 3:30' },
  'דבוקה 6 ביצוע מרתון מלא בכל תוצאה': { n: 6, name: 'מרתון מלא', sub: 'בכל תוצאה', tag: 'מרתון מלא' },
  'דבוקה 7 הכנה לחצי מרתון': { n: 7, name: 'הכנה לחצי מרתון', tag: 'חצי מרתון' },
  'דבוקה 8 שיפור הישגים למרחקים קצרים 5 ק"מ 10 ק"מ': { n: 8, name: 'מרחקים קצרים', sub: 'שיפור ב־5 ו־10 ק״מ', tag: 'מרחקים קצרים' },
  'דבוקה 9 אימון למתחילים מ-0': { n: 9, name: 'מתחילים מ־0', tag: 'מתחילים' },
};

/** v3's badge tints, one per pack: [background, text, border]. */
export const GROUP_TINT: Record<number, [string, string, string]> = {
  4: ['#E9ECFF', '#1525FF', '#D5DAFF'],
  5: ['#E9ECFF', '#3A55F5', '#D5DAFF'],
  6: ['#EFE9FF', '#6A3BE0', '#E0D5FF'],
  7: ['#FFF1E4', '#C25E10', '#FADFC6'],
  8: ['#E6F5EE', '#0E7A3C', '#CDEBDC'],
  9: ['#FDEAF2', '#B8306A', '#F7D3E2'],
};

/** "דבוקה 7 · חצי מרתון", or the stored answer when it is not one of the six. */
export function groupTag(group: unknown): string {
  const g = typeof group === 'string' ? group.trim() : '';
  if (!g) return '';
  const d = GROUP_DISPLAY[g];
  return d ? `דבוקה ${d.n} · ${d.tag}` : g;
}

/** The medical answer that raises no flag. Same string the form stores. */
export const HEALTHY_ANSWER = 'בריא לחלוטין';

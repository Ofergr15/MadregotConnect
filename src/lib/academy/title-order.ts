/**
 * The trainee screens name a steady run word first — "קל 6 ק״מ", "ארוכה 16 ק״מ" (mockup
 * trainee-experience-v2, screens 1ג and 2) — the order they already use for minutes ("קל 40
 * דקות"). The coach's workout book keeps its own "16 ק״מ ארוכה" (book-steps structureName,
 * workout-book-v3), so the trainee side reorders at display time rather than changing the
 * shared name. Idempotent; anything that is not "<km> ק״מ <one word>" is returned as is
 * (reps like "3 × 2 ק״מ טמפו" included).
 */
const KM_THEN_WORD = /^(\d+(?:\.\d+)?) ק״מ ([^\s\d×+]+)$/;

export function wordFirstTitle(title: string): string {
  const m = KM_THEN_WORD.exec(title.trim());
  return m ? `${m[2]} ${m[1]} ק״מ` : title;
}

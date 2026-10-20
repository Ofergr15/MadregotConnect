import { nameWordSkeletons } from '@/lib/auth/athlete-identity';

/**
 * Does a member's name answer what was typed? The roster is mostly in Latin letters, so
 * "אלון" never found Alon Lifshitz by letters (Ofer, 2026-10-19). Plain letters first; then
 * each typed word's consonant skeleton must START one word of the name — the same folding
 * the Strava linking uses (lib/auth/athlete-identity.ts), so Hebrew meets Latin either way.
 *
 * A short name reduces to one consonant ("איתי" and "Itai" are both "t", "חן" and "Chen"
 * both "n") — too little to match as a prefix, so such a word must equal a whole name word
 * (search, 2026-10-20). The linking keeps its own stricter floor; a search only lists.
 */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const n = (name || '').toLowerCase();
  const q = query.trim().toLowerCase();
  if (!n || q.length < 2) return false;
  if (n.includes(q)) return true;
  const typed = nameWordSkeletons(q);
  const words = nameWordSkeletons(n);
  const typedWords = q.split(/\s+/).filter(Boolean);
  return typed.some((qWords) => {
    // Every typed word has to say something: a one-letter word ("a") does not.
    if (!qWords.length || qWords.length !== typedWords.length || typedWords.some((w) => w.length < 2)) return false;
    return qWords.every((qw) => words.some((nWords) => nWords.some((w) => (qw.length >= 2 ? w.startsWith(qw) : w === qw))));
  });
}

/**
 * The screens' own filters (people, athletes, roles, entry queue, settings, discovery):
 * the name in either script, or the plain text of the rest — an email, a pack.
 */
export function personMatches(name: string | null | undefined, query: string, ...rest: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (`${name || ''} ${rest.filter(Boolean).join(' ')}`.toLowerCase().includes(q)) return true;
  return nameMatches(name, q);
}

/** Lower case, and "10x400" / "10 X 400" / "10*400" / "10 × 400" all as "10×400". */
function foldText(s: string): string {
  // A repeat being typed ("6 ×", "6x") folds the same way as a whole one.
  return s.toLowerCase().replace(/(\d)\s*[x×*]\s*(?=\d|$)/g, '$1×').replace(/\s+/g, ' ').trim();
}

/**
 * Does any of these texts contain what was typed — for workouts and other words, not
 * names: case-free, and a repeat typed with x, X, * or × finds it written any of those
 * ways (the workout book, 2026-10-20).
 */
export function textMatches(query: string, ...texts: Array<string | null | undefined>): boolean {
  const q = foldText(query);
  if (!q) return true;
  return texts.some((t) => !!t && foldText(t).includes(q));
}

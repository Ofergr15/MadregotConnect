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

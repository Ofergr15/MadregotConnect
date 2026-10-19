import { nameWordSkeletons } from '@/lib/auth/athlete-identity';

/**
 * Does a member's name answer what was typed? The roster is in Latin letters
 * (reference: athletes.name is Latin-only), so "אלון" never found Alon Lifshitz by
 * letters (Ofer, 2026-10-19). Plain letters first; then each typed word's consonant
 * skeleton must START one word of the name — the same folding the Strava linking
 * uses (lib/auth/athlete-identity.ts), so Hebrew meets Latin either way round.
 */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const n = (name || '').toLowerCase();
  const q = query.trim().toLowerCase();
  if (!n || q.length < 2) return false;
  if (n.includes(q)) return true;
  const typed = nameWordSkeletons(q);
  const words = nameWordSkeletons(n);
  return typed.some((qWords) => {
    // A word with under two consonants ("אי", "a") says too little to match on.
    const keyed = qWords.filter((w) => w.length >= 2);
    return keyed.length > 0 && keyed.length === qWords.length
      && keyed.every((qw) => words.some((nWords) => nWords.some((w) => w.startsWith(qw))));
  });
}

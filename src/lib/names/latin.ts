/**
 * One spelling per member, in Latin letters.
 *
 * The roster ran for months with names in two scripts and two capitalisations:
 * six rows in Hebrew, two lower-cased, one with a trailing space. That is not a
 * cosmetic problem. `athletes.name` is the join key between a Strava profile and
 * a roster row (see athlete-identity.ts, which resorts to consonant skeletons to
 * bridge the scripts), it is what every leaderboard, feed card, email and push
 * renders, and it is sorted — so a mixed-script roster sorts into two blocks.
 *
 * Two rules, applied at every point a human-supplied name enters the app:
 *   1. Latin letters only. We ASK for it; we never transliterate. Hebrew has no
 *      written vowels, so a machine transliteration of רועי is "Rvy" — worse than
 *      the Hebrew it replaced, and unfixable once it is stored as somebody's name.
 *   2. Trim, collapse inner whitespace, and capitalise words left lower-case.
 *
 * Deliberately NOT applied to names the app generates for itself
 * (placeholderNameFromEmail, "Strava <id>"): those are placeholders and are
 * allowed to look like one.
 */

import { placeholderNameFromEmail } from '@/lib/signup';

/** True for any letter outside the Latin script — Hebrew, Cyrillic, Arabic, CJK. */
export function hasNonLatinLetters(raw: unknown): boolean {
  const text = typeof raw === 'string' ? raw : '';
  for (const ch of text) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

/**
 * Capitalise a word the member left entirely lower-case, hyphens and apostrophes
 * included ('bar-on' → 'Bar-On', "o'neill" → "O'Neill").
 *
 * A word that already carries a capital is returned untouched: the member knows
 * how their own name is spelled better than a rule does, and forcing title case
 * on it is how 'McDonald' becomes 'Mcdonald'.
 */
function capitaliseWord(word: string): string {
  if (/\p{Lu}/u.test(word)) return word;
  return word.replace(/\p{L}+/gu, part => part[0].toUpperCase() + part.slice(1));
}

/**
 * The name as it should be stored: trimmed, single-spaced, sensibly capitalised.
 * Script-agnostic on purpose — a Hebrew name still gets its trailing space taken
 * off, because rejecting the script is a separate decision from cleaning the
 * whitespace, and one row on prod carried exactly that trailing space.
 */
export function normalizeDisplayName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitaliseWord)
    .join(' ');
}

export type NameProblem = 'empty' | 'not-latin';

/**
 * What is wrong with a name a member just typed, or null when nothing is.
 *
 * 'not-latin' also covers a name with no letters at all ('123', '---'): there is
 * no message worth writing for that case separately, and "please use English
 * letters" is true advice for both.
 */
export function nameProblem(raw: unknown): NameProblem | null {
  const name = normalizeDisplayName(raw);
  if (!name) return 'empty';
  if (hasNonLatinLetters(name)) return 'not-latin';
  if (!/\p{Script=Latin}/u.test(name)) return 'not-latin';
  return null;
}

/**
 * The name to store on the roster when a provider hands us one, or null to leave
 * the row alone.
 *
 * Strava owns the roster name — that rule stands, and it is what stops one person
 * appearing under two spellings. But it is now bounded: a Strava profile written
 * in Hebrew must not overwrite a Latin name already on the row. Without that
 * bound, every name corrected on the roster is silently reverted by its owner's
 * next Strava login, which is exactly how the cleanup of 2026-09-11 would have
 * undone itself within a day.
 *
 * A row whose name is still non-Latin has nothing to protect, so the provider's
 * value wins there — a real Hebrew name beats a "Strava 12345" placeholder, and
 * asking is what the profile screen is for.
 */
export function rosterNameFromProvider(
  incoming: string | null | undefined,
  current: string | null | undefined,
  currentIsPlaceholder = false,
): string | null {
  const next = normalizeDisplayName(incoming);
  const held = normalizeDisplayName(current);
  if (!next || next === held) return null;
  if (!hasNonLatinLetters(next)) return next;
  // Non-Latin from here down. It replaces only a name that is not protecting
  // anything: another non-Latin name, nothing at all, or a placeholder this app
  // wrote for itself — a real Hebrew name is worth more than "Strava 12345".
  if (!held || currentIsPlaceholder) return next;
  return hasNonLatinLetters(held) ? next : null;
}

/**
 * Is this the name the app invented, rather than one a person gave?
 *
 * Two shapes: placeholderNameFromEmail() ("grosfeldofer" out of an address, used
 * by the /register approval and the invite flow) and "Strava <id>" from the OAuth
 * callback when Strava held no name either. Both are placeholders and neither is
 * worth defending against a real name in any script.
 */
export function isPlaceholderRosterName(
  name: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const held = (name || '').trim();
  if (!held) return true;
  if (/^Strava \d+$/.test(held)) return true;
  return !!email && held === placeholderNameFromEmail(email);
}

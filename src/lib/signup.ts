/**
 * Pure helpers for the two doors into `signup_requests` (migration 083): the
 * public /register form and a Strava sign-in by somebody the club has never seen.
 * Here rather than inline in the routes so they can be tested without a database.
 */

/**
 * Deliberately loose. This gate exists to catch typos on a form, not to
 * adjudicate RFC 5322 — a real address is proven by the approval email arriving,
 * which is the next step anyway.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isLikelyEmail(value: string | null | undefined): boolean {
  return !!value && EMAIL_RE.test(value.trim());
}

/** Lower/trim, so the pending-email unique index (which does not lower()) holds. */
export function normaliseEmail(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * `athletes.name` is NOT NULL, and the register form never asks for a name — the
 * point of it is that it asks for two things. So an approved request seeds the
 * athlete row from the email's local part, and /join/{token} overwrites it with
 * the real name in the very next step.
 *
 * Something name-shaped is the least confusing thing to show in the member list
 * during the minutes (or days) in between: an approver scanning the list sees
 * "Dana Levi", not "dana.levi92@gmail.com" or a blank.
 */
export function placeholderNameFromEmail(email: string): string {
  const local = normaliseEmail(email).split('@')[0] || '';
  const words = local
    // Digits go with the separators: "dana.levi92" is a person called Dana Levi.
    .replace(/[._\-+]+/g, ' ')
    .replace(/\d+/g, ' ')
    .split(' ')
    .map(w => w.trim())
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));

  // An address with nothing name-like in it at all ("42@x.com", "___@x.com")
  // falls back to the address itself rather than to an empty string, which the
  // NOT NULL column would reject and which nobody could act on.
  return words.length ? words.join(' ') : normaliseEmail(email);
}

/**
 * Would a human reading this string on a lock screen know WHO it is?
 *
 * Three things reach the sign-up alert already shaped like a name and identify
 * nobody, and all three were shipped as if they were names:
 *
 *  - an email address, because the public form has no name field, so the route
 *    handed the address over as the name;
 *  - the synthetic `strava_<id>@strava.madregot.local`, which is an address the
 *    app invented and no human has ever seen;
 *  - a provider placeholder. Strava answers firstname "Strava" / lastname
 *    "Athlete" for an account whose real name it will not disclose, and our own
 *    Strava callback falls back to "Strava <id>" so a fresh row is never nameless.
 *
 * The last one is what the admin actually got on 2026-09-11: "Strava Athlete ·
 * 26 בקשות ממתינות לאישור", which says a person exists and nothing else.
 */
export function isHumanName(value: string | null | undefined): boolean {
  const name = (value || '').trim();
  if (!name) return false;
  // No name has an @ in it; every address does, synthetic ones included.
  if (name.includes('@')) return false;
  return !/^strava[\s_-]*(athlete|user|runner|\d+)?$/i.test(name);
}

/**
 * The best name the system can honestly put in the staff sign-up alert, or null
 * when it knows none.
 *
 * Resolved HERE, at the point the sources are in hand, rather than in the push
 * copy — the copy gets one string and cannot tell "this is what Strava calls
 * them" from "this is the address we made up for them", which is how the
 * synthetic address became the thing a coach was shown.
 *
 * Best-first, and the order is the point:
 *
 *  1. `athletes.name` — a roster name a human typed, or one a Strava login
 *     already folded a duplicate into. The most likely to be the name the club
 *     uses for this person.
 *  2. what the identity provider calls them, for a stranger whose row was created
 *     seconds ago and therefore holds nothing better.
 *  3. the email's local part, and only from a REAL address. Deriving it from the
 *     synthetic one yields "Strava", which would read as a name and be a lie.
 *
 * Null rather than a filler string, so the caller's own locale-aware "someone"
 * is the single place that wording lives.
 */
export function signupAlertName(input: {
  /** `athletes.name` for the row behind the request, when there is one. */
  athleteName?: string | null;
  /** Strava's own display name, or null when it disclosed nothing usable. */
  providerName?: string | null;
  /** Any address in hand — real or the synthetic Strava one. */
  email?: string | null;
}): string | null {
  for (const candidate of [input.athleteName, input.providerName]) {
    if (isHumanName(candidate)) return (candidate as string).trim();
  }

  const email = (input.email || '').trim();
  // `.local` is the synthetic JWT domain — the same test entryHandles() and
  // realEmail() apply in lib/admin/entry-queue, for the same reason.
  if (isLikelyEmail(email) && !email.toLowerCase().endsWith('.local')) {
    const derived = placeholderNameFromEmail(email);
    // placeholderNameFromEmail falls back to the address itself for a local part
    // with no letters in it ("42@x.co"); that is right for a NOT NULL column and
    // wrong for a push notification, so it is filtered out here and not there.
    if (isHumanName(derived)) return derived;
  }

  return null;
}

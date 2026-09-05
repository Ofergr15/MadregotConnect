/**
 * Pure helpers for the public /register flow (migration 083, signup_requests).
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

// The pending applicant's view of their own request (BUILD-BRIEF gaps 2, 3, 7).
//
// A person who has just submitted the public form has no account and no session,
// so /api/auth/me cannot tell them whether they were let in. The signup response
// hands their app ONE random secret (kept in the Keychain); only its SHA-256 is
// stored (migration 189). POST /api/public/signup/status with {id, secret} answers
// for that one row and nothing else.
//
// What it may answer is the whole security argument, so it is fixed here:
//   status    pending | approved | declined
//   approvers first names of the staff the request is routed to (gap 7)
//   createdAt when they sent it (the screen prints it)
//   notify    'email' once they opted in
//   session   ONCE, on approval — the "lands signed-in" grant (gap 2)
// Never an email, an id of anyone else, or the group of anyone but them.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** 32 random bytes, base64url: unguessable, and fine in a JSON body. */
export function newStatusSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashStatusSecret(secret: string): string {
  return createHash('sha256').update(`signup-status-v1:${secret}`).digest('base64url');
}

export function statusSecretMatches(secret: unknown, storedHash: string | null | undefined): boolean {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 128 || !storedHash) return false;
  const h = hashStatusSecret(secret);
  if (h.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(storedHash));
}

export type PublicSignupStatus = 'pending' | 'approved' | 'declined';

/** signup_requests.status → what the applicant is told. 'member' never reaches here
 *  (no secret is issued for it); anything unknown reads as still pending. */
export function publicStatusFor(rowStatus: string | null | undefined): PublicSignupStatus {
  if (rowStatus === 'approved') return 'approved';
  if (rowStatus === 'rejected' || rowStatus === 'declined') return 'declined';
  return 'pending';
}

/** "Yoav Cohen" → "Yoav". Drops blanks, de-duplicates, keeps the order given. */
export function firstNames(names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const n of names) {
    const first = (n || '').trim().split(/\s+/)[0];
    if (first && !out.includes(first)) out.push(first);
  }
  return out;
}

/**
 * How the app phrases the approvers (kept here too so web and tests agree):
 * 1–2 names → "יואב או רון מהצוות", more → "יואב, רון ועוד", none → "צוות המועדון".
 */
export function approverPhrase(names: string[]): string {
  if (names.length === 0) return 'צוות המועדון';
  if (names.length === 1) return `${names[0]} מהצוות`;
  if (names.length === 2) return `${names[0]} או ${names[1]} מהצוות`;
  return `${names[0]}, ${names[1]} ועוד`;
}

/**
 * Best-effort limiter for the public status route, per request id and per client.
 * In memory, so per serverless instance: it is a brake on hammering, not the
 * protection — the 256-bit secret is. Polling every 12 s is ~5/min; 30/min is slack.
 */
const WINDOW_MS = 60_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

export function rateLimited(key: string, now = Date.now()): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return recent.length > LIMIT;
}

export function __resetRateLimit() {
  hits.clear();
}

import { APP_URL } from '@/lib/constants';

/**
 * The two doors into the academy form, and what keeps the public one honest.
 *
 *   Door A — staff press "send invite" on a funnel card. The mail carries
 *            /academy-register?i={candidate.invite_token}; the form opens with the
 *            name, email and phone already filled, and the submit lands on THAT card.
 *   Door B — the Instagram bio link, /academy?src=ig. No token: the submit finds the
 *            card by email or makes a new one.
 *
 * Pure helpers only, so the rules are testable without a database.
 */

/** A personal link is good for a month; after that the form still works, it just
 *  stops pre-filling and falls back to door B's match-by-email. */
export const INVITE_TTL_DAYS = 30;

export function isInviteFresh(invitedAt: string | null | undefined, now = new Date()): boolean {
  if (!invitedAt) return false;
  const t = new Date(invitedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t <= INVITE_TTL_DAYS * 86_400_000;
}

/** 32 hex chars: the same shape as athletes.invite_token. */
export function looksLikeToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

export function inviteUrl(token: string, base = APP_URL): string {
  return `${base}/academy-register?i=${token}`;
}

/** The funnel's `source` for a card the form itself creates, from the `src` param.
 *  Only the two values the funnel knows; an invited card keeps the one it has. */
export function sourceFromParam(src: unknown): 'instagram' | 'form' {
  return src === 'ig' || src === 'instagram' ? 'instagram' : 'form';
}

/** Split a stored full name back into the form's two fields. */
export function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

/**
 * The honeypot: a field no person sees (off-screen, aria-hidden, tabIndex -1). A
 * bot that fills every input fills it too. Its submit is answered exactly like a
 * real one, so the bot learns nothing, and nothing is written.
 */
export const HONEYPOT_FIELD = 'website';

export function isBotSubmit(body: Record<string, unknown> | null | undefined): boolean {
  const v = body?.[HONEYPOT_FIELD];
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * A fixed-window limiter, per key (the caller's IP), in this instance's memory.
 *
 * Best effort by design: serverless instances don't share memory, so a determined
 * sender spread across instances gets more through. What it stops is the thing that
 * actually happens — one script hammering the form, and each submit mailing the
 * admin and the address it typed. No table, no migration, nothing to pay for.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { start: number; count: number }>();
  return function allow(key: string, now = Date.now()): boolean {
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      }
      return true;
    }
    h.count += 1;
    return h.count <= limit;
  };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip') || 'unknown';
}

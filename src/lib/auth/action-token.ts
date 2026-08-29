import { createHmac, timingSafeEqual } from 'crypto';

// Server-signed authorization for ONE specific action by ONE specific athlete,
// carried inside a push payload.
//
// The problem: the OS-level action buttons on a notification (✅ מגיע/ה, 👍 קודוס)
// are handled in the service worker, which has no page and no localStorage — so
// it cannot reach the Supabase session and cannot send a bearer token. Those
// handlers therefore posted a bare `athleteId` and nothing else. Once the API
// routes started requiring a verified session the RSVP buttons went dead (403 on
// every tap), and kudos stayed wide open: any caller could give kudos as anybody.
//
// This token is the credential that path was missing. It is minted per recipient
// at send time (src/lib/push.ts), so it can only ever authorize the athlete the
// notification was actually delivered to, and it is bound to a narrow scope
// string — a specific practice day, or a specific activity — so a token handed
// out for one action cannot be replayed as a different one.
//
// Replay of the SAME action is deliberately allowed: both operations behind these
// buttons are idempotent upserts, so re-tapping is a no-op rather than a wrong
// result. What matters is that the token cannot widen: not to another athlete,
// not to another day, not to another activity, not to another kind of action.
//
// Signed with ENCRYPTION_KEY under its own label rather than a new env var (same
// approach as src/lib/auth/device-token.ts), so no environment needs
// reconfiguring — the key is already required for the app to boot. An absent or
// unusable key makes both signing and verification fail, so the routes fail
// closed rather than falling back to trusting the caller.

/** Header the service worker sends the token in. */
export const ACTION_TOKEN_HEADER = 'x-action-token';

const VERSION = 'v1';
const LABEL = 'action-token-v1';

// Both notifications that carry buttons are about something imminent — a
// practice tomorrow, or a run that was just logged — so a week is already far
// longer than the button is useful for. Kept generous only so a phone left
// untouched over a holiday still works.
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Scope for the RSVP buttons: one athlete, one practice day. */
export function rsvpScope(weekStart: string, day: number | string): string {
  return `rsvp:${weekStart}:${Number(day)}`;
}

/** Scope for the kudos button: one athlete, one activity. */
export function kudosScope(activityId: string): string {
  return `kudos:${activityId}`;
}

function keyMaterial(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) return null;
  return `${key}:${LABEL}`;
}

function mac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

// athleteId and scope both go inside the signed payload. Joined with a character
// that cannot occur in a UUID or in any scope we mint, so no pair of distinct
// (athleteId, scope) inputs can produce the same signed string.
function encodePayload(athleteId: string, scope: string): string {
  return Buffer.from(`${athleteId}|${scope}`, 'utf8').toString('base64url');
}

/**
 * Mint a token authorizing `athleteId` to perform exactly `scope`.
 * Returns null when ENCRYPTION_KEY is unusable, or either argument is empty.
 */
export function signActionToken(
  athleteId: string,
  scope: string,
  issuedAtMs = Date.now(),
): string | null {
  const secret = keyMaterial();
  if (!secret) return null;
  const id = (athleteId || '').trim();
  const sc = (scope || '').trim();
  if (!id || !sc) return null;
  const body = `${VERSION}.${encodePayload(id, sc)}.${issuedAtMs}`;
  return `${body}.${mac(secret, body)}`;
}

/**
 * Does `token` authorize `athleteId` to perform `scope`?
 *
 * Takes the expected athlete and scope as arguments rather than returning what
 * the token claims, so a caller cannot forget to check them.
 */
export function verifyActionToken(
  token: string | undefined | null,
  athleteId: string | undefined | null,
  scope: string,
  nowMs = Date.now(),
): boolean {
  const secret = keyMaterial();
  if (!secret || !token || !athleteId || !scope) return false;

  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [version, payload, issuedAt, provided] = parts;
  if (version !== VERSION) return false;

  const expected = mac(secret, `${version}.${payload}.${issuedAt}`);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const issued = Number(issuedAt);
  if (!Number.isFinite(issued) || issued <= 0) return false;
  if (nowMs - issued > MAX_AGE_SECONDS * 1000) return false;
  // Stamped in the future means a tampered clock; allow a minute of skew.
  if (issued - nowMs > 60_000) return false;

  // The signature only proves the payload is ours. It still has to be the
  // payload for THIS athlete and THIS action.
  return payload === encodePayload(athleteId.trim(), scope.trim());
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  kudosScope,
  rsvpScope,
  signActionToken,
  verifyActionToken,
} from '@/lib/auth/action-token';
import { actionScopeFor } from '@/lib/push';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ACTIVITY = '33333333-3333-3333-3333-333333333333';
const NOW = 1_756_000_000_000; // fixed clock; Date.now() is unavailable in some runners

const RSVP = rsvpScope('2026-08-30', 2);

describe('action token', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  it('authorizes the athlete and scope it was signed for', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    expect(verifyActionToken(token, ME, RSVP, NOW)).toBe(true);
  });

  // The whole point: a token delivered to one athlete's device must not let the
  // holder RSVP (or kudos) as somebody else.
  it('does not authorize a different athlete', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    expect(verifyActionToken(token, OTHER, RSVP, NOW)).toBe(false);
  });

  it('does not authorize a different practice day or week', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    expect(verifyActionToken(token, ME, rsvpScope('2026-08-30', 5), NOW)).toBe(false);
    expect(verifyActionToken(token, ME, rsvpScope('2026-09-06', 2), NOW)).toBe(false);
  });

  it('does not let an RSVP token give kudos, or vice versa', () => {
    const rsvpToken = signActionToken(ME, RSVP, NOW)!;
    const kudosToken = signActionToken(ME, kudosScope(ACTIVITY), NOW)!;
    expect(verifyActionToken(rsvpToken, ME, kudosScope(ACTIVITY), NOW)).toBe(false);
    expect(verifyActionToken(kudosToken, ME, RSVP, NOW)).toBe(false);
  });

  it('does not authorize kudos on a different activity', () => {
    const token = signActionToken(ME, kudosScope(ACTIVITY), NOW)!;
    expect(verifyActionToken(token, ME, kudosScope(OTHER), NOW)).toBe(false);
  });

  it('rejects a token signed with a different key', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    expect(verifyActionToken(token, ME, RSVP, NOW)).toBe(false);
  });

  it('rejects a token whose payload was swapped for another athlete', () => {
    const token = signActionToken(OTHER, RSVP, NOW)!;
    const [v, , iat, mac] = token.split('.');
    const forged = Buffer.from(`${ME}|${RSVP}`, 'utf8').toString('base64url');
    expect(verifyActionToken(`${v}.${forged}.${iat}.${mac}`, ME, RSVP, NOW)).toBe(false);
  });

  it('rejects a token whose timestamp was swapped', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    const [v, payload, , mac] = token.split('.');
    expect(verifyActionToken(`${v}.${payload}.${NOW + 5000}.${mac}`, ME, RSVP, NOW)).toBe(false);
  });

  it('rejects malformed, empty and missing tokens', () => {
    for (const bad of [undefined, null, '', 'garbage', 'v1.a.b', 'v1.a.b.c.d']) {
      expect(verifyActionToken(bad as string | undefined, ME, RSVP, NOW)).toBe(false);
    }
  });

  it('rejects a token older than a week', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    const day = 24 * 60 * 60 * 1000;
    expect(verifyActionToken(token, ME, RSVP, NOW + 8 * day)).toBe(false);
    // still good just inside the window
    expect(verifyActionToken(token, ME, RSVP, NOW + 6 * day)).toBe(true);
  });

  it('rejects a token stamped in the future beyond clock skew', () => {
    expect(verifyActionToken(signActionToken(ME, RSVP, NOW + 5 * 60_000)!, ME, RSVP, NOW)).toBe(false);
    // a few seconds of skew is tolerated
    expect(verifyActionToken(signActionToken(ME, RSVP, NOW + 5_000)!, ME, RSVP, NOW)).toBe(true);
  });

  it('refuses to sign or verify without an athlete and a scope', () => {
    expect(signActionToken('', RSVP, NOW)).toBeNull();
    expect(signActionToken(ME, '', NOW)).toBeNull();
    const token = signActionToken(ME, RSVP, NOW)!;
    expect(verifyActionToken(token, '', RSVP, NOW)).toBe(false);
    expect(verifyActionToken(token, ME, '', NOW)).toBe(false);
  });

  it('fails closed when ENCRYPTION_KEY is missing or too short', () => {
    const token = signActionToken(ME, RSVP, NOW)!;
    delete process.env.ENCRYPTION_KEY;
    expect(signActionToken(ME, RSVP, NOW)).toBeNull();
    expect(verifyActionToken(token, ME, RSVP, NOW)).toBe(false);

    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(signActionToken(ME, RSVP, NOW)).toBeNull();
    expect(verifyActionToken(token, ME, RSVP, NOW)).toBe(false);
  });

  // rsvpScope coerces the day so a string from a JSON body and a number from the
  // send path can't disagree and silently produce two different scopes.
  it('builds the same rsvp scope from a string or numeric day', () => {
    expect(rsvpScope('2026-08-30', '2')).toBe(rsvpScope('2026-08-30', 2));
  });
});

// The mint side (src/lib/push.ts, at send time) and the verify side (the route,
// on the way back in) each compute the scope independently. A token is only
// useful if they agree — and a disagreement would look exactly like the bug this
// whole change fixes: a dead button holding a perfectly valid token.
describe('minted scope matches what the routes recompute', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY;
  });

  it('rsvp: push payload scope === the scope /api/attendance derives from its body', () => {
    // What the reminder sends (cron/tick), day as a number.
    const minted = actionScopeFor({ title: 't', body: 'b', rsvp: { weekStart: '2026-08-30', day: 2 } });
    // What the route computes from the POSTed JSON, where day arrives unnormalised.
    expect(minted).toBe(rsvpScope('2026-08-30', 2));
    expect(minted).toBe(rsvpScope('2026-08-30', '2'));
    // End to end through a real token, as the button actually does it.
    const token = signActionToken(ME, minted!, NOW)!;
    expect(verifyActionToken(token, ME, rsvpScope('2026-08-30', '2'), NOW)).toBe(true);
  });

  it('kudos: push payload scope === the scope the route derives from its [id] param', () => {
    const minted = actionScopeFor({ title: 't', body: 'b', kudosActivityId: ACTIVITY });
    expect(minted).toBe(kudosScope(ACTIVITY));
    const token = signActionToken(ME, minted!, NOW)!;
    expect(verifyActionToken(token, ME, kudosScope(ACTIVITY), NOW)).toBe(true);
  });

  it('is null for a payload with no action buttons, so no token is minted', () => {
    expect(actionScopeFor({ title: 't', body: 'b' })).toBeNull();
  });
});

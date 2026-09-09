import { describe, expect, it } from 'vitest';
import { membershipFor, BLOCKED_MEMBERSHIPS } from '@/lib/auth/membership';
import {
  APPROVAL_EXEMPT_PREFIXES,
  blockedFromApp,
  pathnameOf,
  requiresApproval,
} from '@/lib/auth/approval-gate';
import { computeSilencedAthleteIds } from '@/lib/push';

/**
 * The two pure decisions behind the approval gate.
 *
 * Why they are worth pinning: both used to be an inline expression, and both got
 * the same class of thing wrong. `membership` was `status === 'active' ? 'active' :
 * 'inactive'`, which told a brand-new applicant that their access had been taken
 * away; and every send path assumed a push subscription implies a usable account,
 * so somebody stuck on the waiting screen was still getting the club's morning
 * feed notifications. The fix in both cases is one function, so these are its
 * tests.
 */

describe('membershipFor — which of the four states an account is in', () => {
  it('is active for an active row, whatever approved says', () => {
    expect(membershipFor({ status: 'active', approved: true })).toBe('active');
    // status wins: an active member with a stale approved flag is inside already.
    expect(membershipFor({ status: 'active', approved: false })).toBe('active');
  });

  it('is pending — not inactive — for somebody who has never been approved', () => {
    // This is the whole bug. A Strava sign-in lands here, and "your access is not
    // active" reads as a punishment for someone who just signed up.
    expect(membershipFor({ status: 'invited', approved: false })).toBe('pending');
  });

  it('is inactive for an approved account that is no longer active', () => {
    expect(membershipFor({ status: 'inactive', approved: true })).toBe('inactive');
  });

  it('falls back to inactive when approved could not be read', () => {
    // An older deploy, or a select that failed on the column. 'inactive' is the
    // answer that promises nothing — 'pending' would tell them to sit and wait
    // for an approval nobody is going to be asked for.
    expect(membershipFor({ status: 'invited' })).toBe('inactive');
    expect(membershipFor({ status: 'invited', approved: null })).toBe('inactive');
  });

  it('keeps every non-active state on the blocked list', () => {
    // The layout narrows against this list. If a fifth state is ever added to
    // membershipFor and not to the list, this fails instead of letting people in.
    for (const status of ['invited', 'inactive', 'pending', 'archived']) {
      expect(BLOCKED_MEMBERSHIPS).toContain(membershipFor({ status, approved: false }));
      expect(BLOCKED_MEMBERSHIPS).toContain(membershipFor({ status, approved: true }));
    }
    expect(BLOCKED_MEMBERSHIPS).not.toContain('active');
  });
});

describe('blockedFromApp — who the server turns away, which is NARROWER than the screen', () => {
  const of = (status: string | null, approved?: boolean | null) =>
    blockedFromApp({ membership: membershipFor({ status, approved }), athleteStatus: status });

  it('turns away an account that was never approved', () => {
    // The hole: a stranger's Strava sign-in mints a real session on an
    // approved: false row, and every route served it club content.
    expect(of('invited', false)).toBe('pending-approval');
  });

  it('turns away revoked access', () => {
    expect(of('inactive', true)).toBe('account-inactive');
  });

  it('lets an active member through, whatever approved says', () => {
    expect(of('active', true)).toBeNull();
    expect(of('active', false)).toBeNull();
  });

  it('does NOT turn away a row that is neither refused nor revoked', () => {
    // membershipFor calls these 'inactive' because an absent `approved` promises
    // nothing — right for a waiting screen, wrong for a 403 on all 174 routes.
    // These are pre-approval-flow rows (2 of the club's 23), and blocking them
    // would lock out real members while buying no security.
    expect(of('invited')).toBeNull();
    expect(of('invited', null)).toBeNull();
    expect(of(null)).toBeNull();
    expect(of('archived', true)).toBeNull();
  });
});

describe('requiresApproval — which routes an unapproved session may still call', () => {
  it('closes club content', () => {
    for (const path of ['/api/feed', '/api/plans', '/api/groups', '/api/athletes', '/api/admin/approve']) {
      expect(requiresApproval(path)).toBe(true);
    }
  });

  it('leaves the waiting experience reachable', () => {
    // Every one of these is how somebody LEARNS they are pending, or how they ask
    // to be told when that changes. Blocking them turns the waiting screen into a
    // spinner, which is indistinguishable from being signed out.
    for (const path of ['/api/auth/me', '/api/maintenance', '/api/join/groups', '/api/claim/abc', '/api/push/subscribe', '/api/public/groups']) {
      expect(requiresApproval(path)).toBe(false);
    }
  });

  it('closes a route by default', () => {
    // The old design's failure mode was opt-in: a new route that forgot to gate
    // itself served the club to anybody. A path nobody listed must come back true.
    expect(requiresApproval('/api/some-route-added-next-year')).toBe(true);
    expect(requiresApproval('')).toBe(true);
  });

  it('cannot be talked past with a query string or casing', () => {
    expect(pathnameOf(new Request('https://x.test/api/feed?next=/api/auth/me'))).toBe('/api/feed');
    expect(requiresApproval('/API/Auth/me')).toBe(false);
    // A prefix must match at the START — an exempt name buried in the path is not
    // an exemption.
    expect(requiresApproval('/api/feed/api/maintenance')).toBe(true);
  });

  it('treats an unreadable URL as not exempt', () => {
    // A gate that cannot tell which route it is on has to answer "gated".
    expect(requiresApproval(pathnameOf(new Request('https://x.test/')))).toBe(true);
  });

  it('exempts only /api paths', () => {
    // Nothing outside /api goes through requireSession, but if the list ever grew a
    // bare prefix like '/dashboard' it would exempt a whole tree by accident.
    for (const prefix of APPROVAL_EXEMPT_PREFIXES) expect(prefix.startsWith('/api/')).toBe(true);
  });
});

describe('computeSilencedAthleteIds — who must not be notified', () => {
  it('silences anyone the shell would refuse to let in', () => {
    const silenced = computeSilencedAthleteIds([
      { id: 'in', status: 'active' },
      { id: 'waiting', status: 'invited' },
      { id: 'revoked', status: 'inactive' },
    ]);
    expect([...silenced].sort()).toEqual(['revoked', 'waiting']);
  });

  it('silences a row whose status is missing or null', () => {
    // Same predicate as the gate — anything that is not the literal 'active' is
    // somebody who cannot open the app, so a notification is at best noise and at
    // worst a leak of club activity to an account that was cut off.
    expect(computeSilencedAthleteIds([{ id: 'a', status: null }, { id: 'b' }]).size).toBe(2);
  });

  it('silences nobody when everyone is active', () => {
    expect(computeSilencedAthleteIds([{ id: 'a', status: 'active' }]).size).toBe(0);
  });

  it('says nothing about an id it was not given a row for', () => {
    // Fails OPEN by construction: the caller keeps every subscription whose
    // athlete_id is absent from this set. Staff living in `coaches` rather than
    // `athletes` still get their management pushes.
    expect(computeSilencedAthleteIds([]).has('legacy-coach')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { membershipFor, BLOCKED_MEMBERSHIPS } from '@/lib/auth/membership';
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

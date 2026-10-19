import { describe, expect, it } from 'vitest';
import { buildMember, type MemberInput } from '@/lib/onboarding/funnel';
import { CLUB_STAGES, laneStages, placeClubMember } from '@/lib/onboarding/journey';

/**
 * "I want to press a step and see who is stuck there" (2026-10-19): every person
 * sits at exactly one step — the first they have not reached — with the wait
 * measured from the last step they did reach.
 */
const NOW = new Date('2026-10-19T12:00:00Z');
const base: MemberInput = {
  athleteId: 'a1', name: 'Noa Levi', source: 'public-form', requestedAt: '2026-10-10T10:00:00Z', requestStatus: 'pending',
  approvedAt: null, firstSeenAt: null, lastSeenAt: null, garminAt: null, hasGarmin: false, hasStrava: false,
  tourSeenAt: null, setupDoneAt: null, phoneOpenedAt: null, push: [], events: [],
};
const place = (over: Partial<MemberInput>, extra: { requestStatus?: string | null; strava?: boolean; notifyEmail?: string | null } = {}) => {
  const input = { ...base, ...over };
  return placeClubMember({ member: buildMember(input, NOW), requestId: 'r1', requestStatus: extra.requestStatus ?? input.requestStatus, strava: extra.strava, notifyEmail: extra.notifyEmail }, NOW);
};

describe('where each club member stands', () => {
  it('waiting for approval for 9 days: at "approved", stuck, and it is on the staff', () => {
    const p = place({});
    expect(p.at).toBe('approved');
    expect(p.owner).toBe('staff');
    expect(p.stuck).toBe(true);
    expect(Math.round(p.waitingHours / 24)).toBe(9);
  });

  it('approved but never opened the link: at "link", waiting since the approval', () => {
    const p = place({ approvedAt: '2026-10-16T08:00:00Z' }, { requestStatus: 'approved' });
    expect(p.at).toBe('link');
    expect(p.owner).toBe('member');
    expect(p.waitingSince).toBe('2026-10-16T08:00:00Z');
    expect(p.stuck).toBe(true);
  });

  it('a Strava sign-in has no link to open: approved moves them straight to installing', () => {
    const p = place({ source: 'strava-login', approvedAt: '2026-10-19T09:00:00Z' }, { requestStatus: 'approved', strava: true, notifyEmail: null });
    expect(p.at).toBe('installed');
    expect(p.stuck).toBe(false); // three hours is not stuck
    expect(p.strava).toBe(true);
    expect(p.notifyEmail).toBeNull();
  });

  it('through every step and seen this week: done, on no list', () => {
    const p = place({
      approvedAt: '2026-10-10T12:00:00Z', firstSeenAt: '2026-10-10T13:00:00Z', lastSeenAt: '2026-10-18T07:00:00Z',
      phoneOpenedAt: '2026-10-10T13:00:00Z', hasGarmin: true, push: [{ at: '2026-10-10T13:05:00Z', device: 'iphone' }],
      events: [{ step: 'join_open', at: '2026-10-10T12:30:00Z', device: 'iphone', source: 'event' }],
    }, { requestStatus: 'approved' });
    expect(p.at).toBeNull();
    expect(p.stuck).toBe(false);
  });

  it('everything done but gone quiet for a week: back at "active this week", stuck', () => {
    const p = place({
      approvedAt: '2026-10-01T12:00:00Z', firstSeenAt: '2026-10-01T13:00:00Z', lastSeenAt: '2026-10-05T07:00:00Z',
      phoneOpenedAt: '2026-10-01T13:00:00Z', hasStrava: true, push: [{ at: '2026-10-01T13:05:00Z', device: 'android' }],
    }, { requestStatus: 'approved' });
    expect(p.at).toBe('active');
    expect(p.stuck).toBe(true);
    expect(p.waitingSince).toBe('2026-10-05T07:00:00Z');
  });

  it('a turned-down request stands at no step', () => {
    const p = place({ requestStatus: 'rejected' }, { requestStatus: 'rejected' });
    expect(p.at).toBeNull();
    expect(p.stuck).toBe(false);
  });
});

describe('the lane counts', () => {
  it('counts who reached each step and who is standing at it', () => {
    const people = [place({}), place({ approvedAt: '2026-10-16T08:00:00Z' }, { requestStatus: 'approved' })];
    const stages = laneStages(CLUB_STAGES, people);
    const get = (k: string) => stages.find((s) => s.key === k)!;
    expect(get('requested')).toMatchObject({ reached: 2, at: 0 });
    expect(get('approved')).toMatchObject({ reached: 1, at: 1, stuck: 1 });
    expect(get('link')).toMatchObject({ reached: 0, at: 1, stuck: 1 });
  });
});

describe('test accounts are not joiners', () => {
  it('drops the seeded accounts, +test sign-ups, our own .local addresses and the club mailbox — never a Strava sign-in', async () => {
    const { isTestJoiner } = await import('@/lib/onboarding/journey');
    const ids = new Set(['t1']);
    expect(isTestJoiner([], 't1', ids)).toBe(true);
    expect(isTestJoiner(['grosfeldofer+test2@gmail.com'], null, ids)).toBe(true);
    expect(isTestJoiner(['test-coach@madregot.local'], null, ids)).toBe(true);
    expect(isTestJoiner(['madregot.club@gmail.com'], null, ids)).toBe(true);
    expect(isTestJoiner(['strava_1@strava.madregot.local'], null, ids)).toBe(false);
    expect(isTestJoiner(['noa@gmail.com'], 'a1', ids)).toBe(false);
  });
});

describe('the funnel never grows down the lane', () => {
  it('logged in from a browser without installing still stands at "installed" and is not counted past it', () => {
    const p = place({
      approvedAt: '2026-10-16T08:00:00Z', firstSeenAt: '2026-10-16T09:00:00Z', lastSeenAt: '2026-10-18T09:00:00Z', hasStrava: true,
      events: [{ step: 'join_open', at: '2026-10-16T08:30:00Z', device: 'computer', source: 'event' }],
    }, { requestStatus: 'approved' });
    expect(p.at).toBe('installed');
    const stages = laneStages(CLUB_STAGES, [p]);
    const counts = stages.map((s) => s.reached);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(stages.find((s) => s.key === 'logged_in')!.reached).toBe(0);
    // How long the link step took: approval 08:00 → opened 08:30.
    expect(stages.find((s) => s.key === 'link')!.medianHours).toBe(0.5);
  });
});

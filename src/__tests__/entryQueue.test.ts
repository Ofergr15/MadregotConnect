import { describe, expect, it } from 'vitest';
import {
  entryHandles,
  entryStage,
  isWaitingOnUs,
  matchesFilter,
  matchesFilters,
  realEmail,
  sortEntryQueue,
  stageCounts,
  type EntryQueueMember,
} from '@/lib/admin/entry-queue';

/**
 * The entry queue's stage rule.
 *
 * There are two independent doors — `athletes.approved` and the maintenance
 * allowlist — and they used to be answered on two screens, which is how approving
 * somebody during a maintenance window became a no-op nobody noticed: they moved
 * from "not approved" to "approved and still blocked" and their phone showed the
 * same closed door either way. One stage per person, from both doors.
 */

const base = { approved: true, blocked: false, lastSeenAt: '2026-09-01T08:00:00Z', hasWatch: true, hasPush: true };

describe('entryStage', () => {
  it('calls an unapproved signup pending, whatever else is true', () => {
    expect(entryStage({ ...base, approved: false })).toBe('pending');
    // Even blocked as well: "not a member yet" is the useful thing to say, and the
    // same tap fixes both.
    expect(entryStage({ ...base, approved: false, blocked: true })).toBe('pending');
  });

  it('calls an approved member the window holds out blocked', () => {
    expect(entryStage({ ...base, blocked: true })).toBe('blocked');
  });

  it('separates "nothing is stopping them" from "they never came"', () => {
    expect(entryStage({ ...base, lastSeenAt: null })).toBe('never');
  });

  it('counts only the watch and notifications as unfinished setup', () => {
    // NOT the full setup score: 26 of 28 members have no phone or shirt size and
    // never will, so scoring on those would put the whole club in one bucket.
    expect(entryStage({ ...base, hasWatch: false })).toBe('setup');
    expect(entryStage({ ...base, hasPush: false })).toBe('setup');
    expect(entryStage(base)).toBe('ready');
  });

  it('knows which stages are the club\'s problem and not the member\'s', () => {
    expect(isWaitingOnUs('pending')).toBe(true);
    expect(isWaitingOnUs('blocked')).toBe(true);
    expect(isWaitingOnUs('never')).toBe(false);
    expect(isWaitingOnUs('setup')).toBe(false);
    expect(isWaitingOnUs('ready')).toBe(false);
  });
});

describe('entryHandles', () => {
  it('writes the athlete id, which is the handle everybody has', () => {
    expect(entryHandles({ id: 'a1', email: null })).toEqual(['a1']);
  });

  it('adds a real address so the list stays readable to a human', () => {
    expect(entryHandles({ id: 'a1', email: 'Dana@Example.com' })).toEqual(['a1', 'dana@example.com']);
  });

  it('never writes the synthetic Strava address', () => {
    // An entry that can never match the person it was meant to let in is exactly
    // how maintenance mode locked out 100% of the club on 2026-09-07.
    expect(entryHandles({ id: 'a1', email: 'strava_106828158@strava.madregot.local' })).toEqual(['a1']);
  });
});

describe('realEmail', () => {
  it('hides the synthetic address rather than showing it as contactable', () => {
    expect(realEmail('strava_1@strava.madregot.local')).toBeNull();
    expect(realEmail('')).toBeNull();
    expect(realEmail('dana@example.com')).toBe('dana@example.com');
  });
});

const member = (over: Partial<EntryQueueMember>): EntryQueueMember => ({
  id: over.id || 'x',
  name: over.name || 'x',
  email: null,
  groupName: null,
  approved: true,
  approvedAt: null,
  lastSeenAt: null,
  createdAt: null,
  blocked: false,
  hasGarmin: false,
  hasStrava: false,
  hasPush: false,
  setupDone: 0,
  setupTotal: 5,
  stage: 'ready',
  ...over,
});

describe('sortEntryQueue', () => {
  it('puts the people the club is holding out first, longest wait at the top', () => {
    const sorted = sortEntryQueue([
      member({ id: 'ready', stage: 'ready' }),
      member({ id: 'newPending', stage: 'pending', createdAt: '2026-09-06T00:00:00Z' }),
      member({ id: 'blocked', stage: 'blocked', createdAt: '2026-01-01T00:00:00Z' }),
      member({ id: 'oldPending', stage: 'pending', createdAt: '2026-08-30T00:00:00Z' }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['oldPending', 'newPending', 'blocked', 'ready']);
  });

  it('sorts a row with no signup date last inside its stage, not first', () => {
    const sorted = sortEntryQueue([
      member({ id: 'undated', stage: 'pending', createdAt: null }),
      member({ id: 'dated', stage: 'pending', createdAt: '2026-09-01T00:00:00Z' }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['dated', 'undated']);
  });
});

describe('stageCounts', () => {
  it('counts every stage, including the ones nobody is in', () => {
    expect(
      stageCounts([
        member({ stage: 'pending' }),
        member({ stage: 'pending' }),
        member({ stage: 'ready' }),
      ]),
    ).toEqual({ pending: 2, blocked: 0, never: 0, setup: 0, ready: 1 });
  });

  it('is all zeros for an empty club rather than an empty object', () => {
    // The bar at the top divides by the total; a missing key would render NaN%.
    expect(stageCounts([])).toEqual({ pending: 0, blocked: 0, never: 0, setup: 0, ready: 0 });
  });
});

describe('matchesFilter', () => {
  it('reads "no watch" off credentials, not off data_source', () => {
    // All 28 members have a declared source and only 17 have anything behind it,
    // which is the whole reason this filter exists.
    expect(matchesFilter(member({ hasGarmin: false, hasStrava: false }), 'noWatch')).toBe(true);
    expect(matchesFilter(member({ hasStrava: true }), 'noWatch')).toBe(false);
  });

  it('flags no notifications, never entered and no דבוקה', () => {
    expect(matchesFilter(member({ hasPush: false }), 'noPush')).toBe(true);
    expect(matchesFilter(member({ hasPush: true }), 'noPush')).toBe(false);
    expect(matchesFilter(member({ lastSeenAt: null }), 'neverEntered')).toBe(true);
    expect(matchesFilter(member({ lastSeenAt: '2026-09-01T00:00:00Z' }), 'neverEntered')).toBe(false);
    expect(matchesFilter(member({ groupName: null }), 'noGroup')).toBe(true);
    expect(matchesFilter(member({ groupName: 'SUB 2:30' }), 'noGroup')).toBe(false);
  });
});

describe('matchesFilters', () => {
  it('ANDs them — the person with two problems is the one to chase', () => {
    const both = member({ hasPush: false, hasGarmin: false, hasStrava: false });
    const onlyPush = member({ hasPush: false, hasStrava: true });
    expect(matchesFilters(both, ['noPush', 'noWatch'])).toBe(true);
    expect(matchesFilters(onlyPush, ['noPush', 'noWatch'])).toBe(false);
  });

  it('lets everybody through when nothing is filtered', () => {
    expect(matchesFilters(member({ hasPush: true, hasStrava: true }), [])).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  FLOW_STEPS,
  flowFunnel,
  flowGroup,
  memberFlow,
  sortByFlow,
  type EntryQueueMember,
} from '@/lib/admin/entry-queue';

/**
 * The entry flow — the six steps between signing up and being a working member.
 *
 * The rule these tests exist to protect: "started logging in" and "got into the
 * app" are SEPARATE steps. They come apart in production because an iOS standalone
 * PWA sends the Strava login into the in-app browser sheet, whose storage the app
 * cannot read, so a member logs in successfully and never lands inside (migration
 * 082). Collapsing the two — which the five-stage model did — made that person
 * indistinguishable from somebody who never tried, and the two need opposite help.
 */

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

/** Somebody all the way through, as the baseline to break one step at a time. */
const complete: Partial<EntryQueueMember> = {
  approved: true,
  blocked: false,
  authAccountAt: '2026-07-01T00:00:00Z',
  lastSignInAt: '2026-09-01T00:00:00Z',
  lastSeenAt: '2026-09-01T00:00:00Z',
  hasGarmin: true,
  hasPush: true,
  setupDone: 5,
  setupTotal: 5,
};

describe('memberFlow', () => {
  it('stops at approval for a signup nobody has accepted', () => {
    const flow = memberFlow(member({ ...complete, approved: false }));
    expect(flow.stuckAt).toBe('approved');
    expect(flow.reached).toBe(1);
  });

  it('stops at approval for an approved member the window holds out', () => {
    // Both doors, one step: the same tap opens either, so telling them apart on the
    // track would be a distinction with no action behind it. The card's sentence is
    // what says which one it is.
    const flow = memberFlow(member({ ...complete, blocked: true }));
    expect(flow.stuckAt).toBe('approved');
  });

  it('separates "never tried to log in" from "logged in and never got in"', () => {
    const neverTried = memberFlow(member({ ...complete, authAccountAt: null, lastSignInAt: null, lastSeenAt: null }));
    expect(neverTried.stuckAt).toBe('loginStarted');

    // The iOS sheet case: an auth account and a sign-in, no last_seen_at. THE case
    // this whole model exists for.
    const sheetEaten = memberFlow(member({ ...complete, lastSeenAt: null }));
    expect(sheetEaten.stuckAt).toBe('loggedIn');
    expect(sheetEaten.reached).toBe(3);
  });

  it('treats being inside the app as proof of a login, whatever the auth listing says', () => {
    // A last_seen_at cannot exist without the session that stamped it, so a missing
    // auth row is a gap in OUR reading, never evidence they didn't log in.
    const flow = memberFlow(member({ ...complete, authAccountAt: null, lastSignInAt: null }));
    expect(flow.steps[2].done).toBe(true);
    expect(flow.stuckAt).toBe(null);
  });

  it('says "unknown" rather than "never tried" when the auth listing failed', () => {
    const flow = memberFlow(
      member({ ...complete, loginKnown: false, authAccountAt: null, lastSignInAt: null, lastSeenAt: null }),
    );
    expect(flow.steps[2].unknown).toBe(true);
    // It must not park them on the step we couldn't read — the next real gap is
    // the honest answer.
    expect(flow.stuckAt).toBe('loggedIn');
  });

  it('takes either credential as a connected watch, and neither as none', () => {
    expect(memberFlow(member({ ...complete, hasGarmin: false, hasStrava: true })).stuckAt).toBe(null);
    expect(memberFlow(member({ ...complete, hasGarmin: false, hasStrava: false })).stuckAt).toBe('watch');
  });

  it('holds the profile step until every scored task is done', () => {
    expect(memberFlow(member({ ...complete, setupDone: 4 })).stuckAt).toBe('profile');
    expect(memberFlow(member({ ...complete, setupDone: 5 })).stuckAt).toBe(null);
  });

  it('marks a later step passed without pretending the order was obeyed', () => {
    // The club backfill wrote Garmin credentials for members who have never opened
    // the app. `watch` is genuinely done; `reached` must still stop at the gap.
    const flow = memberFlow(member({ ...complete, lastSeenAt: null, authAccountAt: null, lastSignInAt: null }));
    expect(flow.steps[FLOW_STEPS.indexOf('watch')].done).toBe(true);
    expect(flow.reached).toBe(2);
    expect(flow.stuckAt).toBe('loginStarted');
  });

  it('always counts signing up as done — it is why they are on the screen', () => {
    expect(memberFlow(member({})).steps[0].done).toBe(true);
  });
});

describe('flowFunnel', () => {
  it('counts how far people got with no step skipped', () => {
    const funnel = flowFunnel([
      member({ ...complete }),
      member({ ...complete, approved: false }),
      member({ ...complete, lastSeenAt: null }),
    ]);
    expect(funnel.signedUp).toBe(3);
    expect(funnel.approved).toBe(2);
    expect(funnel.loginStarted).toBe(2);
    expect(funnel.loggedIn).toBe(1);
    expect(funnel.profile).toBe(1);
  });

  it('never counts somebody past a gap, even with the later step done', () => {
    // Otherwise the card reads "7 connected a watch" under "1 got in", and the two
    // numbers together describe nobody.
    const funnel = flowFunnel([member({ ...complete, lastSeenAt: null, authAccountAt: null, lastSignInAt: null })]);
    expect(funnel.loginStarted).toBe(0);
    expect(funnel.watch).toBe(0);
  });

  it('is all zeros for an empty club rather than an empty object', () => {
    // The funnel's bars divide by the total; a missing key would render NaN%.
    expect(flowFunnel([])).toEqual({
      signedUp: 0, approved: 0, loginStarted: 0, loggedIn: 0, watch: 0, profile: 0,
    });
  });
});

describe('flowGroup', () => {
  it("puts only what the coach can act on in 'mine'", () => {
    expect(flowGroup(member({ ...complete, approved: false }))).toBe('mine');
    expect(flowGroup(member({ ...complete, blocked: true }))).toBe('mine');
  });

  it('groups both login failures together — they take the same reminder', () => {
    expect(flowGroup(member({ ...complete, authAccountAt: null, lastSignInAt: null, lastSeenAt: null }))).toBe('login');
    expect(flowGroup(member({ ...complete, lastSeenAt: null }))).toBe('login');
  });

  it('separates the watch from the rest of the profile', () => {
    expect(flowGroup(member({ ...complete, hasGarmin: false }))).toBe('watch');
    expect(flowGroup(member({ ...complete, setupDone: 3 }))).toBe('profile');
  });

  it("calls somebody with nothing left 'ready'", () => {
    expect(flowGroup(member({ ...complete }))).toBe('ready');
  });
});

describe('sortByFlow', () => {
  it('puts the furthest behind first, longest wait at the top of each step', () => {
    const sorted = sortByFlow([
      member({ id: 'ready', ...complete }),
      member({ id: 'newPending', ...complete, approved: false, createdAt: '2026-09-06T00:00:00Z' }),
      member({ id: 'noWatch', ...complete, hasGarmin: false }),
      member({ id: 'oldPending', ...complete, approved: false, createdAt: '2026-08-30T00:00:00Z' }),
    ]).map((m) => m.id);
    expect(sorted).toEqual(['oldPending', 'newPending', 'noWatch', 'ready']);
  });

  it('sorts a row with no created_at last rather than letting it jump the queue', () => {
    const sorted = sortByFlow([
      member({ id: 'undated', ...complete, approved: false }),
      member({ id: 'dated', ...complete, approved: false, createdAt: '2026-08-30T00:00:00Z' }),
    ]).map((m) => m.id);
    expect(sorted).toEqual(['dated', 'undated']);
  });
});

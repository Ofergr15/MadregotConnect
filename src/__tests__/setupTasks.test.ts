import { describe, expect, it } from 'vitest';
import {
  SETUP_TASK_KEYS,
  SETUP_INFO_KEYS,
  computeSetupState,
  hasWorkingSource,
  type SetupInput,
} from '@/lib/onboarding/setup-tasks';

// The scoring behind the setup card's percentage. The cases below are the club's
// REAL states, measured across all 28 members before this was built — the point
// of the file is that a future edit to the task list can't silently move
// somebody's percentage without one of these failing.

/** Nobody: no credentials, no photo, nothing filled. The state 6 members are in. */
const EMPTY: SetupInput = {
  hasGarminAuth: false,
  hasStravaAuth: false,
  dataSource: null,
  avatarUrl: null,
  phone: null,
  birthDate: null,
  gender: null,
  shirtSize: null,
  shoeSize: null,
  pushSubscriptions: 0,
  groupName: null,
  hasActiveShoe: false,
};

const FULL: SetupInput = {
  hasGarminAuth: true,
  hasStravaAuth: false,
  dataSource: 'garmin',
  avatarUrl: 'https://example.test/a.jpg',
  phone: '050-0000000',
  birthDate: '1985-04-01',
  gender: 'male',
  shirtSize: 'L',
  shoeSize: '43',
  pushSubscriptions: 1,
  groupName: 'דבוקה 1',
  hasActiveShoe: true,
};

describe('hasWorkingSource', () => {
  it('needs real credentials, not a declared data_source', () => {
    // The trap this guards: all 28 members have data_source set, only 17 have
    // credentials. Scoring on the declaration told 11 people they were connected
    // while nothing synced.
    expect(hasWorkingSource({ hasGarminAuth: false, hasStravaAuth: false })).toBe(false);
    expect(hasWorkingSource({ hasGarminAuth: true, hasStravaAuth: false })).toBe(true);
    expect(hasWorkingSource({ hasGarminAuth: false, hasStravaAuth: true })).toBe(true);
  });
});

describe('computeSetupState', () => {
  it('scores five tasks, so the percentage lands on clean twenties', () => {
    expect(SETUP_TASK_KEYS).toHaveLength(5);
    expect(computeSetupState(EMPTY).totalCount).toBe(5);
    expect(computeSetupState(EMPTY).pct).toBe(0);
    expect(computeSetupState(FULL).pct).toBe(100);
    expect(computeSetupState({ ...FULL, avatarUrl: null }).pct).toBe(80);
    expect(computeSetupState({ ...EMPTY, avatarUrl: 'x' }).pct).toBe(20);
  });

  it('reaches 100% without a pace group or an active shoe', () => {
    // The reason both are unscored: the coach assigns the group (9 of 28 have
    // none) and 0 of 28 members have an active shoe. In the denominator, either
    // one would cap the whole club below 100% forever.
    const state = computeSetupState({ ...FULL, groupName: null, hasActiveShoe: false });
    expect(state.pct).toBe(100);
    expect(state.allDone).toBe(true);
  });

  it('counts a declared-but-unconnected source as unfinished, and keeps the label', () => {
    const state = computeSetupState({ ...EMPTY, dataSource: 'garmin' });
    const watch = state.tasks.find((t) => t.key === 'watch')!;
    expect(watch.done).toBe(false);
    // Still reported, because "Garmin, not synced" is the useful sublabel.
    expect(watch.meta?.source).toBe('garmin');
    expect(state.pct).toBe(0);
  });

  it('needs every field of a multi-field task, and reports the partial count', () => {
    const partial = computeSetupState({ ...EMPTY, phone: '050-0000000', shirtSize: 'L' });
    const personal = partial.tasks.find((t) => t.key === 'personalInfo')!;
    const sizes = partial.tasks.find((t) => t.key === 'sizes')!;
    expect(personal.done).toBe(false);
    expect(personal.meta).toEqual({ filled: 1, total: 3 });
    expect(sizes.done).toBe(false);
    expect(sizes.meta).toEqual({ filled: 1, total: 2 });
    expect(partial.pct).toBe(0);
  });

  it('treats whitespace as unfilled', () => {
    const state = computeSetupState({ ...FULL, phone: '   ', avatarUrl: '' });
    expect(state.tasks.find((t) => t.key === 'personalInfo')!.done).toBe(false);
    expect(state.tasks.find((t) => t.key === 'photo')!.done).toBe(false);
    expect(state.pct).toBe(60);
  });

  it('counts notifications from a live subscription row only', () => {
    expect(computeSetupState({ ...EMPTY, pushSubscriptions: 0 }).tasks.find((t) => t.key === 'notifications')!.done).toBe(false);
    expect(computeSetupState({ ...EMPTY, pushSubscriptions: 2 }).tasks.find((t) => t.key === 'notifications')!.done).toBe(true);
  });

  it('walks nextKey through the task list in order and clears it at the end', () => {
    expect(computeSetupState(EMPTY).nextKey).toBe('watch');
    expect(computeSetupState({ ...EMPTY, hasGarminAuth: true }).nextKey).toBe('photo');
    expect(computeSetupState(FULL).nextKey).toBeNull();
  });

  it('marks an unassigned pace group as waiting on somebody else, not as a task', () => {
    const unassigned = computeSetupState(EMPTY).info.find((i) => i.key === 'paceGroup')!;
    expect(unassigned.done).toBe(false);
    expect(unassigned.waiting).toBe(true);

    const assigned = computeSetupState(FULL).info.find((i) => i.key === 'paceGroup')!;
    expect(assigned.done).toBe(true);
    expect(assigned.waiting).toBe(false);
    expect(assigned.meta?.groupName).toBe('דבוקה 1');
  });

  it('never marks the active shoe as waiting — nobody owes it to you', () => {
    const shoe = computeSetupState(EMPTY).info.find((i) => i.key === 'activeShoe')!;
    expect(shoe.waiting).toBe(false);
    expect(SETUP_INFO_KEYS).toEqual(['paceGroup', 'activeShoe']);
  });

  it('returns every task and info row in a stable order', () => {
    expect(computeSetupState(EMPTY).tasks.map((t) => t.key)).toEqual([...SETUP_TASK_KEYS]);
    expect(computeSetupState(EMPTY).info.map((i) => i.key)).toEqual([...SETUP_INFO_KEYS]);
  });
});

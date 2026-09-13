import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_DELAY_MINUTES, SNAPSHOT_LATEST_MINUTES, snapshotChannel, snapshotDue,
  snapshotLedgerTag, snapshotRows, snapshotWorthSending,
} from '@/lib/onboarding/setup-snapshot';
import { computeSetupState, type SetupInput } from '@/lib/onboarding/setup-tasks';
import { setupSnapshotCopy, snapshotRowCopy } from '@/lib/notifications/copy';

// ═════════════════════════════════════════════════════════════════════════════
// The 15-minute snapshot. Three properties matter more than any wording here:
// somebody who finished gets silence, one channel carries it, and it happens once.
// ═════════════════════════════════════════════════════════════════════════════

const NOW = Date.parse('2026-09-13T18:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const EMPTY: SetupInput = {
  hasGarminAuth: false, hasStravaAuth: false, dataSource: null, avatarUrl: null,
  phone: null, birthDate: null, gender: null, shirtSize: null, pantsSize: null,
  tightsSize: null, socksSize: null, shoeSize: null, pushSubscriptions: 0,
  groupName: null, hasActiveShoe: false,
};

const FINISHED: SetupInput = {
  ...EMPTY, hasStravaAuth: true, avatarUrl: 'a.jpg', phone: '050', birthDate: '1990-01-01',
  gender: 'male', shirtSize: 'M', pantsSize: 'M', tightsSize: 'M', socksSize: 'L',
  shoeSize: '43', pushSubscriptions: 1,
};

describe('the window', () => {
  it('fires 15 minutes after the app first opened, not before', () => {
    expect(snapshotDue({ firstSeenAt: minutesAgo(14) }, NOW)).toBe(false);
    expect(snapshotDue({ firstSeenAt: minutesAgo(SNAPSHOT_DELAY_MINUTES) }, NOW)).toBe(true);
  });

  it('stays open long enough to survive a skipped tick, then closes', () => {
    // The tick runs every 5 minutes, so a single instant would be lossy.
    expect(snapshotDue({ firstSeenAt: minutesAgo(20) }, NOW)).toBe(true);
    expect(snapshotDue({ firstSeenAt: minutesAgo(SNAPSHOT_LATEST_MINUTES) }, NOW)).toBe(true);
    // An hour later it would be describing somebody else's session.
    expect(snapshotDue({ firstSeenAt: minutesAgo(60) }, NOW)).toBe(false);
  });

  it('never fires without a first-open timestamp — including a garbled one', () => {
    expect(snapshotDue({ firstSeenAt: null }, NOW)).toBe(false);
    expect(snapshotDue({ firstSeenAt: 'not a date' }, NOW)).toBe(false);
  });
});

describe('who gets it', () => {
  it('says nothing at all to somebody who finished', () => {
    expect(snapshotWorthSending(computeSetupState(FINISHED))).toBe(false);
    expect(snapshotWorthSending(computeSetupState(EMPTY))).toBe(true);
  });

  it('picks exactly one channel, push first', () => {
    expect(snapshotChannel({ hasPush: true, email: 'a@b.com' })).toBe('push');
    expect(snapshotChannel({ hasPush: false, email: 'a@b.com' })).toBe('email');
    // A Strava-only sign-in: realEmail() strips the synthetic address to null.
    expect(snapshotChannel({ hasPush: false, email: null })).toBe('none');
  });

  it('keys the ledger per athlete, so it can only happen once', () => {
    expect(snapshotLedgerTag('abc')).toBe('setupSnapshot:abc');
    expect(snapshotLedgerTag('abc')).not.toBe(snapshotLedgerTag('def'));
  });
});

describe('what it says', () => {
  it('lists what is done before what is missing', () => {
    const setup = computeSetupState({ ...EMPTY, pushSubscriptions: 1, avatarUrl: 'a.jpg' });
    const rows = snapshotRows(setup);
    expect(rows.slice(0, 2).every((r) => r.done)).toBe(true);
    expect(rows.slice(2).every((r) => !r.done)).toBe(true);
    expect(rows).toHaveLength(setup.totalCount);
  });

  it('leads with the score and names what is left', () => {
    const setup = computeSetupState({ ...EMPTY, pushSubscriptions: 1, phone: '050', birthDate: '1990-01-01', gender: 'male' });
    const copy = setupSnapshotCopy('he', {
      name: 'Dana',
      doneCount: setup.doneCount,
      total: setup.totalCount,
      gaps: setup.tasks.filter((t) => !t.done).map((t) => t.key),
    });
    expect(copy.title).toBe('Dana, 2 מתוך 5 מוגדרים');
    expect(copy.body).toContain('חיבור שעון');
    expect(copy.body).toContain('מידות');
  });

  it('tells a member who declared a source but has no credentials what is actually wrong', () => {
    // 28 members have data_source, 17 have credentials — this is the state that
    // makes "connect a watch" read as nonsense to somebody who already did.
    const setup = computeSetupState({ ...EMPTY, dataSource: 'garmin' });
    const watch = snapshotRows(setup).find((r) => r.key === 'watch');
    expect(watch?.source).toBe('garmin');
    expect(snapshotRowCopy('he', watch!).hint).toContain('בחרת Garmin');
  });

  it('describes a finished row as a state, not as a chore', () => {
    expect(snapshotRowCopy('he', { key: 'notifications', done: true }).hint).toBe('מופעלות');
    expect(snapshotRowCopy('he', { key: 'notifications', done: false }).hint).toContain('תזכורות');
  });

  it('has both languages for every scored row', () => {
    for (const key of ['watch', 'photo', 'personalInfo', 'sizes', 'notifications']) {
      for (const locale of ['he', 'en'] as const) {
        const copy = snapshotRowCopy(locale, { key, done: false });
        expect(copy.name).not.toBe(key);
        expect(copy.hint.length).toBeGreaterThan(0);
      }
    }
  });
});

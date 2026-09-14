import { describe, expect, it } from 'vitest';
import {
  NUDGE_MAX_DAYS,
  nudgeAllowed,
  nudgeDayKey,
  nudgeLedgerKey,
  readNudgeLedger,
  recordNudgeShown,
  skipNudge,
} from '@/lib/onboarding/nudge-ledger';

/**
 * How often the in-feed setup card may appear.
 *
 * This is the whole restraint of the feature and none of it is visible in a
 * screenshot: the card sits at the top of the feed, which is the one screen
 * every member opens, so the difference between a reminder and the feed's new
 * permanent header is entirely in these rules.
 *
 * The one that is easy to get backwards is rule 3: the cap is on DAYS, not on
 * renders. A day that has already shown the card must keep showing it for the
 * rest of that day, or a reload — or a feed → profile → feed hop, which is
 * exactly what the card asks people to do — makes it vanish mid-session and
 * reads as a bug.
 */

const fresh = () => readNudgeLedger(null);

describe('setup nudge ledger', () => {
  it('shows the card on a device that has never seen it', () => {
    expect(nudgeAllowed(fresh(), '2026-09-14')).toBe(true);
  });

  it('keeps showing it for the rest of a day it has already been shown on', () => {
    const ledger = recordNudgeShown(fresh(), '2026-09-14');
    expect(nudgeAllowed(ledger, '2026-09-14')).toBe(true);
    // ...and spending the same day twice must not eat one of the three.
    expect(recordNudgeShown(ledger, '2026-09-14').days).toEqual(['2026-09-14']);
  });

  it('stops for good after three distinct days', () => {
    let ledger = fresh();
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-16']) {
      expect(nudgeAllowed(ledger, day)).toBe(true);
      ledger = recordNudgeShown(ledger, day);
    }
    expect(ledger.days).toHaveLength(NUDGE_MAX_DAYS);
    expect(nudgeAllowed(ledger, '2026-09-17')).toBe(false);
    // Not "three in a row" — three ever. A gap of a month doesn't refill it.
    expect(nudgeAllowed(ledger, '2026-11-01')).toBe(false);
  });

  it('never comes back after דלג, even on a day it had not used yet', () => {
    // The labelled skip is only honest if it is terminal — and it is safe to
    // offer at all because the header pill does NOT go with it.
    const ledger = skipNudge(fresh());
    expect(nudgeAllowed(ledger, '2026-09-14')).toBe(false);
    expect(nudgeAllowed(ledger, '2027-01-01')).toBe(false);
  });

  it('survives a corrupt or half-written stored value', () => {
    // The worst acceptable outcome is one extra appearance; throwing here would
    // take the feed down with it.
    expect(readNudgeLedger('not json')).toEqual({ days: [], skipped: false });
    expect(readNudgeLedger('{"days":"nope"}')).toEqual({ days: [], skipped: false });
    expect(readNudgeLedger('{"days":[1,"2026-09-14"],"skipped":"yes"}')).toEqual({
      days: ['2026-09-14'],
      skipped: false,
    });
  });

  it('counts the local day, not the UTC one', () => {
    // 02:00 in Israel is still yesterday in UTC, and "once a day" means the
    // member's day — otherwise an early-morning open gets a second appearance.
    const local = new Date(2026, 8, 14, 2, 30);
    expect(nudgeDayKey(local)).toBe('2026-09-14');
    expect(nudgeDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('keys the ledger per athlete', () => {
    // One phone does get handed around, and the super user's "view as" must not
    // spend a real member's three days.
    expect(nudgeLedgerKey('a-1')).not.toBe(nudgeLedgerKey('a-2'));
  });
});

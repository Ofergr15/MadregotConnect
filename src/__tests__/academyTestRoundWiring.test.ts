import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The round's wiring, asserted by reading the source.
 *
 * `academyTestRound.test.ts` proves who a round invites and `academyTestRoundRoute.test.ts` proves
 * what the write does with a list. Neither can see the thing that connects them: the sheet may
 * send `round.members` and nothing else. There is no @testing-library/react in this repo, so this
 * is the same technique `athleteProfileLinks.test.ts` uses — the point is to stop a CLASS of
 * regression, not to re-test behaviour that already has real tests.
 */

const SRC = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, SRC), 'utf8');

const sheet = read('components/academy/TestRoundSheet.tsx');
const registry = read('components/academy/TestRegistry.tsx');
const invite = read('components/academy/InviteToTestSheet.tsx');
const picker = read('components/academy/OfferTimesPicker.tsx');

describe('the round sends the list it showed', () => {
  it('posts the members of the built round, never the raw candidates', () => {
    // The whole safety property of the preview. `candidates` is the registry's entire roster —
    // people with a current test and people already invited included — and posting that would
    // ask a coach to confirm four names and then invite eighteen.
    expect(sheet).toContain('athleteIds: round.members.map(m => m.athleteId)');
    expect(sheet).not.toContain('athleteIds: candidates');
  });

  it('cannot be sent with nobody in it or no time offered', () => {
    expect(sheet).toContain('disabled={busy || slots.length === 0 || round.members.length === 0}');
  });

  it('builds the round from the candidates and the open invitations, not from its own rules', () => {
    expect(sheet).toContain('buildRound(candidates, openInvitations)');
    // No second staleness comparison in the component: `overdue` arrives decided.
    expect(sheet).not.toContain('STALE_TEST_DAYS');
  });

  it('learns who is already invited from the board the coach is looking at', () => {
    expect(sheet).toContain("'/api/academy/test-invitation/board'");
    expect(sheet).toContain('invite?.athleteId');
  });

  it('still opens when that read fails, and says that it could not check', () => {
    // A round that refuses to open because one GET failed is worse than a round whose preview is
    // one name too long: the write refuses duplicates per athlete and reports them.
    expect(sheet).toContain('setUnchecked(true)');
    expect(sheet).toContain('uncheckedInvitations &&');
  });
});

describe('where the round is started from', () => {
  it('hangs off the stale banner, which is the sentence it answers', () => {
    // Up to the start of the `else` branch — `lastIndexOf`, because the comment explaining the
    // button quotes the all-current sentence too.
    const banner = registry.slice(
      registry.indexOf('stale.length > 0'),
      registry.lastIndexOf('לכולם יש טסט עדכני'),
    );
    expect(banner).toContain('onStartRound');
  });

  it('keeps the list view mountable without a sheet, so the preview harness still works', () => {
    expect(registry).toContain('onStartRound?: () => void');
    expect(registry).toContain('{onStartRound && (');
  });

  it('hands the round the registry rows the coach is reading, unfiltered', () => {
    expect(registry).toContain('candidates={registry.rows}');
  });
});

describe('one picker, not two', () => {
  it('lives in OfferTimesPicker and nowhere else', () => {
    // Every number in that grid was measured (seven columns over 44px at 375px, the 48px cells,
    // the 16px time input that stops iOS zooming inside a sheet). A second copy would start
    // identical and drift into a 42px tap target on whichever screen nobody re-audited.
    expect(picker).toContain('WEEKDAY_INITIALS');
    expect(sheet).not.toContain('WEEKDAY_INITIALS');
    expect(invite).not.toContain('WEEKDAY_INITIALS');
    for (const file of [sheet, invite]) {
      expect(file).toContain("from './OfferTimesPicker'");
      expect(file).toContain('<OfferTimesPicker');
    }
  });

  it('shares the cap rule, so a round and a single invitation agree what "up to three" means', () => {
    expect(picker).toContain('export function toggleDay(');
    for (const file of [sheet, invite]) expect(file).toContain('toggleDay(prev, day)');
  });
});

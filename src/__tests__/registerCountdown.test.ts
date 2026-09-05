import { describe, expect, it } from 'vitest';
import { countdownUnits, msToLaunch } from '@/app/register/page';

/**
 * The /register countdown.
 *
 * The launch moved from Wednesday to Thursday 20:00 on 2026-09-05, and the day is a
 * single number in the source that nothing else checks — a reader cannot tell 3 from
 * 4 by looking, and getting it wrong shows the wrong date to every person who opens
 * the link the club sends out. Hence a test rather than a careful glance.
 *
 * Local time throughout, which is what the component uses: everyone reading this page
 * is in Israel, and the launch is an Israeli evening.
 */

const H = 3_600_000;
const DAY = 86_400_000;
/** 2026-09-05 is a Saturday, so this walks a whole week from a known weekday. */
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m, 0, 0);

describe('msToLaunch — Thursday 20:00', () => {
  it('lands exactly on a Thursday at 20:00 from every day of the week', () => {
    // 2026-09-06 Sun … 2026-09-12 Sat.
    for (let d = 6; d <= 12; d++) {
      const now = at(d, 9, 30);
      const target = new Date(now.getTime() + msToLaunch(now));
      expect(target.getDay(), `from ${now.toDateString()}`).toBe(4); // 4 = Thursday
      expect(target.getHours()).toBe(20);
      expect(target.getMinutes()).toBe(0);
      expect(target.getSeconds()).toBe(0);
    }
  });

  it('counts the hours, not the days, once it is launch day', () => {
    // Thursday 2026-09-10, 08:00 → 12h to go, so the display flips to h/m/s.
    expect(msToLaunch(at(10, 8))).toBe(12 * H);
  });

  it('rolls to the next week instead of counting backwards after the launch hour', () => {
    // ⚠️ The bug this guards. Without the roll-forward, Thursday 20:01 gives a
    // negative and the page shows a countdown running the wrong way — or, once
    // clamped, a frozen row of zeros for six days.
    const justAfter = msToLaunch(at(10, 20, 1));
    expect(justAfter).toBeGreaterThan(6 * DAY);
    expect(justAfter).toBeLessThanOrEqual(7 * DAY);
  });

  it('is a day later than the Wednesday it used to be', () => {
    // The whole point of the 2026-09-05 change, stated as an assertion so a revert
    // to `3` fails here rather than quietly showing yesterday.
    const now = at(7, 12); // Monday
    const target = new Date(now.getTime() + msToLaunch(now));
    expect(target.getDate()).toBe(10); // Thursday, not the 9th
  });
});

describe('countdownUnits', () => {
  it('shows days, hours and minutes while the launch is more than a day away', () => {
    const units = countdownUnits(4 * DAY + 3 * H + 14 * 60_000);
    expect(units.map((u) => u.label)).toEqual(['ימים', 'שעות', 'דקות']);
    expect(units.map((u) => u.value)).toEqual([4, 3, 14]);
  });

  it('drops days for seconds inside the last 24 hours, so it visibly ticks', () => {
    const units = countdownUnits(23 * H + 59 * 60_000 + 7_000);
    expect(units.map((u) => u.label)).toEqual(['שעות', 'דקות', 'שניות']);
    expect(units.map((u) => u.value)).toEqual([23, 59, 7]);
  });

  it('always shows exactly three units, so nothing shifts at the boundary', () => {
    for (const ms of [0, 1_000, DAY - 1, DAY, DAY + 1, 6 * DAY]) {
      expect(countdownUnits(ms)).toHaveLength(3);
    }
  });

  it('switches at exactly 24 hours', () => {
    expect(countdownUnits(DAY)[0].label).toBe('ימים');
    expect(countdownUnits(DAY - 1)[0].label).toBe('שעות');
  });

  it('never renders a negative number if the device clock is skewed', () => {
    // A phone whose clock is ahead of the launch would otherwise show "-1 שניות".
    expect(countdownUnits(-5_000).map((u) => u.value)).toEqual([0, 0, 0]);
  });

  it('zero-pads only the units that would otherwise jitter every tick', () => {
    const far = countdownUnits(4 * DAY + 3 * H + 4 * 60_000);
    expect(far.find((u) => u.label === 'ימים')?.pad).toBeFalsy();
    expect(far.find((u) => u.label === 'דקות')?.pad).toBe(true);
    const near = countdownUnits(3 * H + 4 * 60_000 + 4_000);
    expect(near.find((u) => u.label === 'שניות')?.pad).toBe(true);
  });
});

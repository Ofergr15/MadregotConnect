import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  DOUBLE_EVENING_HOUR, EVENING_LOOKAHEAD_HOUR, SESSION_MIN_KM, pickNextSession,
  sessionsDone,
} from '@/lib/plans/next-session';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * The feed's "what's next" box. Every rule pinned here is one of his, and each
 * one is about a moment the box would otherwise be wrong: before 20:00, after the
 * run, and in the middle of a double.
 */

const S = (kmMin: number, kmMax = kmMin) => ({ kmMin, kmMax });
const TODAY = '2026-09-15';
const TOMORROW = '2026-09-16';

const pick = (
  plan: Record<string, Array<{ kmMin: number }>>,
  hour: number,
  runsKmByDate: Record<string, number[]> = {},
) => pickNextSession({
  sessionsFor: (key) => plan[key] || [],
  todayKey: TODAY, tomorrowKey: TOMORROW, hour, runsKmByDate,
});

describe('counting a day off', () => {
  it('ticks off one session per logged run', () => {
    expect(sessionsDone([S(10), S(8)], [10.2])).toBe(1);
    expect(sessionsDone([S(10), S(8)], [10.2, 8.1])).toBe(2);
  });

  it('ignores a stray trace shorter than the floor', () => {
    expect(sessionsDone([S(10)], [SESSION_MIN_KM - 0.1])).toBe(0);
    expect(sessionsDone([S(10)], [SESSION_MIN_KM])).toBe(1);
  });

  it('counts a double run as one continuous session when the day is covered', () => {
    // 18 km in one go over a 10 + 8 day: both halves are done, and offering the
    // "second" session to somebody who just finished it is the bug this prevents.
    expect(sessionsDone([S(10), S(8)], [18.4])).toBe(2);
  });

  it('never claims more sessions than the day has', () => {
    expect(sessionsDone([S(5)], [6, 6, 6])).toBe(1);
  });

  it('says nothing about a rest day', () => {
    expect(sessionsDone([], [12])).toBe(0);
  });
});

describe('before the evening', () => {
  it("offers today's session while it is still owed", () => {
    const next = pick({ [TODAY]: [S(12)] }, 9);
    expect(next?.isToday).toBe(true);
    expect(next?.date).toBe(TODAY);
    expect(next?.total).toBe(1);
  });

  it('goes away once the session is run', () => {
    expect(pick({ [TODAY]: [S(12)] }, 9, { [TODAY]: [12.4] })).toBeNull();
  });

  it('does not look at tomorrow yet — an all-day box says the same thing all day', () => {
    expect(pick({ [TOMORROW]: [S(14)] }, 19)).toBeNull();
  });

  it('is silent on a rest day', () => {
    expect(pick({}, 11)).toBeNull();
  });
});

describe('a double day', () => {
  it('switches to the second session instead of vanishing', () => {
    const next = pick({ [TODAY]: [S(10), S(8)] }, 17, { [TODAY]: [10.1] });
    expect(next?.index).toBe(2);
    expect(next?.total).toBe(2);
    expect(next?.session.kmMin).toBe(8);
  });

  it('is finished when both halves are', () => {
    expect(pick({ [TODAY]: [S(10), S(8)] }, 17, { [TODAY]: [10.1, 8.2] })).toBeNull();
  });

  it('skips to the EVENING one from noon even with the morning unlogged', () => {
    // His rule: "from 12:00 show the evening". The morning half of a double is the
    // 06:00 club run — by noon it has happened or been missed, and a Garmin that
    // never synced is the common case. Nothing logged at all here.
    const next = pick({ [TODAY]: [S(10), S(8)] }, DOUBLE_EVENING_HOUR);
    expect(next?.session.kmMin).toBe(8);
    expect(next?.index).toBe(2);
    expect(next?.total).toBe(2);
  });

  it('still names the MORNING one before noon', () => {
    const next = pick({ [TODAY]: [S(10), S(8)] }, DOUBLE_EVENING_HOUR - 1);
    expect(next?.session.kmMin).toBe(10);
    expect(next?.index).toBe(1);
  });

  it('carries tomorrow alongside it, as a second row', () => {
    const next = pick({ [TODAY]: [S(10), S(8)], [TOMORROW]: [S(14), S(6)] }, 13);
    expect(next?.date).toBe(TODAY);
    expect(next?.tomorrow?.date).toBe(TOMORROW);
    // Tomorrow's FIRST session, same as the 20:00 rollover picks.
    expect(next?.tomorrow?.session.kmMin).toBe(14);
  });

  it('carries nothing extra when tomorrow is a rest day', () => {
    expect(pick({ [TODAY]: [S(10), S(8)] }, 13)?.tomorrow).toBeUndefined();
  });

  it('never carries tomorrow on a SINGLE-session day', () => {
    // One card is the normal case; a 12:00 skip on a single day would also throw
    // away the day's only session with eight hours left to run it.
    const next = pick({ [TODAY]: [S(12)], [TOMORROW]: [S(14)] }, 13);
    expect(next?.session.kmMin).toBe(12);
    expect(next?.tomorrow).toBeUndefined();
  });
});

describe('from 20:00', () => {
  it("names tomorrow's FIRST session", () => {
    const next = pick({ [TOMORROW]: [S(6), S(14)] }, EVENING_LOOKAHEAD_HOUR);
    expect(next?.isToday).toBe(false);
    expect(next?.date).toBe(TOMORROW);
    expect(next?.index).toBe(1);
    expect(next?.session.kmMin).toBe(6);
  });

  it('prefers tomorrow over a session today that was skipped', () => {
    // 22:00 with today's run still not logged: it was skipped or shortened, and
    // sending somebody out is worse than telling them what is actually next.
    const next = pick({ [TODAY]: [S(12)], [TOMORROW]: [S(14)] }, 22);
    expect(next?.date).toBe(TOMORROW);
  });

  it('falls back to a session still owed today when tomorrow is a rest day', () => {
    const next = pick({ [TODAY]: [S(12)] }, 22);
    expect(next?.date).toBe(TODAY);
    expect(next?.isToday).toBe(true);
  });

  it('says nothing when today is done and tomorrow is rest', () => {
    expect(pick({ [TODAY]: [S(12)] }, 22, { [TODAY]: [12.3] })).toBeNull();
  });
});

describe('the feed box', () => {
  const card = read('components/feed/NextSessionCard.tsx');

  it('reads the watch and never pushes to it', () => {
    // His instruction: the athlete can see whether it arrived, and cannot ask.
    expect(card).toMatch(/useApi<WatchState>\('\/api\/my-watch'\)/);
    expect(card).not.toMatch(/method: 'POST'/);
    expect(card).not.toMatch(/sendToWatch/);
  });

  it('says nothing about the watch when there is no watch to ask about', () => {
    expect(card).toMatch(/watch\.garminConnected && watch\.hasPlan/);
  });

  it('is a green tick beside the watch, or a red watch — icon only', () => {
    expect(card).toMatch(/onWatch && <Check/);
    expect(card).toMatch(/text-accent-red/);
    // The words live in aria-label/title so the pill stays an icon.
    expect(card).toMatch(/aria-label=\{onWatch \? tw\('onWatch'\) : tw\('notOnWatch'\)\}/);
  });

  it('banners a two-a-day morning yellow and evening purple', () => {
    expect(card).toMatch(/part === 'morning' \? <Sun/);
    expect(card).toMatch(/bg-\[#FFF0C7\] text-\[#8A5A00\]/);
    expect(card).toMatch(/bg-\[#E9E4FF\] text-\[#4632B5\]/);
  });

  it('labels morning/evening only when the plan named it', () => {
    expect(card).toMatch(/s\.kind === 'morning' \|\| s\.kind === 'evening' \? s\.kind : null/);
  });

  it('opens the same sheet the Program page opens, from the same session', () => {
    expect(card).toMatch(/<WorkoutDetailModal/);
    expect(card).toMatch(/steps: x\.steps/);
    // One builder for both rows, so the chip opens the real session rather than
    // a second description of it.
    expect(card).toMatch(/setDetail\(detailFor\(s\)\)/);
    expect(card).toMatch(/setDetail\(detailFor\(nextDay\)\)/);
  });

  it('shares the timing rules rather than restating them', () => {
    expect(card).toMatch(/pickNextSession\(\{/);
    // No second copy of the 20:00 rollover or the "is it done" floor here.
    expect(card).not.toMatch(/hour >= |SESSION_MIN_KM =|EVENING_LOOKAHEAD_HOUR =/);
  });

  it('is the first block in the feed', () => {
    const feed = read('app/(app)/feed/page.tsx');
    expect(feed).toMatch(/empty:mb-0">\s*<NextSessionCard \/>/);
    expect(feed.indexOf('<NextSessionCard />')).toBeLessThan(feed.indexOf('<WeekSummaryCard />'));
  });

  it('draws the tomorrow chip only when the selector hands one over', () => {
    expect(card).toMatch(/const nextDay = next\.tomorrow\?\.session;/);
    expect(card).toMatch(/\{nextDay && \(/);
    // And it carries the same link icon, because it offers the same thing.
    expect(card.slice(card.indexOf('{nextDay && ('))).toMatch(/<Link2 /);
  });

  it('has its watch labels in both languages', () => {
    for (const f of ['../messages/he.json', '../messages/en.json']) {
      const ws = JSON.parse(read(f)).watchStatus;
      expect(ws.onWatch).toBeTruthy();
      expect(ws.notOnWatch).toBeTruthy();
    }
  });
});

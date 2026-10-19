import { describe, expect, it } from 'vitest';
import { clubWeekBody, highlightOf, qualityVerdict, storyPushCopy, storyWindow, toClubWeek, weekLabel, type WeekNumbers } from '@/lib/week-story/model';

/** "השבוע שלך": open Saturday 12:00 → Sunday 20:00 (Israel), about the Sunday–Saturday week. */
describe('the weekly story window', () => {
  it('opens Saturday at noon on the week that ends that day', () => {
    expect(storyWindow('2026-10-24', 11)).toBeNull();
    expect(storyWindow('2026-10-24', 12)).toEqual({ weekStart: '2026-10-18', weekEnd: '2026-10-24' });
  });
  it('stays through Sunday until 20:00 on the week that ended yesterday', () => {
    expect(storyWindow('2026-10-25', 19)).toEqual({ weekStart: '2026-10-18', weekEnd: '2026-10-24' });
    expect(storyWindow('2026-10-25', 20)).toBeNull();
  });
  it('is closed the rest of the week', () => {
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) expect(storyWindow(d, 12)).toBeNull();
  });
  it('labels the week like the mockup', () => {
    expect(weekLabel({ weekStart: '2026-10-18', weekEnd: '2026-10-24' })).toBe('18–24.10');
    expect(weekLabel({ weekStart: '2026-09-27', weekEnd: '2026-10-03' })).toBe('27.9–3.10');
  });
});

const base: WeekNumbers = {
  km: 42.3, runs: 4, seconds: 13260, dayKm: [8.2, 0, 12.4, 6.1, 6, 0, 21.1], lastWeekKm: 36.2,
  planShare: 0.92, sessionsDone: 5, sessionsPlanned: 6, records: [], packRank: null,
};

describe('what stands out', () => {
  it('a record first, then a full plan, the biggest week, a step up, else a kind word', () => {
    expect(highlightOf({ ...base, records: [{ label: '10 ק״מ', seconds: 2698, previous: 2740 }] }).kind).toBe('record');
    expect(highlightOf({ ...base, planShare: 1 }).kind).toBe('fullPlan');
    expect(highlightOf(base, 8).kind).toBe('bigWeek');
    expect(highlightOf(base).kind).toBe('up');
    expect(highlightOf({ ...base, lastWeekKm: 45 }).kind).toBe('easy');
  });
  it('the push: km, % of plan and the highlight', () => {
    expect(storyPushCopy({ ...base, records: [{ label: '10 ק״מ', seconds: 2698, previous: 2740 }] })).toEqual({
      title: 'השבוע שלך מוכן 🏅',
      body: '42.3 ק״מ · 92% מהתוכנית — שיא חדש ב־10 ק״מ! לחיצה לסטורי של השבוע.',
    });
    expect(storyPushCopy({ ...base, planShare: null, lastWeekKm: null }).body).toBe('42.3 ק״מ — כל ק״מ נספר. לחיצה לסטורי של השבוע.');
  });
});

describe('the club week post', () => {
  const w = { weekStart: '2026-10-18', weekEnd: '2026-10-24' };
  it('reads only its own payload', () => {
    expect(toClubWeek({ kind: 'club_week', weekStart: w.weekStart, weekEnd: w.weekEnd, km: 1284, runners: 31, records: 6, marathons: 2 })?.km).toBe(1284);
    expect(toClubWeek({ kind: 'celebration' })).toBeNull();
    expect(toClubWeek(null)).toBeNull();
  });
  it('says the week in one line', () => {
    expect(clubWeekBody({ km: 1284, runners: 31, records: 6, marathons: 2 }))
      .toBe('השבוע של כל המדרגות: 31 רצים, 1,284 ק״מ ביחד ו־6 שיאים אישיים ו־2 ריצות באורך מרתון 🏁. שבוע טוב! 💙');
    expect(clubWeekBody({ km: 300, runners: 12, records: 0, marathons: 0 })).toBe('השבוע של כל המדרגות: 12 רצים, 300 ק״מ ביחד. שבוע טוב! 💙');
  });
});

describe('the quality set verdict', () => {
  it('is the quality screen\'s: within 1″ or up to 3″ slow is on target', () => {
    expect(qualityVerdict(0).text).toBe('ביעד');
    expect(qualityVerdict(3).text).toBe('ביעד');
    expect(qualityVerdict(4)).toEqual({ text: '4″ לאט מהיעד', ok: false });
    expect(qualityVerdict(-6)).toEqual({ text: '6″ מהר מהיעד', ok: true });
  });
});

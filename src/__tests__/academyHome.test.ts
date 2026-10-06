import { describe, expect, it } from 'vitest';
import {
  AREA_OF, AREAS, defaultSectionOf, sectionAllowed, sectionForTab, subTabsOf,
} from '@/lib/academy/areas';
import {
  ageLabel, buildGrowth, buildWaiting, initialsLine, monthMoves, todayLine, todayTests, weekSquares,
} from '@/lib/academy/home';
import { DEFAULT_COACH_CAPACITY, normalizeSettings } from '@/lib/academy/settings';

/**
 * The academy staff screen's five areas and the home's numbers (mockup
 * academy-manager-v5.html). The mapping from the old fourteen `?tab=` values is
 * the part with users already depending on it — notifications out in the wild
 * carry those links.
 */

describe('areas', () => {
  it('is five areas in the mockup order', () => {
    expect(AREAS.map((a) => a.label)).toEqual(['בית', 'אנשים', 'תוכניות', 'מעקב', 'שיחות']);
  });

  it('gives a manager three people tabs and a coach one', () => {
    expect(subTabsOf('people', true).map((t) => t.label)).toEqual(['מתאמנים', 'מועמדים', 'מאמנים']);
    expect(subTabsOf('people', false).map((t) => t.section)).toEqual(['members']);
    expect(subTabsOf('plans', false).map((t) => t.label)).toEqual(['השבוע', 'ספר אימונים', 'שעונים']);
    expect(subTabsOf('track', false).map((t) => t.label)).toEqual(['ביצוע', 'טסטים', 'תוצאות']);
  });

  it('puts payments and settings behind the ⚙, in no area', () => {
    expect(AREA_OF.payments).toBeNull();
    expect(AREA_OF.settings).toBeNull();
    expect(sectionAllowed('payments', false)).toBe(false);
    expect(sectionAllowed('settings', true)).toBe(true);
  });

  it.each([
    ['overview', 'overview'], ['threads', 'threads'], ['funnel', 'funnel'], ['members', 'members'],
    ['roster', 'members'], ['registrations', 'funnel'], ['stats', 'compliance'], ['tests', 'tests'],
    ['dispatch', 'dispatch'], ['book', 'book'], ['plans', 'plans'], ['results', 'results'],
    ['payments', 'payments'], ['settings', 'settings'], ['coaches', 'coaches'],
  ])('maps the old ?tab=%s to %s for the manager', (tab, section) => {
    expect(sectionForTab(tab, true)).toBe(section);
  });

  it('lands a coach on an allowed tab of the same area', () => {
    expect(sectionForTab('funnel', false)).toBe('members');
    expect(sectionForTab('coaches', false)).toBe('members');
    expect(sectionForTab('payments', false)).toBe('overview');
    expect(sectionForTab('threads', false)).toBe('threads');
  });

  it('ignores what it does not know', () => {
    expect(sectionForTab('nope', true)).toBeNull();
    expect(sectionForTab(null, true)).toBeNull();
    expect(defaultSectionOf('track')).toBe('compliance');
  });
});

describe('growth', () => {
  const weeks = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27'];

  it('counts joiners light and the rest dark, week by week', () => {
    const g = buildGrowth({
      weeks,
      current: [{ joinedOn: null }, { joinedOn: '2026-08-01' }, { joinedOn: '2026-09-15' }, { joinedOn: '2026-09-28' }],
      left: [],
    });
    expect(g.map((w) => w.trainees)).toEqual([2, 3, 3, 4]);
    expect(g.map((w) => w.joined)).toEqual([0, 1, 0, 1]);
    expect(g.map((w) => w.existing)).toEqual([2, 2, 3, 3]);
    expect(g.every((w) => w.left === 0)).toBe(true);
  });

  it('keeps a leaver in the weeks before they left and dots the week they did', () => {
    const g = buildGrowth({
      weeks,
      current: [{ joinedOn: '2026-01-01' }],
      left: [{ joinedOn: '2026-02-01', leftOn: '2026-09-22' }, { joinedOn: '2026-02-01', leftOn: null }],
    });
    expect(g.map((w) => w.trainees)).toEqual([2, 2, 1, 1]);
    expect(g.map((w) => w.left)).toEqual([0, 0, 1, 0]);
  });

  it('counts this month’s moves', () => {
    expect(monthMoves({
      current: [{ joinedOn: '2026-10-02' }, { joinedOn: '2026-09-30' }],
      left: [{ joinedOn: '2026-10-01', leftOn: '2026-10-05' }, { joinedOn: '2026-01-01', leftOn: '2026-09-01' }],
      today: '2026-10-06',
    })).toEqual({ joined: 2, left: 1 });
  });
});

describe('today', () => {
  it('counts confirmed tests on the Israel day and names the first', () => {
    const t = todayTests([
      { status: 'confirmed', confirmedSlot: '2026-10-06T15:00:00.000Z' }, // 18:00 IDT
      { status: 'confirmed', confirmedSlot: '2026-10-06T04:00:00.000Z' }, // 07:00 IDT
      { status: 'confirmed', confirmedSlot: '2026-10-06T22:30:00.000Z' }, // 01:30 the 7th
      { status: 'proposed', confirmedSlot: '2026-10-06T10:00:00.000Z' },
    ], '2026-10-06');
    expect(t).toEqual({ count: 2, firstAt: '2026-10-06T04:00:00.000Z' });
    expect(todayLine(t)).toBe('היום: 2 טסטים · הראשון 07:00');
    expect(todayLine({ count: 1, firstAt: '2026-10-06T15:00:00.000Z' })).toBe('היום: טסט אחד · 18:00');
    expect(todayLine({ count: 0, firstAt: null })).toBeNull();
  });
});

describe('the three squares', () => {
  const m = (name: string, weekRuns: number, attention: string[] = [], approved = true) => ({
    athleteId: name, name, approved, weekRuns, plannedCount: 4, completedCount: weekRuns, completionRate: weekRuns / 4, attention,
  });

  it('puts every approved trainee in exactly one square', () => {
    const s = weekSquares([m('Dana', 3), m('Avi', 1, ['low_adherence']), m('Noa', 0, ['inactive']), m('Pending', 0, [], false)]);
    expect(s.onPlan.map((x) => x.name)).toEqual(['Dana']);
    expect(s.behind.map((x) => x.name)).toEqual(['Avi']);
    expect(s.notRun.map((x) => x.name)).toEqual(['Noa']);
  });

  it('writes initials with the rest as a count', () => {
    expect(initialsLine(['Michal Raz', 'Alon Mor', 'A', 'B', 'C'])).toBe('MR · AM · +3');
    expect(initialsLine(['Noa Barak'])).toBe('NB');
  });
});

describe('waiting for you', () => {
  const now = '2026-10-06T12:00:00.000Z';

  it('puts a person waiting on an answer above everything else, then by age', () => {
    const list = buildWaiting({
      now,
      results: 2,
      approvals: [{ athleteId: 'a', name: 'Dana', submittedAt: '2026-09-01T00:00:00.000Z' }],
      dispatch: [{ athleteId: 't', name: 'Tom Haim', sentAt: '2026-10-06T07:00:00.000Z' }, { athleteId: 'l', name: 'Lia Gal', sentAt: null }],
      threads: [{ athleteId: 'y', name: 'Yoav', waitingHours: 30 }, { athleteId: 'n', name: 'Noa', waitingHours: 2 }],
      forms: [{ id: 'c1', name: 'Lior Katz', since: '2026-10-04T12:00:00.000Z' }],
    });
    expect(list.map((w) => w.kind)).toEqual(['threads', 'form', 'dispatch', 'approvals', 'results']);
    expect(list[0]).toMatchObject({ title: '2 הודעות מחכות', sub: 'Yoav, Noa', ageHours: 30, action: 'לענות' });
    expect(list[0].target.threadId).toBeUndefined();
    expect(list[1]).toMatchObject({ title: 'טופס חדש · Lior Katz', ageHours: 48, target: { section: 'funnel', candidateId: 'c1' } });
    expect(list[2]).toMatchObject({ title: '2 לא הגיעו לשעון', ageHours: 5, target: { section: 'dispatch' } });
  });

  it('opens the one thread when only one person is waiting', () => {
    const [w] = buildWaiting({ now, threads: [{ athleteId: 'y', name: 'Yoav', waitingHours: 3 }] });
    expect(w.target).toEqual({ section: 'threads', threadId: 'y' });
  });

  it('is empty when nothing waits', () => {
    expect(buildWaiting({ now })).toEqual([]);
  });

  it('labels ages the way the mockup does', () => {
    expect(ageLabel(null)).toBeNull();
    expect(ageLabel(0.5)).toBeNull();
    expect(ageLabel(1.2)).toBe('שעה');
    expect(ageLabel(5)).toBe('5 ש׳');
    expect(ageLabel(26)).toBe('יום');
    expect(ageLabel(50)).toBe('2 ימים');
  });
});

describe('coach capacity setting', () => {
  it('defaults to eight and keeps a sane whole number', () => {
    expect(DEFAULT_COACH_CAPACITY).toBe(8);
    expect(normalizeSettings({}).coachCapacity).toBe(8);
    expect(normalizeSettings({ coachCapacity: 6 }).coachCapacity).toBe(6);
    expect(normalizeSettings({ coachCapacity: '10' }).coachCapacity).toBe(10);
    expect(normalizeSettings({ coachCapacity: 0 }).coachCapacity).toBe(8);
    expect(normalizeSettings({ coachCapacity: 500 }).coachCapacity).toBe(8);
    expect(normalizeSettings({ coachCapacity: 'x' }).coachCapacity).toBe(8);
  });
});

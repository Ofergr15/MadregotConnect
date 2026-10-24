import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  DEFAULT_COLLAGE, DEFAULT_SUMMARY, TILE_MAX, TILE_MIN, addTile, chipText, cleanCollage, cleanSummary, cleanText,
  fillHeading, removeTile, setTile, shownCells, shownCollage, statValue, streakOf, tileColor, tileSpan, type CollageCard, type StoryFacts,
} from '@/lib/week-story/card';
import { cleanLayout, memberChoices, withMemberChoice } from '@/lib/week-story/layout';
import { settingsPatch } from '@/lib/stories/admin';

// Ofer's real week 18–24.10 as the cards read it.
const F: StoryFacts = {
  km: 106.1, seconds: 30989, runs: 8, planShare: 0.9907, daysActive: 5, lastWeekKm: 132, streak: { weeks: 4, over: 100 },
  long: { km: 33.9, fastest: 220 }, set: '10 × 1.6 ק״מ', fastestRep: 201, rank: null, clubKm: 2484, record: null, quality: 'ביעד',
};

describe('share cards: defaults and what was stored', () => {
  it('a layout without cards (the column before today, or junk) gets the default cards', () => {
    for (const raw of [null, {}, { summary: 'x', collage: [] }]) {
      const l = cleanLayout(raw);
      expect(l.summary).toEqual(DEFAULT_SUMMARY);
      expect(l.collage).toEqual(DEFAULT_COLLAGE);
    }
  });
  it('keeps a valid summary and drops what is not', () => {
    const c = cleanSummary({ hero: 'time', cells: ['plan', 'days', 'rep'], chips: ['streak', 'nope', 'streak', 'long'], heading: '  {שם} רץ השבוע ', line: 'עוד שבוע בדרך למרתון' });
    expect(c).toEqual({ hero: 'time', cells: ['plan', 'days', 'rep'], chips: ['streak', 'long'], heading: '{שם} רץ השבוע', line: 'עוד שבוע בדרך למרתון' });
    expect(cleanSummary({ hero: 'bogus', cells: ['km'] }).hero).toBe('km');
    expect(cleanSummary({ cells: ['km'] }).cells).toEqual(DEFAULT_SUMMARY.cells);
  });
  it('texts are one short line with no bidi overrides', () => {
    expect(cleanText('a‮b\nc', 10)).toBe('ab c');
    expect(cleanSummary({ heading: 'x'.repeat(80) }).heading).toHaveLength(28);
    expect(cleanSummary({ line: 'y'.repeat(80) }).line).toHaveLength(42);
  });
  it('the admin PUT carries the cards through the layout', () => {
    const r = settingsPatch({ layout: { collage: { tiles: [{ stat: 'km' }, { stat: 'long', color: 'lime' }] }, summary: { hero: 'plan' } } });
    expect(r.ok && (r.patch.layout as { collage: unknown }).collage).toEqual({ tiles: [{ stat: 'km', color: 'auto' }, { stat: 'long', color: 'lime' }] });
    expect(r.ok && (r.patch.layout as { summary: { hero: string } }).summary.hero).toBe('plan');
  });
});

describe('the collage', () => {
  it('2 to 8 tiles: add stops at 8, remove stops at 2', () => {
    let c: CollageCard = { tiles: [{ stat: 'km', color: 'auto' }, { stat: 'time', color: 'auto' }] };
    expect(removeTile(c, 0)).toBe(c);
    for (let i = 0; i < 10; i++) c = addTile(c, 'runs');
    expect(c.tiles).toHaveLength(TILE_MAX);
    expect(cleanCollage({ tiles: Array.from({ length: 12 }, () => ({ stat: 'km' })) }).tiles).toHaveLength(TILE_MAX);
    expect(cleanCollage({ tiles: [{ stat: 'km' }] }).tiles.length).toBeGreaterThanOrEqual(TILE_MIN);
  });
  it('swap and colour a tile; auto colours never repeat side by side', () => {
    const c = setTile(DEFAULT_COLLAGE, 1, { stat: 'streak', color: 'peach' });
    expect(c.tiles[1]).toEqual({ stat: 'streak', color: 'peach' });
    expect(tileColor(c, 1)).toBe('peach');
    for (let i = 1; i < DEFAULT_COLLAGE.tiles.length; i++) expect(tileColor(DEFAULT_COLLAGE, i)).not.toBe(tileColor(DEFAULT_COLLAGE, i - 1));
  });
  it('packs by importance: the first tile and the route are tall, two tiles fill the card', () => {
    expect(tileSpan(DEFAULT_COLLAGE, 0)).toBe(2);
    expect(tileSpan(DEFAULT_COLLAGE, 2)).toBe(2); // the long run, with its route
    expect(tileSpan(DEFAULT_COLLAGE, 1)).toBe(1);
    const two = { tiles: DEFAULT_COLLAGE.tiles.slice(0, 2) };
    expect([tileSpan(two, 0), tileSpan(two, 1)]).toEqual([2, 2]);
  });
});

describe('week-level items and deltas (Ofer 18–24.10 against 11–17.10)', () => {
  const W: StoryFacts = { ...F, now: { km: 106.1, seconds: 30989, runs: 8, hr: 143, elev: 499, load: null, sleep: null, rhr: null },
    last: { km: 132.1, seconds: 36973, runs: 8, hr: 144, elev: 577, load: null, sleep: null, rhr: null } };
  it('values and deltas: green better, red worse, pace and HR as ± numbers', () => {
    expect(statValue('km', W)).toMatchObject({ value: '106.1', label: '8 ריצות', delta: { text: '▼ 20%', tone: 'bad' } });
    expect(statValue('time', W)?.delta).toEqual({ text: '▼ 16%', tone: 'bad' });
    expect(statValue('pace', W)).toMatchObject({ value: '4:52', delta: { text: '+12″', tone: 'bad' } });
    expect(statValue('hr', W)).toMatchObject({ value: '143', delta: { text: '−1', tone: 'flat' } });
    expect(statValue('elev', W)).toMatchObject({ value: '499', unit: 'מ׳' });
    expect(statValue('runs', W)?.delta).toBeUndefined();
  });
  it('no data → no item: sleep and resting HR need 3+ nights, load every run', () => {
    for (const k of ['sleep', 'rhr', 'load'] as const) expect(statValue(k, W)).toBeNull();
    const S2: StoryFacts = { ...W, now: { ...W.now!, sleep: 17995, rhr: 36, load: 1132 }, last: { ...W.last!, sleep: 19132, rhr: 37, load: 1179 } };
    expect(statValue('sleep', S2)).toMatchObject({ value: '4:59', delta: { text: '▼ 6%', tone: 'bad' } });
    expect(statValue('rhr', S2)).toMatchObject({ value: '36', delta: { text: '−1', tone: 'good' } });
  });
  it('the collage drops tiles with no value and keeps the rest in order', () => {
    const week = { tiles: (['km', 'time', 'pace', 'hr', 'plan', 'elev', 'sleep', 'rhr'] as const).map((stat) => ({ stat, color: 'auto' as const })) };
    expect(shownCollage(week, W).tiles.map((t) => t.stat)).toEqual(['km', 'time', 'pace', 'hr', 'plan', 'elev']);
  });
  it('a summary cell with no value falls back to the next item not on the card', () => {
    const card = { ...DEFAULT_SUMMARY, cells: ['sleep', 'plan', 'pace'] as typeof DEFAULT_SUMMARY.cells };
    expect(shownCells(card, W)).toEqual(['runs', 'plan', 'pace']);
    expect(shownCells(DEFAULT_SUMMARY, W)).toEqual(['runs', 'plan', 'pace']);
  });
  it('the default chips are week-level', () => {
    expect(DEFAULT_SUMMARY.chips).toEqual(['record', 'hr', 'elev']);
    expect(chipText('hr', W)).toBe('❤️ דופק ממוצע 143');
    expect(chipText('elev', W)).toBe('⛰️ 499 מ׳ טיפוס');
  });
});

describe('what the items say (the real week)', () => {
  it('values', () => {
    expect(statValue('km', F)).toMatchObject({ value: '106.1', unit: 'ק״מ' });
    expect(statValue('time', F)?.value).toBe('8:36');
    expect(statValue('plan', F)?.value).toBe('99%');
    expect(statValue('days', F)?.value).toBe('5/7');
    expect(statValue('pace', F)?.value).toBe('4:52');
    expect(statValue('rep', F)?.value).toBe('3:21');
    expect(statValue('moment', F)?.value).toBe('3:40');
    expect(statValue('club', F)?.value).toBe('4%');
    expect(statValue('vs', F)?.value).toBe('−20%');
    expect(statValue('streak', F)).toMatchObject({ value: '4', label: 'שבועות ברצף מעל 100' });
    expect(statValue('rank', F)).toBeNull(); // no pack (academy) → greyed in the menu
  });
  it('chips are separate facts; absent ones are null', () => {
    expect(chipText('quality', F)).toBe('⚡ 10 × 1.6 ק״מ ביעד');
    expect(chipText('streak', F)).toBe('🔥 4 שבועות ברצף מעל 100 ק״מ');
    expect(chipText('record', F)).toBeNull();
    expect(chipText('rank', { ...F, rank: { rank: 2, of: 9 } })).toBe('🥈 מקום 2');
  });
  it('a streak counts back from this week over its round floor', () => {
    expect(streakOf([37.1, 69.5, 107.5, 40.3, 114.2, 100.6, 132.1, 106.1])).toEqual({ weeks: 4, over: 100 });
    expect(streakOf([30, 45])).toBeNull();
  });
  it('the heading template keeps the name its own line', () => {
    expect(fillHeading('השבוע של {שם}', 'Sahar')).toEqual({ pre: 'השבוע של', name: 'Sahar', post: '' });
    expect(fillHeading('{שם} רץ השבוע', 'Ofer')).toEqual({ pre: '', name: 'Ofer', post: 'רץ השבוע' });
  });
  it('the member overrides only their own name', () => {
    const w = withMemberChoice({ theme: 'ocean' }, { name: '  עופר  ' });
    expect(memberChoices(w, 'x')).toMatchObject({ name: 'עופר', theme: 'ocean' });
    expect(memberChoices(withMemberChoice(w, { name: '' }), 'x').name).toBeNull();
  });
});

describe('the summary card markup', () => {
  it('numbers stay isolated in the line and the chips', async () => {
    const { SummaryChips } = await import('@/components/week-story/WeekStory');
    const html = renderToStaticMarkup(createElement(SummaryChips, { tags: [chipText('streak', F)!] }));
    expect(html).toContain('<bdi dir="ltr">4</bdi> שבועות ברצף מעל <bdi dir="ltr">100</bdi> ק״מ');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { clubRankFor, filterRecordTable, improvedBySec, paceHiddenRows, type RecordFacts } from '@/lib/records/board';

const e = (athleteId: string, seconds: number) => ({ athleteId, seconds, activityId: `run-${athleteId}`, date: '2026-10-01' });
const facts = new Map<string, RecordFacts>([
  ['fast', { gender: 'male' }],
  ['hider', { gender: 'male', hidesPace: true }],
  ['mid', { gender: 'female' }],
  ['out', { optOut: true }],
  ['slow', { gender: 'male' }],
]);
const entries = [e('fast', 1100), e('hider', 1150), e('mid', 1200), e('out', 1210), e('slow', 1300)];

describe('b23 club table: pace-hiders as name-only rows', () => {
  it('ranks count visible runners only', () => {
    const ranked = filterRecordTable(entries, facts, () => false, {});
    expect(ranked.map((r) => [r.entry.athleteId, r.rank])).toEqual([['fast', 1], ['mid', 2], ['slow', 3]]);
  });

  it('a hidden row carries no time, rank, date or run', () => {
    const rows = paceHiddenRows(entries, facts, {});
    expect(rows).toEqual([{ athleteId: 'hider', paceHidden: true, seconds: null, rank: null }]);
    expect(Object.keys(rows[0]).sort()).toEqual(['athleteId', 'paceHidden', 'rank', 'seconds']);
  });

  it('order of hidden rows never follows their times', () => {
    const f = new Map<string, RecordFacts>([['b', { hidesPace: true }], ['a', { hidesPace: true }]]);
    expect(paceHiddenRows([e('b', 900), e('a', 2000)], f, {}).map((r) => r.athleteId)).toEqual(['a', 'b']);
    expect(paceHiddenRows([e('a', 900), e('b', 2000)], f, {}).map((r) => r.athleteId)).toEqual(['a', 'b']);
  });

  it('opt-out stays out; filters apply; races-only drops hidden rows', () => {
    const f = new Map(facts); f.set('out', { optOut: true, hidesPace: true });
    expect(paceHiddenRows(entries, f, {}).map((r) => r.athleteId)).toEqual(['hider']);
    expect(paceHiddenRows(entries, facts, { sex: 'f' })).toEqual([]);
    expect(paceHiddenRows(entries, facts, { racesOnly: true })).toEqual([]);
  });

  it('route builds hidden rows from the roster, never spreading the entry', () => {
    const s = readFileSync(join(process.cwd(), 'src/app/api/club/records/route.ts'), 'utf8');
    const block = s.slice(s.indexOf('paceHiddenRows(b.entries'), s.indexOf('const b2000'));
    expect(block).toContain('seconds: null');
    expect(block).toContain('rank: null');
    expect(block).not.toMatch(/\.\.\.|date|activityId|official|ageBand/);
  });
});

describe('b23 /api/athletes/prs extras', () => {
  it('improvedBySec is the gap to the last slower break', () => {
    const breaks = [{ date: '2025-01-01', seconds: 1300 }, { date: '2025-06-01', seconds: 1250 }, { date: '2026-01-01', seconds: 1210 }];
    expect(improvedBySec(breaks, 1210)).toBe(40);
    expect(improvedBySec(breaks.slice(0, 1), 1300)).toBeNull();
    expect(improvedBySec(breaks, 1180)).toBe(30); // a stated time faster than every break
    expect(improvedBySec(breaks, null)).toBeNull();
  });

  it('clubRank counts visible others strictly faster', () => {
    expect(clubRankFor(entries, facts, 'mid', 1200)).toBe(2);   // hider at 1150 not counted
    expect(clubRankFor(entries, facts, 'fast', 1100)).toBe(1);
    expect(clubRankFor(entries, facts, 'slow', 1105)).toBe(2);  // their own stated time, not the snapshot's
  });

  it('a pace-hider or opted-out runner has no rank, even on their own card', () => {
    expect(clubRankFor(entries, facts, 'hider', 1150)).toBeNull();
    expect(clubRankFor(entries, facts, 'out', 1210)).toBeNull();
    expect(clubRankFor(entries, facts, 'mid', null)).toBeNull();
  });
});

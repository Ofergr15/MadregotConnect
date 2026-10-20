import { describe, expect, it } from 'vitest';
import { relevantSuggestions, type ResultRow, type SuggestionLike } from '@/lib/champions/table';

/** Only what enters a top 10, and one per distance per runner (Ofer 10-20). */
const T = '2026-10-20';
const res = (i: number, sec: number, o: Partial<ResultRow> = {}): ResultRow => ({
  id: `r${i}`, athleteId: `a${i}`, name: `R${i}`, avatarUrl: null, gender: 'male', pack: 1, distance: '10k', seconds: sec, raceName: null, raceDate: '2025-05-01', ...o,
});
const sug = (id: string, athlete: string, sec: number, o: Partial<SuggestionLike> = {}): SuggestionLike => ({
  activityId: id, athleteId: athlete, name: athlete, avatarUrl: null, distance: '10k', watchSeconds: sec, raceName: null, raceDate: '2026-10-18', gender: 'male', ...o,
});
// Ten men at 10k, 36:00 … 40:30 all time.
const ten = Array.from({ length: 10 }, (_, i) => res(i, 2160 + i * 30));

describe('race-day runs that reach the admin', () => {
  it('one per runner per distance — the fastest', () => {
    const out = relevantSuggestions([], [sug('s1', 'x', 2500), sug('s2', 'x', 2400), sug('s3', 'x', 5000, { distance: 'half' })], T);
    expect(out.map((s) => s.activityId).sort()).toEqual(['s2', 's3']);
  });
  it('a run inside the all-time top 10 is in', () => {
    expect(relevantSuggestions(ten, [sug('s1', 'new', 2200)], T)).toHaveLength(1);
  });
  it('a run outside every top 10 is out', () => {
    // All ten raced this year too, so the year board is just as full.
    const thisYear = ten.map((r) => ({ ...r, raceDate: '2026-04-01' }));
    expect(relevantSuggestions(thisYear, [sug('s1', 'slow', 3600)], T)).toHaveLength(0);
  });
  it('outside the all-time ten but inside THIS YEAR\'s is in', () => {
    // The ten are all from 2025: this year's board is empty.
    expect(relevantSuggestions(ten, [sug('s1', 'slow', 3600)], T)).toHaveLength(1);
  });
  it('a woman outside the mixed top 10 but inside the women\'s is in', () => {
    const thisYear = ten.map((r) => ({ ...r, raceDate: '2026-04-01' }));
    expect(relevantSuggestions(thisYear, [sug('s1', 'w', 3000, { gender: 'female' })], T)).toHaveLength(1);
  });
  it('slower than the runner\'s own official time changes no table — out', () => {
    const thisYear = ten.map((r) => ({ ...r, raceDate: '2026-04-01' }));
    expect(relevantSuggestions(thisYear, [sug('s1', 'a3', 2400)], T)).toHaveLength(0);
  });
});

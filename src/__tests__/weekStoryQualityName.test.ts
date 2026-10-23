import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectReps } from '@/lib/quality-session/model';
import { mainSet, parseParts, partLabel, targetFor } from '@/lib/quality-session/parts';
import { planTargets } from '@/lib/quality-session/server';
import { highlightOf } from '@/lib/week-story/model';

// Tuesday 20.10, "אינטרוולים ארוכים" (pack 2): the watch's own laps of a real run (numbers
// only) and the club plan's day. The watch split every 1600 m rep at its 1 km auto-lap
// (1000 + 600), so the reps were read as one long run and the warm-up strides — 4 × 45″ —
// became the week story's "quality workout" (Ofer, 2026-10-23).
const fx = JSON.parse(readFileSync('src/__tests__/fixtures/week-story-tuesday-1020.json', 'utf8'));

describe('the week story names the morning by its main set', () => {
  const parsed = parseParts(detectReps(fx.laps));
  const main = mainSet(parsed.parts)!;
  it('one watch step is one lap: 1000 + 600 is one 1600 m rep', () => {
    expect(partLabel(main)).toBe('10 × 1.6 ק״מ');
    expect(main.reps.map((r) => Math.round(r.p))).toEqual([220, 220, 211, 212, 213, 210, 201, 201, 221, 201]);
  });
  it('the strides stay sets of their own, never the title', () => {
    const labels = parsed.parts.filter((p) => p.kind === 'set').map(partLabel);
    expect(labels).toContain('4 × 45″');
    expect(partLabel(main)).not.toMatch(/45″/);
  });
  it('the targets are the plan\'s 1600 m reps for that pack', () => {
    expect(targetFor(main, planTargets(fx.plan, 2)[2])?.paces).toEqual([220, 220, 210, 210, 210, 210, 200, 200, 220, 200]);
  });
});

describe('the plan percent reads the same everywhere', () => {
  const base = { km: 106.1, runs: 8, seconds: 30989, dayKm: [16, 10.1, 34.6, 0, 8.5, 36.9, 0], lastWeekKm: 132, sessionsDone: 5, sessionsPlanned: 6, records: [], packRank: null };
  it('99.07% is 99% beside it, so the line is not "100%"', () => {
    expect(highlightOf({ ...base, planShare: 0.9907 } as never).text).not.toBe('100% מהתוכנית!');
  });
  it('a full plan still says so', () => {
    expect(highlightOf({ ...base, planShare: 0.996 } as never).text).toBe('100% מהתוכנית!');
  });
});

describe('a day without a run is empty in the days chart', () => {
  it('no red "missed" bar, no planned ghost bar', () => {
    const src = readFileSync('src/components/week-story/WeekStory.tsx', 'utf8');
    expect(src).toMatch(/k > 0 \? <i style=\{\{ height: `\$\{\(k \/ top\) \* 100\}%` \}\} \/> : <i className="z" \/>/);
    expect(src).not.toMatch(/className=\{story\.missed\[i\] \? 'ms' : 'pl'\}/);
  });
});

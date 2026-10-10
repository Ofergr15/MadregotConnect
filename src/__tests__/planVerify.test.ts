import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfGlyphs } from '@/lib/plans/verify/pdf-glyphs';
import { compareGroup, fileTokens, verifyPlan, type DayResult, type VerifyReport } from '@/lib/plans/verify/compare';

// The two real weeks the comparator was built against: the program PDFs as
// uploaded, and the plans as saved and sent to the watches.
const dir = join(__dirname, 'fixtures', 'plan-verify');
async function week(w: string): Promise<VerifyReport> {
  const glyphs = await pdfGlyphs(new Uint8Array(readFileSync(join(dir, `${w}.pdf`))));
  return verifyPlan(glyphs, JSON.parse(readFileSync(join(dir, `${w}.plan.json`), 'utf8')));
}
const day = (r: VerifyReport, d: number) => r.days.find((x) => x.dayOfWeek === d) as DayResult;

describe('plan vs PDF — week of 2026-09-06', () => {
  it('proves Sunday, Tuesday (58 numbers over two pages, morning + evening) and Thursday', async () => {
    const r = await week('2026-09-06');
    expect(r.textLayer).toBe(true);
    for (const d of [0, 2, 4]) expect(day(r, d).level).toBe('proven');
    expect(day(r, 2).pages).toEqual([2, 3]);
    for (const g of [1, 2, 3] as const) expect(day(r, 2).groups[g]).toMatchObject({ matched: 58, total: 58 });
  });

  it("flags Wednesday's 70–80 minutes living only in a note (the watch got no duration)", async () => {
    const r = await week('2026-09-06');
    const wed = day(r, 3).groups[1];
    expect(wed.level).toBe('approx');
    expect(wed.diffs[0]).toMatchObject({ kind: 'note' });
    expect(wed.diffs[0].file[0].text).toContain('ריצת שחרור');
  });

  it("flags Saturday's 40–50 saved as 45, and Friday's pace the plan filled in", async () => {
    const r = await week('2026-09-06');
    expect(day(r, 6).groups[1].diffs[0]).toMatchObject({ kind: 'approx', plan: '45 דק׳' });
    expect(day(r, 5).groups[1].diffs[0]).toMatchObject({ kind: 'inferred' });
  });
});

describe('plan vs PDF — week of 2026-10-11', () => {
  it('reads each group from its own column, even where ❶ sits lower than ❷/❸ (page 3)', async () => {
    const r = await week('2026-10-11');
    for (const g of [1, 2, 3] as const) expect(day(r, 2).groups[g]).toMatchObject({ level: 'proven', matched: 54, total: 54 });
  });

  it('keeps two long neighbouring lines apart (Sunday "4 דק׳ בין סטים")', async () => {
    const r = await week('2026-10-11');
    for (const g of [1, 2, 3] as const) expect(day(r, 0).groups[g].level).toBe('proven');
  });

  it('marks the easy runs whose minutes are only in the note', async () => {
    const r = await week('2026-10-11');
    for (const d of [1, 3, 6]) expect(day(r, d).level).toBe('approx');
    expect(day(r, 6).groups[1].diffs[0].plan).toContain('4:50');
  });
});

describe('the comparison itself', () => {
  const row = (text: string) => ({ page: 1, y: 0, col: 1 as const, text });
  const w = (steps: unknown[]) => [{ dayOfWeek: 2, name: '', steps } as never];

  it('reads repeats written either way', () => {
    expect(fileTokens(row('2 x')).map((t) => t.k)).toEqual(['rep']);
    expect(fileTokens(row('3 עליות x')).map((t) => [t.k, t.n])).toEqual([['rep', 3]]);
    expect(fileTokens(row('ב90-95% מאמץ 20 שנ׳')).map((t) => t.n)).toEqual([20]);
  });

  it('a different pace differs', () => {
    const r = compareGroup([row('2 ק״מ 3:25')], w([{ type: 'interval', durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 210, targetPaceMaxPerKm: 210 }]));
    expect(r.level).toBe('differs');
    expect(r.diffs[0]).toMatchObject({ kind: 'changed', plan: '3:30' });
  });

  it('units agree: 2 ק״מ is 2000 m, 2 דק׳ is 120 s', () => {
    const r = compareGroup([row('2 ק״מ 5:00'), row('2 דק׳ הליכה')], w([
      { type: 'warmup', durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300 },
      { type: 'rest', durationType: 'time', durationValue: 120 },
    ]));
    expect(r).toMatchObject({ level: 'proven', matched: 3 });
  });

  it('a line the plan has nothing for is missing', () => {
    const r = compareGroup([row('2 ק״מ 5:00'), row('5 x'), row('300 מ׳ 3:30')], w([{ type: 'warmup', durationType: 'distance', durationValue: 2000, targetPaceMinPerKm: 300 }]));
    expect(r.level).toBe('differs');
    expect(r.diffs[0].kind).toBe('missing');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeQuick, parseQuickText, quickToBook, type QuickStep } from '@/lib/academy/quick-text';
import { effortPace } from '@/lib/academy/book-steps';

const steps = (text: string) => parseQuickText(text).steps;
const codes = (text: string) => parseQuickText(text).assumptions.map(a => a.code);

describe('normalizeQuick', () => {
  it('folds the phone spellings into one', () => {
    expect(normalizeQuick('5×1000 ב־4:05')).toBe('5x1000 ב-4:05');
    expect(normalizeQuick('6 X 800')).toBe('6x800');
    expect(normalizeQuick('6 פעמים 800')).toBe('6x800');
    expect(normalizeQuick('2 ק״מ ג׳וג')).toBe(`2 ק"מ ג'וג`);
    expect(normalizeQuick('5x1000 ב‏-4:05')).toBe('5x1000 ב-4:05');
  });
});

describe('parseQuickText — the mockup sentence', () => {
  const parse = parseQuickText('2 קל, 5x1000 ב־4:05 מנוחה 2:00, 2 קל');

  it('reads warmup, reps with their rest, cooldown', () => {
    expect(parse.steps).toEqual<QuickStep[]>([
      { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
      {
        kind: 'reps', count: 5, work: { measure: 'distance', value: 1000 },
        effort: { kind: 'pace', min: 245, max: 245 },
        rest: { length: { measure: 'time', value: 120 }, mode: null },
      },
      { kind: 'run', role: 'cooldown', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
    ]);
    expect(parse.unknown).toEqual([]);
  });

  it('says what it assumed', () => {
    expect(parse.assumptions.map(a => a.code)).toEqual(
      expect.arrayContaining(['bare-km', 'bare-metres', 'warmup', 'cooldown']),
    );
  });
});

describe('parseQuickText — the brief\'s examples', () => {
  it('"20 דק׳ טמפו" is twenty minutes of tempo', () => {
    expect(steps('20 דק׳ טמפו')).toEqual([
      { kind: 'run', role: 'main', length: { measure: 'time', value: 1200 }, effort: { kind: 'zone', zone: 'tempo' } },
    ]);
  });

  it('"2 קל" is two easy kilometres', () => {
    expect(steps('2 קל')).toEqual([
      { kind: 'run', role: 'main', length: { measure: 'distance', value: 2000 }, effort: { kind: 'zone', zone: 'easy' } },
    ]);
  });

  it('"6x800 מנוחה 90" is metres and seconds', () => {
    const [reps] = steps('6x800 מנוחה 90');
    expect(reps).toMatchObject({
      kind: 'reps', count: 6, work: { measure: 'distance', value: 800 },
      effort: { kind: 'zone', zone: 'interval' },
      rest: { length: { measure: 'time', value: 90 } },
    });
    expect(codes('6x800 מנוחה 90')).toEqual(expect.arrayContaining(['rest-seconds', 'rep-effort']));
  });
});

describe('parseQuickText — lengths', () => {
  it('a small bare rep is kilometres', () => {
    expect(steps('5x1 ב-4:05')[0]).toMatchObject({ work: { measure: 'distance', value: 1000 } });
    expect(codes('5x1 ב-4:05')).toContain('bare-rep-km');
  });

  it('units glued to the number', () => {
    expect(steps('3x45שנ ב-3:50')[0]).toMatchObject({ work: { measure: 'time', value: 45 } });
    expect(steps('4x400מ׳')[0]).toMatchObject({ work: { measure: 'distance', value: 400 } });
  });

  it('a clock as the length of a rep is a time', () => {
    expect(steps('5x3:00 ב-4:10 מנוחה 1:00')[0]).toMatchObject({
      work: { measure: 'time', value: 180 },
      effort: { kind: 'pace', min: 250, max: 250 },
      rest: { length: { measure: 'time', value: 60 } },
    });
  });

  it('latin m is metres, not minutes', () => {
    expect(steps('8x200m')[0]).toMatchObject({ work: { measure: 'distance', value: 200 } });
  });

  it('a bare number with tempo is minutes when it is large, km when small', () => {
    expect(steps('25 טמפו')[0]).toMatchObject({ length: { measure: 'time', value: 1500 } });
    expect(steps('8 טמפו')[0]).toMatchObject({ length: { measure: 'distance', value: 8000 } });
  });

  it('a range takes the middle, the club parser\'s rule', () => {
    expect(steps('60-40 דקות שחרור')).toEqual([
      { kind: 'run', role: 'main', length: { measure: 'time', value: 3000 }, effort: { kind: 'zone', zone: 'easy' } },
    ]);
  });

  it('decimal kilometres', () => {
    expect(steps('1.5 ק"מ קל')[0]).toMatchObject({ length: { measure: 'distance', value: 1500 } });
  });
});

describe('parseQuickText — paces', () => {
  it('ב, בקצב, @ and a bare clock after a length', () => {
    for (const t of ['ב-4:05', 'בקצב 4:05', '@4:05', 'ב4:05']) {
      expect(steps(`5x1000 ${t}`)[0]).toMatchObject({ effort: { kind: 'pace', min: 245, max: 245 } });
    }
    expect(steps('3 קמ חימום 4:40, 5x1000 ב-4:05')[0]).toMatchObject({
      role: 'warmup', length: { measure: 'distance', value: 3000 }, effort: { kind: 'pace', min: 280, max: 280 },
    });
  });

  it('a pace range, either way round', () => {
    expect(steps('10 ק"מ ב-4:45-4:30')[0]).toMatchObject({ effort: { kind: 'pace', min: 270, max: 285 } });
  });
});

describe('parseQuickText — rests', () => {
  it('reads minutes for a small bare number, seconds for a large one', () => {
    expect(steps('6x400 מנוחה 2')[0]).toMatchObject({ rest: { length: { measure: 'time', value: 120 } } });
    expect(codes('6x400 מנוחה 2')).toContain('rest-minutes');
    expect(steps('6x400 מנוחה 20')[0]).toMatchObject({ rest: { length: { measure: 'time', value: 20 } } });
    expect(codes('6x400 מנוחה 20')).toContain('rest-ambiguous');
  });

  it('jogged and walked recoveries', () => {
    expect(steps("6x400 200 ג'וג")[0]).toMatchObject({ rest: { length: { measure: 'distance', value: 200 }, mode: 'jog' } });
    expect(steps('6x400 מנוחה 1:30 הליכה')[0]).toMatchObject({ rest: { length: { measure: 'time', value: 90 }, mode: 'walk' } });
    expect(steps('5x1000 מנוחה 2:00 ג׳וג')[0]).toMatchObject({ rest: { mode: 'jog' } });
  });

  it('the club\'s "+ 60 מנוחה" inside a repeat', () => {
    expect(steps('4x30שנ מתגברת + 60 מנוחה')[0]).toMatchObject({
      count: 4, work: { measure: 'time', value: 30 }, effort: { kind: 'zone', zone: 'sprint' },
      rest: { length: { measure: 'time', value: 60 } },
    });
  });

  it('a number before the word', () => {
    expect(steps('5x400 90 מנוחה')[0]).toMatchObject({
      work: { measure: 'distance', value: 400 }, rest: { length: { measure: 'time', value: 90 } },
    });
  });

  it('a rest on its own line is a rest step', () => {
    expect(steps('2 קל, 2 דק מנוחה, 3x1000 ב-4:00')).toMatchObject([
      { kind: 'run', role: 'warmup' },
      { kind: 'rest', length: { measure: 'time', value: 120 } },
      { kind: 'reps', count: 3 },
    ]);
  });

  it('a rest word without a value takes 2:00 and says so', () => {
    expect(steps('5x1000 ב-4:05 מנוחה')[0]).toMatchObject({ rest: { length: { measure: 'time', value: 120 } } });
    expect(codes('5x1000 ב-4:05 מנוחה')).toContain('rest-default');
  });

  it('parentheses are the body of a repeat', () => {
    expect(steps('6x(400 ב-3:40 + 200 ג\'וג)')[0]).toMatchObject({
      count: 6, work: { measure: 'distance', value: 400 }, rest: { length: { measure: 'distance', value: 200 }, mode: 'jog' },
    });
  });
});

describe('parseQuickText — words', () => {
  it('a hill session', () => {
    const p = parseQuickText('2 קל, 8x200 גבעות, 2 קל');
    expect(p.kindHint).toBe('hills');
    expect(p.steps[1]).toMatchObject({ kind: 'reps', count: 8, effort: { kind: 'zone', zone: 'interval' } });
  });

  it('a long run', () => {
    const p = parseQuickText('16 ארוכה');
    expect(p.kindHint).toBe('long');
    expect(p.steps[0]).toMatchObject({ length: { measure: 'distance', value: 16000 }, effort: { kind: 'zone', zone: 'easy' } });
  });

  it('threshold and marathon pace', () => {
    expect(steps('20 דק קצב סף')[0]).toMatchObject({ effort: { kind: 'zone', zone: 'threshold' } });
    expect(steps('10 ק"מ קצב מרתון')[0]).toMatchObject({ effort: { kind: 'zone', zone: 'marathon_pace' } });
  });

  it('an all-easy session has no warmup', () => {
    expect(steps('8 קל')[0]).toMatchObject({ role: 'main' });
  });

  it('a test is open effort', () => {
    const p = parseQuickText('2 קל, 30 דק טסט');
    expect(p.kindHint).toBe('test');
    expect(p.steps[1]).toMatchObject({ length: { measure: 'time', value: 1800 }, effort: { kind: 'open' } });
  });

  it('never drops what it did not understand', () => {
    const p = parseQuickText('2 קל, בננה');
    expect(p.unknown).toContain('בננה');
  });

  it('empty input is empty', () => {
    expect(parseQuickText('   ').steps).toEqual([]);
  });

  it('reports a second block inside a rep it cannot keep', () => {
    expect(codes('6x9 דקות + דקה מהיר')).toContain('second-work');
  });
});

describe('quickToBook', () => {
  const parse = parseQuickText('2 קל, 5x1000 ב-4:05 מנוחה 2:00, 2 קל');

  it('turns a typed pace into a share of THIS trainee\'s threshold', () => {
    const { steps: book, needsThreshold } = quickToBook(parse, 270);
    expect(needsThreshold).toBe(false);
    const reps = book[1];
    if (reps.kind !== 'reps' || !reps.effort) throw new Error('expected reps');
    // 270 / 245 = 110.2% of threshold speed.
    expect(reps.effort.intensity.fastPct).toBeCloseTo(111.7, 1);
    expect(reps.effort.intensity.slowPct).toBeCloseTo(108.7, 1);
    // Reads back as what the coach typed…
    expect(effortPace(reps.effort, 270)).toBe(245);
    // …and generalises to a slower trainee.
    expect(effortPace(reps.effort, 300)).toBe(272);
  });

  it('refuses to keep a typed pace with no threshold, and says so', () => {
    const { steps: book, needsThreshold } = quickToBook(parse, null);
    expect(needsThreshold).toBe(true);
    expect(book[1]).toMatchObject({ kind: 'reps', effort: null });
    // Zone words still resolve: they are already relative.
    expect(book[0]).toMatchObject({ kind: 'run', effort: { zone: 'easy' } });
  });

  it('keeps a range as its band', () => {
    const { steps: book } = quickToBook(parseQuickText('10 ק"מ ב-4:30-4:45'), 270);
    const run = book[0];
    if (run.kind !== 'run' || !run.effort) throw new Error('expected run');
    expect(run.effort.intensity.fastPct).toBeCloseTo(100, 0);
    expect(run.effort.intensity.slowPct).toBeCloseTo(94.7, 0);
  });
});

describe('parseQuickText — the club\'s own sentence (lib/ai/prompt.ts)', () => {
  it('reads a full Tuesday the way the coach wrote it', () => {
    const p = parseQuickText('3 קמ חימום 4:40, 2 דק מנוחה, 3x45שנ 3:50, 2 דק מנוחה, 4x30שנ מתגברת + 60 מנוחה, 2 קמ צינון');
    expect(p.unknown).toEqual([]);
    expect(p.steps).toMatchObject([
      { kind: 'run', role: 'warmup', length: { measure: 'distance', value: 3000 }, effort: { kind: 'pace', min: 280 } },
      { kind: 'rest', length: { measure: 'time', value: 120 } },
      { kind: 'reps', count: 3, work: { measure: 'time', value: 45 }, effort: { kind: 'pace', min: 230 } },
      { kind: 'rest', length: { measure: 'time', value: 120 } },
      { kind: 'reps', count: 4, work: { measure: 'time', value: 30 }, rest: { length: { measure: 'time', value: 60 } } },
      { kind: 'run', role: 'cooldown', length: { measure: 'distance', value: 2000 } },
    ]);
  });
});

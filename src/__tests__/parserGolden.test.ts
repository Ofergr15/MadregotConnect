import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutStep } from '@/lib/ai/types';

// Golden fixtures for the deterministic half of the plan parser — the code that
// runs on every model reply and decides what reaches the athlete's watch. Notes
// strings are copied from real coach plans (validateWorkout.test.ts header, the
// sample PDF in the repo root, and CLAUDE.md's parser notes).

const stream = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: (...a: unknown[]) => stream(...a) };
  },
}));

const { paceFromNotes, validateAndFixStep, extractJson, parseWorkoutPlan, ParseTimeoutError, PARSE_DEADLINE_MS, detectWorkoutType } =
  await import('@/lib/ai/parser');

const sec = (m: number, s: number) => m * 60 + s;

describe('paceFromNotes — Group 1 pace, notes win', () => {
  it.each([
    ['3:30 (3:40) ((3:50))', { min: sec(3, 30), max: sec(3, 30) }],
    ['3:35(3:45)((3:55))', { min: sec(3, 35), max: sec(3, 35) }],
    ['4:15 (4:24) ((4:36))', { min: sec(4, 15), max: sec(4, 15) }],
    ['4:04 (4:13) ((4:18)) ג׳ל בקילומטר השני', { min: sec(4, 4), max: sec(4, 4) }],
    ['4:40 – 5:30', { min: sec(4, 40), max: sec(4, 40) + 50 }],
    ['4:10-4:00 (4:20-4:10)', { min: sec(4, 0), max: sec(4, 10) }],
    ['5:00 - 5:30 ((5:40-6:00))', { min: sec(5, 0), max: sec(5, 30) }],
  ])('%s', (notes, want) => {
    expect(paceFromNotes(notes)).toEqual(want);
  });

  it.each([[undefined], [''], ['הליכה'], ['All-out'], ['(3:40) ((3:50))'], ['מאמץ קל']])(
    'no leading pace: %s',
    (notes) => {
      expect(paceFromNotes(notes)).toBeNull();
    },
  );
});

const step = (over: Partial<WorkoutStep>): WorkoutStep =>
  ({ order: 1, type: 'active', durationType: 'time', durationValue: 600, targetType: 'no_target', notes: '', ...over }) as WorkoutStep;

describe('validateAndFixStep — units', () => {
  it.each<[string, Partial<WorkoutStep>, Partial<WorkoutStep>]>([
    ['"50 דקות" stays time (3000 s, not 3000 m)', { durationValue: 3000, notes: '50 דקות ריצה קלה' }, { durationType: 'time', durationValue: 3000 }],
    ['"60 min easy" stays time', { durationValue: 3600, notes: '60 min easy' }, { durationType: 'time' }],
    ['"3 ק״מ" mislabeled as time becomes distance', { durationValue: 3000, notes: '3 ק״מ חימום' }, { durationType: 'distance', durationValue: 3000 }],
    ['"5 km" mislabeled as time becomes distance', { durationValue: 5000, notes: '5 km' }, { durationType: 'distance' }],
    ['400 with a pace and no time unit is metres', { type: 'interval', durationValue: 400, targetType: 'pace', targetPaceMinPerKm: 210, notes: '3:30 (3:40)' }, { durationType: 'distance' }],
    ['200 שניות stays time', { type: 'interval', durationValue: 200, targetType: 'pace', targetPaceMinPerKm: 210, notes: '200 שניות 3:30' }, { durationType: 'time' }],
    ['open step with "10 דק׳" becomes time', { durationType: 'open', durationValue: 600, notes: '10 דק׳' }, { durationType: 'time' }],
    ['open step with "2 ק״מ" becomes distance', { durationType: 'open', durationValue: 2000, notes: '2 ק״מ' }, { durationType: 'distance' }],
    ['open step, big ambiguous value stays Lap Button', { durationType: 'open', durationValue: 5000, notes: '' }, { durationType: 'open', durationValue: undefined }],
  ])('%s', (_name, input, want) => {
    expect(validateAndFixStep(step(input))).toMatchObject(want);
  });

  it('re-derives Group 1 pace from bracket notes 3:30 (3:40) ((3:50))', () => {
    const out = validateAndFixStep(step({ targetType: 'pace', targetPaceMinPerKm: 220, targetPaceMaxPerKm: 220, notes: '3:30 (3:40) ((3:50))' }));
    expect(out).toMatchObject({ targetPaceMinPerKm: 210, targetPaceMaxPerKm: 210, notes: '3:30 (3:40) ((3:50))' });
  });

  it('never invents a pace target on an no-target step', () => {
    const out = validateAndFixStep(step({ targetType: 'no_target', notes: '3:30 (3:40)' }));
    expect(out.targetPaceMinPerKm).toBeUndefined();
  });

  it('fixes children of a repeat block', () => {
    const out = validateAndFixStep(
      step({ repeatCount: 6, repeatSteps: [step({ durationValue: 3000, notes: '50 דקות' }), step({ durationValue: 1000, notes: '1 ק״מ' })] }),
    );
    expect(out.repeatSteps?.map((s) => s.durationType)).toEqual(['time', 'distance']);
  });
});

describe('extractJson — Hebrew replies', () => {
  it('keeps bracket notation and Hebrew inside strings', () => {
    const reply = 'הנה התוכנית:\n```json\n{"workouts":[{"notes":"3:30 (3:40) ((3:50)) {קבוצה}"}]}\n```\nבהצלחה';
    expect(JSON.parse(extractJson(reply))).toEqual({ workouts: [{ notes: '3:30 (3:40) ((3:50)) {קבוצה}' }] });
  });
});

describe('detectWorkoutType — fartlek, both spellings', () => {
  it('accepts פארטלק (canonical) and פרטלק', () => {
    expect(detectWorkoutType('יום שלישי - פארטלק 10x1')).toBe('Fartlek');
    expect(detectWorkoutType('יום שלישי - פרטלק 10x1')).toBe('Fartlek');
    expect(detectWorkoutType('Fartlek 20/40')).toBe('Fartlek');
  });
});

describe('vision call deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stream.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('streams with adaptive thinking + effort low, no budget_tokens / temperature', async () => {
    stream.mockReturnValue({ finalMessage: async () => ({ content: [{ type: 'text', text: '{"workouts":[{"dayOfWeek":0,"steps":[]}]}' }] }) });
    await parseWorkoutPlan({ imageBase64: 'x', imageMediaType: 'application/pdf' }).catch(() => {});
    const [params, opts] = stream.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params).not.toHaveProperty('temperature');
    expect(JSON.stringify(params)).not.toContain('budget_tokens');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts at the deadline with ParseTimeoutError and does not retry', async () => {
    stream.mockImplementation((_p: unknown, { signal }: { signal: AbortSignal }) => ({
      finalMessage: () =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Request was aborted.')))),
    }));
    const p = parseWorkoutPlan({ imageBase64: 'x', imageMediaType: 'application/pdf' });
    const caught = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(PARSE_DEADLINE_MS + 1);
    const err = await caught;
    expect(err).toBeInstanceOf(ParseTimeoutError);
    expect(err.code).toBe('parse_timeout');
    expect(PARSE_DEADLINE_MS).toBeLessThan(300_000);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('skips the retry when the first attempt used up the budget', async () => {
    stream.mockImplementation(() => ({
      finalMessage: () => new Promise((_, reject) => setTimeout(() => reject(new Error('bad json')), PARSE_DEADLINE_MS - 30_000)),
    }));
    const caught = parseWorkoutPlan({ imageBase64: 'x', imageMediaType: 'application/pdf' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(PARSE_DEADLINE_MS);
    expect((await caught).message).toBe('bad json');
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import { feelAverage, projectionVerdict, readinessGate, readinessHighlight, sortReadiness } from '@/lib/academy/readiness';

/** The readiness gate (spec §3.6) and the coach board's one fact, sort and projection. */

const calm = { status: 'ok' as const, form: -9, rhrFlag: false, painLast7: false, feelAvg4: 3 };

describe('readinessGate', () => {
  it('a calm trainee is not paused', () => {
    expect(readinessGate(calm)).toEqual({ paused: false, reasons: [] });
  });

  it('each reason pauses on its own', () => {
    expect(readinessGate({ ...calm, form: -30 })).toEqual({ paused: true, reasons: ['veryTired'] });
    expect(readinessGate({ ...calm, rhrFlag: true })).toEqual({ paused: true, reasons: ['rhr'] });
    expect(readinessGate({ ...calm, painLast7: true })).toEqual({ paused: true, reasons: ['pain'] });
    expect(readinessGate({ ...calm, feelAvg4: 1 })).toEqual({ paused: true, reasons: ['feel'] });
  });

  it('−29 and a feel of 1.25 do not pause', () => {
    expect(readinessGate({ ...calm, form: -29, feelAvg4: 1.25 }).paused).toBe(false);
  });

  it('never pauses on form while learning or with insufficient data', () => {
    expect(readinessGate({ ...calm, status: 'learning', form: -45 }).paused).toBe(false);
    expect(readinessGate({ ...calm, status: 'insufficient', form: -45 }).paused).toBe(false);
    expect(readinessGate({ ...calm, status: 'learning', form: -45, painLast7: true }).reasons).toEqual(['pain']);
  });

  it('no feel answers is not a low feel', () => {
    expect(readinessGate({ ...calm, feelAvg4: null }).paused).toBe(false);
  });
});

describe('feelAverage', () => {
  it('averages the newest 4 answers that have a feel', () => {
    const fb = [
      { feel: 0, date: '2026-09-01' }, { feel: 3, date: '2026-10-10' }, { feel: null, date: '2026-10-11' },
      { feel: 4, date: '2026-10-08' }, { feel: 3, date: '2026-10-06' }, { feel: 2, date: '2026-10-04' },
    ];
    expect(feelAverage(fb)).toBe(3);
    expect(feelAverage([])).toBeNull();
  });
});

describe('readinessHighlight', () => {
  const base = { status: 'ok' as const, form: -9, ramp: 1, rhrFlag: false };

  it('very tired with a high RHR outranks everything', () => {
    expect(readinessHighlight({ ...base, form: -32, ramp: 10, rhrFlag: true, pr: { bucket: '1k', daysAgo: 0 } }))
      .toEqual({ kind: 'veryTiredRhr' });
  });

  it('then building too fast, a PR, a race this week, a long gap', () => {
    expect(readinessHighlight({ ...base, form: -32, ramp: 10 })).toEqual({ kind: 'rampTooFast', ramp: 10 });
    expect(readinessHighlight({ ...base, pr: { bucket: '1k', daysAgo: 0 } })).toEqual({ kind: 'pr', bucket: '1k', when: 'today' });
    expect(readinessHighlight({ ...base, pr: { bucket: '5k', daysAgo: 2 }, race: { name: '10 ק״מ', daysLeft: 4 } }))
      .toEqual({ kind: 'race', name: '10 ק״מ', daysLeft: 4 });
    expect(readinessHighlight({ ...base, form: 31, daysSinceRun: 9 })).toEqual({ kind: 'noRun', days: 9 });
    expect(readinessHighlight(base)).toEqual({ kind: 'none' });
  });

  it('no ramp warning while learning', () => {
    expect(readinessHighlight({ ...base, status: 'learning', ramp: 12 })).toEqual({ kind: 'none' });
  });
});

describe('sortReadiness', () => {
  const rows = [
    { name: 'Shahar', form: -9, weekDone: 2, weekPlanned: 5 },
    { name: 'Alon', form: 31, weekDone: 0, weekPlanned: 4 },
    { name: 'Yoav', form: -32, weekDone: 4, weekPlanned: 5 },
    { name: 'Noa', form: null, weekDone: 1, weekPlanned: 0 },
    { name: 'Michal', form: 11, weekDone: 3, weekPlanned: 4 },
  ];

  it('tired: lowest form first, unknown last', () => {
    expect(sortReadiness(rows, 'tired').map(r => r.name)).toEqual(['Yoav', 'Shahar', 'Michal', 'Alon', 'Noa']);
  });

  it('week: least of the plan done first, no plan last', () => {
    expect(sortReadiness(rows, 'week').map(r => r.name)).toEqual(['Alon', 'Shahar', 'Michal', 'Yoav', 'Noa']);
  });

  it('name: alphabetical, and the input is untouched', () => {
    expect(sortReadiness(rows, 'name').map(r => r.name)).toEqual(['Alon', 'Michal', 'Noa', 'Shahar', 'Yoav']);
    expect(rows[0].name).toBe('Shahar');
  });
});

describe('projectionVerdict', () => {
  it('warns at −30, is in range while working, has room above', () => {
    expect(projectionVerdict(-30)).toBe('warn');
    expect(projectionVerdict(-20)).toBe('inRange');
    expect(projectionVerdict(-3)).toBe('room');
  });
});

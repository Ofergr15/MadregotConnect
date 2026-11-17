import { describe, expect, it } from 'vitest';
import { dowDay, israelDayOf, shortDay, surveyDateLine, surveyWaiting, validDay } from '@/lib/content/hub';
import { when } from '@/components/content/SurveyResults';

const HE = { surveyOpened: 'נפתח {date}', surveyStateOpen: 'פתוח', surveyStateClosed: 'נסגר' } as const;
const t = (k: keyof typeof HE, v?: { date: string }) => HE[k].replace('{date}', v?.date ?? '');
const noJunk = (s: string) => expect(s).not.toMatch(/undefined|NaN|Invalid/);

describe('survey closing dates (QA 11-17 #1)', () => {
  it('validDay accepts only real calendar days', () => {
    expect(validDay('2026-11-18')).toBe(true);
    for (const x of [null, undefined, '', 'Invalid Date', '2026-02-30', '2026-11-18T05:00:00Z', 'abc', 42]) expect(validDay(x)).toBe(false);
  });
  it('shortDay / dowDay never print undefined or NaN', () => {
    expect(shortDay('2026-11-18')).toBe('18.11');
    expect(dowDay('2026-11-18')).toBe('ד׳ 18.11');
    for (const x of [null, undefined, '', 'Invalid Date', '2026-11', 'garbage']) { expect(shortDay(x)).toBe(''); expect(dowDay(x)).toBe(''); }
  });
  it('israelDayOf: Israel day for valid ISO, null otherwise', () => {
    expect(israelDayOf('2026-11-17T22:30:00Z')).toBe('2026-11-18');
    expect(israelDayOf(null)).toBeNull();
    expect(israelDayOf(undefined)).toBeNull();
    expect(israelDayOf('not a date')).toBeNull();
  });
  const base = { id: 's1', title: 'מי בא לרוץ מחר בבוקר (5:00)?', answers: 1 };
  it.each([
    ['null', { until: null }, 'פתוח'],
    ['absent', {}, 'פתוח'],
    ['empty', { until: '' }, 'פתוח'],
    ['malformed', { until: 'Invalid Date' }, 'פתוח'],
    ['today', { until: '2026-11-17' }, 'נסגר היום'],
    ['tomorrow', { until: '2026-11-18' }, 'נסגר מחר'],
    ['later', { until: '2026-11-25' }, 'נסגר 25.11'],
  ])('surveyWaiting with %s closing date', (_n, extra, label) => {
    const w = surveyWaiting([{ ...base, ...extra }], 10, '2026-11-17');
    expect(w?.sub.startsWith(label)).toBe(true);
    noJunk(w!.sub);
  });
  it('SurveyResults when(): blank for missing/malformed, label for valid', () => {
    expect(when(null)).toBe('');
    expect(when(undefined)).toBe('');
    expect(when('garbage')).toBe('');
    const ok = when('2026-11-18T18:00:00Z');
    expect(ok).toBe('ד׳ 18.11 · 20:00');
  });
});

describe('same-titled surveys get their own date (QA 11-17 #2)', () => {
  it('surveyDateLine shows opened day + state', () => {
    expect(surveyDateLine({ createdAt: '2026-10-19T05:00:28Z', open: true }, t)).toBe('נפתח ב׳ 19.10 · פתוח');
    expect(surveyDateLine({ createdAt: '2026-10-08T05:00:27Z', open: false }, t)).toBe('נפתח ה׳ 8.10 · נסגר');
  });
  it('falls back to the state alone when created_at is bad', () => {
    expect(surveyDateLine({ createdAt: null, open: true }, t)).toBe('פתוח');
    expect(surveyDateLine({ createdAt: 'x', open: false }, t)).toBe('נסגר');
  });
  it('surveyWaiting carries the opened day', () => {
    const opened = (day: string) => { const w = surveyWaiting([{ id: 'a', title: 'x', answers: 0, day }], 5, '2026-11-17'); return w?.type === 'surveys' ? w.opened : null; };
    expect(opened('2026-10-19')).toBe('2026-10-19');
    expect(opened('bad')).toBe('');
  });
});

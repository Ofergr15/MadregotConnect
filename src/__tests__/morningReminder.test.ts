import { describe, expect, it } from 'vitest';
import {
  REMINDER_DEFAULT, adviceLine, decideMorningReminder, isDue, isolateNumbers, normalizeReminderTime,
  readReminderPatch, readReminderPref, reminderLedgerUrl, reminderLines, repCount, targetDateFor,
  type ReminderInput,
} from '@/lib/academy/morning-reminder';
import { renderReminder } from '@/lib/academy/morning-reminder-server';

/**
 * The morning reminder (trainee-experience-v2 screen 9, spec §3.7): when it is due, which
 * day it is about, every reason it stays quiet, and the third line — which only appears
 * when it changes the advice, and never cheers a trainee who is very tired.
 */

const TODAY = '2026-10-13';
const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Screen 4's Tuesday: 5 × 1 km at 4:05, 10.3 km, about 51 minutes, on the watch.
const CARD = {
  title: '5 × 1 ק״מ', distanceM: 10300, durationSec: 51 * 60, paceSec: 245 as number | null, paceOf: 'reps' as const, kind: 'quality' as 'quality' | 'easy', onWatch: true,
};

const base = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  pref: { enabled: true, time: '06:00' },
  nowMin: at('06:00'),
  today: TODAY,
  muted: false,
  hasPlan: true,
  card: CARD,
  alreadySent: false,
  ranBeforeSend: false,
  body: null,
  form: null,
  ...over,
});

describe('the preference', () => {
  it('defaults to on at 06:00 only once TRAINEE_V2_FOR_ALL is on', () => {
    expect(readReminderPref(null, true)).toEqual(REMINDER_DEFAULT);
    expect(readReminderPref({}, true)).toEqual({ enabled: true, time: '06:00' });
    // The preview: off unless switched on explicitly.
    expect(readReminderPref(null, false)).toEqual({ enabled: false, time: '06:00' });
    expect(readReminderPref({ morningReminder: { enabled: true, time: '05:30' } }, false)).toEqual({ enabled: true, time: '05:30' });
    expect(readReminderPref({ morningReminder: { enabled: false } }, true)).toEqual({ enabled: false, time: '06:00' });
  });

  it('keeps the time on the 5-minute grid, and a broken one falls back to the default', () => {
    expect(readReminderPref({ morningReminder: { enabled: true, time: '06:07' } }, false).time).toBe('06:05');
    expect(readReminderPref({ morningReminder: { enabled: true, time: '6am' } }, false).time).toBe('06:00');
    expect(normalizeReminderTime('06:08')).toBe('06:10');
    expect(normalizeReminderTime('23:59')).toBe('23:55');
    expect(normalizeReminderTime('24:00')).toBeNull();
    expect(normalizeReminderTime('6:00')).toBeNull();
    expect(normalizeReminderTime(600)).toBeNull();
  });

  it('validates the PATCH body: a boolean, an HH:MM, at least one of them', () => {
    expect(readReminderPatch({ morningReminder: { enabled: true } })).toEqual({ enabled: true });
    expect(readReminderPatch({ morningReminder: { time: '07:03' } })).toEqual({ time: '07:05' });
    expect(readReminderPatch({ morningReminder: { enabled: false, time: '21:30' } })).toEqual({ enabled: false, time: '21:30' });
    expect(readReminderPatch({ morningReminder: { enabled: 'yes' } })).toBeNull();
    expect(readReminderPatch({ morningReminder: { time: '7:00' } })).toBeNull();
    expect(readReminderPatch({ morningReminder: {} })).toBeNull();
    expect(readReminderPatch({})).toBeNull();
    expect(readReminderPatch(null)).toBeNull();
  });
});

describe('when and which day', () => {
  it('is due for 30 minutes from the chosen time, on the 5-minute grid', () => {
    expect(isDue(at('05:55'), '06:00')).toBe(false);
    expect(isDue(at('06:00'), '06:00')).toBe(true);
    expect(isDue(at('06:03'), '06:00')).toBe(true);
    expect(isDue(at('06:25'), '06:00')).toBe(true);
    expect(isDue(at('06:30'), '06:00')).toBe(false);
    // Never across midnight.
    expect(isDue(at('23:55'), '23:45')).toBe(true);
    expect(isDue(at('00:05'), '23:45')).toBe(false);
  });

  it('before 12:00 is about today, from 12:00 about tomorrow', () => {
    expect(targetDateFor('06:00', TODAY)).toBe(TODAY);
    expect(targetDateFor('11:55', TODAY)).toBe(TODAY);
    expect(targetDateFor('12:00', TODAY)).toBe('2026-10-14');
    expect(targetDateFor('20:30', TODAY)).toBe('2026-10-14');
  });
});

describe('every reason it stays quiet', () => {
  const reason = (over: Partial<ReminderInput>) => {
    const d = decideMorningReminder(base(over));
    return d.send ? 'sent!' : d.reason;
  };
  it('switched off, not the time, muted, no plan, a rest day, already sent, already run', () => {
    expect(reason({ pref: { enabled: false, time: '06:00' } })).toBe('disabled');
    expect(reason({ nowMin: at('05:55') })).toBe('notDue');
    expect(reason({ muted: true })).toBe('muted');
    expect(reason({ hasPlan: false, card: null })).toBe('noPlan');
    expect(reason({ card: null })).toBe('noWorkout');
    expect(reason({ alreadySent: true })).toBe('sent');
    expect(reason({ ranBeforeSend: true })).toBe('alreadyRan');
    expect(reason({ card: { ...CARD, done: true } })).toBe('alreadyRan');
  });

  it('a run today does not silence the evening preview of tomorrow', () => {
    const d = decideMorningReminder(base({ pref: { enabled: true, time: '20:00' }, nowMin: at('20:00'), ranBeforeSend: true }));
    expect(d).toMatchObject({ send: true, workoutDate: '2026-10-14' });
    if (d.send) expect(d.lines.title.params.when).toBe('tomorrow');
  });

  it('a second tick after the ledger row is written sends nothing', () => {
    const first = decideMorningReminder(base());
    expect(first.send).toBe(true);
    const ledger = new Set([reminderLedgerUrl('a1', TODAY)]);
    const second = decideMorningReminder(base({ nowMin: at('06:05'), alreadySent: ledger.has(reminderLedgerUrl('a1', TODAY)) }));
    expect(second).toEqual({ send: false, reason: 'sent' });
    expect(reminderLedgerUrl('a1', TODAY)).toBe('#ledger:academy-morning:a1:2026-10-13');
  });
});

describe('what it says', () => {
  it('lines 1 and 2: the session at its pace; km · minutes · on the watch', () => {
    const l = reminderLines({ card: CARD, when: 'today', body: null, form: null });
    expect(l.title).toEqual({ key: 'trainee.reminder.title', params: { when: 'today', title: '5 × 1 ק״מ', pace: '4:05' } });
    expect(l.facts.map(f => f.key)).toEqual(['trainee.reminder.km', 'trainee.reminder.min', 'trainee.reminder.onWatch']);
    expect(l.facts[0].params).toEqual({ km: '10.3' });
    expect(l.facts[1].params).toEqual({ min: 51 });
    expect(reminderLines({ card: { ...CARD, onWatch: false }, when: 'today', body: null, form: null }).facts[2].key).toBe('trainee.reminder.notOnWatch');
    expect(reminderLines({ card: { ...CARD, paceSec: null }, when: 'today', body: null, form: null }).title.key).toBe('trainee.reminder.titleNoPace');
  });

  it('renders screen 9 in Hebrew, every number isolated', () => {
    const lines = reminderLines({ card: CARD, when: 'today', body: { rhr: 'bitHigh', sleep: 'normal' }, form: { form: -9, band: 'maintain' } });
    const { title, body } = renderReminder(lines, 'he');
    const plain = (s: string) => s.replace(/[⁦-⁩]/g, '');
    expect(plain(title)).toBe('היום: 5 × 1 ק״מ ב־4:05');
    expect(plain(body)).toBe('10.3 ק״מ · כ־51 דק׳ · ⌚ נשלח ל־Garmin\nהדופק קצת גבוה הבוקר. אם החזרות כבדות, מותר לעצור ב־4.');
    // "5 × 1" and "4:05" each sit inside LRI … PDI, so the lock screen keeps their order.
    expect(title).toContain('⁦5 × 1⁩');
    expect(title).toContain('⁦4:05⁩');
    expect(renderReminder(lines, 'en').title.replace(/[⁦-⁩]/g, '')).toBe('Today: 5 × 1 ק״מ at 4:05');
  });

  it('isolates only the number runs of a name', () => {
    expect(isolateNumbers('3 × 2 ק״מ טמפו')).toBe('⁦3 × 2⁩ ק״מ טמפו');
    expect(isolateNumbers('ריצה קלה')).toBe('ריצה קלה');
    expect(repCount('5 × 1 ק״מ')).toBe(5);
    expect(repCount('ריצה קלה')).toBeNull();
  });
});

describe('line 3 — only when it changes the advice', () => {
  const line = (body: Parameters<typeof adviceLine>[0]['body'], form: Parameters<typeof adviceLine>[0]['form'], card = CARD) =>
    adviceLine({ body, form, card })?.key ?? null;

  it('the matrix', () => {
    const k = (s: string) => `trainee.reminder.advice.${s}`;
    // Nothing known, or nothing unusual: no line.
    expect(line(null, null)).toBeNull();
    expect(line({ rhr: 'normal', sleep: 'normal' }, { form: -9, band: 'maintain' })).toBeNull();
    // A high RHR or a short night: lower the intensity — on reps, the rep you may stop at.
    expect(line({ rhr: 'bitHigh', sleep: 'normal' }, null)).toBe(k('rhrBitHighReps'));
    expect(adviceLine({ body: { rhr: 'bitHigh', sleep: 'normal' }, form: null, card: CARD })?.params).toEqual({ n: 4 });
    expect(line({ rhr: 'high', sleep: null }, null)).toBe(k('rhrHighReps'));
    expect(line({ rhr: null, sleep: 'less' }, null)).toBe(k('sleepLowReps'));
    expect(line({ rhr: null, sleep: 'veryLittle' }, null, { ...CARD, kind: 'easy', title: 'ריצה קלה' })).toBe(k('sleepLow'));
    expect(line({ rhr: 'high', sleep: 'normal' }, null, { ...CARD, kind: 'easy', title: 'ריצה קלה' })).toBe(k('rhrHigh'));
    // A low RHR and a long night are good news, not a line.
    expect(line({ rhr: 'low', sleep: 'more' }, null)).toBeNull();
    // Good form (≥5): "רעננות טובה".
    expect(line(null, { form: 5, band: 'fresh' })).toBe(k('freshQuality'));
    expect(line(null, { form: 12, band: 'fresh' }, { ...CARD, kind: 'easy' })).toBe(k('fresh'));
    expect(line(null, { form: 4, band: 'maintain' })).toBeNull();
  });

  it('never cheers a trainee who is very tired, or whose body says otherwise', () => {
    expect(line(null, { form: -32, band: 'veryTired' })).toBeNull();
    // Fresh on paper, but the RHR is up: the body wins, no cheer.
    expect(line({ rhr: 'bitHigh', sleep: 'normal' }, { form: 12, band: 'fresh' })).toBe('trainee.reminder.advice.rhrBitHighReps');
    const d = decideMorningReminder(base({ form: { form: -32, band: 'veryTired' } }));
    expect(d.send && d.lines.advice).toBeNull();
  });
});

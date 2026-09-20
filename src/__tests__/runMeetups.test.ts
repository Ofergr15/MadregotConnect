import { describe, it, expect } from 'vitest';
import {
  validateMeetupDraft,
  isUpcomingMeetup,
  sortMeetups,
  paceToSeconds,
  paceMatch,
  daysBetween,
  MEETUP_HORIZON_DAYS,
  MAX_NOTES_LENGTH,
} from '@/lib/runs/meetups';

/**
 * Run meetups (398963c7).
 *
 * The two things worth testing are the validator — it is the gate in front of a
 * service-role INSERT, and every field on it is typed by a member on a phone —
 * and the upcoming rule, which decides whether this morning's run is still on
 * the board while the group is actually out running it.
 */

const TODAY = '2026-09-18';

const VALID = {
  date: '2026-09-20',
  startTime: '06:30',
  location: 'Park HaYarkon, north gate',
  plannedPace: '5:10',
  distanceKm: 14,
  notes: 'Easy long run, stopping for water at 7k',
};

describe('validateMeetupDraft', () => {
  it('accepts a complete draft and returns it normalised', () => {
    const res = validateMeetupDraft(VALID, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      date: '2026-09-20',
      startTime: '06:30',
      location: 'Park HaYarkon, north gate',
      plannedPace: '5:10',
      distanceKm: 14,
      notes: 'Easy long run, stopping for water at 7k',
    });
  });

  it('accepts today — a run this evening is the most likely thing anybody posts', () => {
    expect(validateMeetupDraft({ ...VALID, date: TODAY }, TODAY).ok).toBe(true);
  });

  it('refuses a date in the past, naming the field', () => {
    const res = validateMeetupDraft({ ...VALID, date: '2026-09-17' }, TODAY);
    expect(res).toEqual({ ok: false, field: 'date', reason: 'past' });
  });

  it('refuses a date past the horizon', () => {
    const far = daysBetween(TODAY, TODAY) + MEETUP_HORIZON_DAYS + 1;
    const d = new Date(`${TODAY}T12:00:00`);
    d.setDate(d.getDate() + far);
    const iso = d.toISOString().slice(0, 10);
    expect(validateMeetupDraft({ ...VALID, date: iso }, TODAY)).toEqual({
      ok: false,
      field: 'date',
      reason: 'tooFar',
    });
  });

  it('pads a single-digit hour so the board sorts as text', () => {
    const res = validateMeetupDraft({ ...VALID, startTime: '6:30' }, TODAY);
    expect(res.ok && res.value.startTime).toBe('06:30');
  });

  it('refuses a time that is not a 24-hour clock time', () => {
    for (const startTime of ['24:00', '6:60', '630', '6', 'morning', '18:5', '']) {
      expect(validateMeetupDraft({ ...VALID, startTime }, TODAY), startTime).toMatchObject({
        ok: false,
        field: 'startTime',
      });
    }
  });

  it('requires a location — "somewhere" is not a meetup', () => {
    expect(validateMeetupDraft({ ...VALID, location: '   ' }, TODAY)).toEqual({
      ok: false,
      field: 'location',
      reason: 'required',
    });
  });

  it('refuses an over-long location', () => {
    expect(validateMeetupDraft({ ...VALID, location: 'x'.repeat(81) }, TODAY)).toMatchObject({
      ok: false,
      field: 'location',
      reason: 'tooLong',
    });
  });

  /** The pace is optional, and absent must mean null so the card shows no pace row. */
  it('treats an absent pace as null rather than an empty string', () => {
    const res = validateMeetupDraft({ ...VALID, plannedPace: '' }, TODAY);
    expect(res.ok && res.value.plannedPace).toBeNull();
    const res2 = validateMeetupDraft({ ...VALID, plannedPace: undefined }, TODAY);
    expect(res2.ok && res2.value.plannedPace).toBeNull();
  });

  it('refuses a pace that is not a running pace', () => {
    for (const plannedPace of ['1:30', '13:00', '5:70', '5', '5.30', '50:00']) {
      expect(validateMeetupDraft({ ...VALID, plannedPace }, TODAY), plannedPace).toMatchObject({
        ok: false,
        field: 'plannedPace',
      });
    }
  });

  it('accepts a distance as a form string and rounds to 2dp', () => {
    const res = validateMeetupDraft({ ...VALID, distanceKm: '21.0975' }, TODAY);
    expect(res.ok && res.value.distanceKm).toBe(21.1);
  });

  /** Clamping would send somebody to a run that is not the one they read about. */
  it('refuses an impossible distance instead of clamping it', () => {
    for (const distanceKm of [0, -5, 420, 'ten']) {
      expect(validateMeetupDraft({ ...VALID, distanceKm }, TODAY), String(distanceKm)).toMatchObject({
        ok: false,
        field: 'distanceKm',
      });
    }
    const res = validateMeetupDraft({ ...VALID, distanceKm: '' }, TODAY);
    expect(res.ok && res.value.distanceKm).toBeNull();
  });

  it('truncates notes rather than refusing the whole meetup over them', () => {
    const res = validateMeetupDraft({ ...VALID, notes: 'n'.repeat(400) }, TODAY);
    expect(res.ok && res.value.notes?.length).toBe(MAX_NOTES_LENGTH);
  });

  it('ignores non-string junk in every optional field', () => {
    const res = validateMeetupDraft({ ...VALID, notes: { evil: true }, plannedPace: null }, TODAY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.notes).toBeNull();
    expect(res.value.plannedPace).toBeNull();
  });
});

describe('isUpcomingMeetup', () => {
  /** The reason the rule is by date and not by date-plus-time. */
  it("keeps this morning's run on the board all day", () => {
    expect(isUpcomingMeetup({ date: TODAY, status: 'open' }, TODAY)).toBe(true);
  });

  it('drops yesterday', () => {
    expect(isUpcomingMeetup({ date: '2026-09-17', status: 'open' }, TODAY)).toBe(false);
  });

  it('drops a cancelled meetup even when it is still in the future', () => {
    expect(isUpcomingMeetup({ date: '2026-09-25', status: 'cancelled' }, TODAY)).toBe(false);
  });

  it('treats a missing status as open', () => {
    expect(isUpcomingMeetup({ date: '2026-09-25' }, TODAY)).toBe(true);
  });
});

describe('sortMeetups', () => {
  it('orders by date then clock time, and does not mutate its input', () => {
    const input = [
      { date: '2026-09-20', startTime: '18:00' },
      { date: '2026-09-19', startTime: '06:00' },
      { date: '2026-09-20', startTime: '06:30' },
    ];
    const copy = [...input];
    expect(sortMeetups(input).map(m => `${m.date} ${m.startTime}`)).toEqual([
      '2026-09-19 06:00',
      '2026-09-20 06:30',
      '2026-09-20 18:00',
    ]);
    expect(input).toEqual(copy);
  });
});

describe('paceToSeconds', () => {
  it('reads a pace', () => {
    expect(paceToSeconds('5:00')).toBe(300);
    expect(paceToSeconds('4:45')).toBe(285);
    expect(paceToSeconds(' 6:05 ')).toBe(365);
  });

  it('is null for anything that is not one', () => {
    for (const p of [null, undefined, '', '5', '5.5', '90:00', 'fast']) {
      expect(paceToSeconds(p), String(p)).toBeNull();
    }
  });
});

describe('paceMatch', () => {
  it('calls 15 s/km or less the same run', () => {
    expect(paceMatch('5:00', '5:00')).toBe('close');
    expect(paceMatch('5:00', '5:15')).toBe('close');
    expect(paceMatch('5:15', '5:00')).toBe('close');
  });

  it('calls up to 30 s/km near', () => {
    expect(paceMatch('5:00', '5:16')).toBe('near');
    expect(paceMatch('5:00', '5:30')).toBe('near');
  });

  it('calls a bigger gap far', () => {
    expect(paceMatch('4:30', '6:00')).toBe('far');
  });

  /** Says nothing rather than guessing — half the offers carry no pace. */
  it('is null when either side has no pace to compare', () => {
    expect(paceMatch(null, '5:00')).toBeNull();
    expect(paceMatch('5:00', null)).toBeNull();
    expect(paceMatch('not a pace', '5:00')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-09-18', '2026-09-20')).toBe(2);
    expect(daysBetween('2026-09-20', '2026-09-18')).toBe(-2);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });

  /** Noon anchoring: a DST boundary must not turn a day into 23 hours. */
  it('survives a DST boundary', () => {
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(daysBetween('2026-03-26', '2026-03-28')).toBe(2);
  });
});

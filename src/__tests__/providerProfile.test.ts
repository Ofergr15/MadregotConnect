import { describe, expect, it, vi } from 'vitest';
import {
  fillMissingProfileFields,
  garminProfileFields,
  normalizeBirthDate,
  normalizeGender,
  profileFillUpdates,
  stravaProfileFields,
  wantsProviderProfile,
} from '@/lib/providers/profile';

/**
 * Auto-filling a member's own details from their watch account is only acceptable
 * while two things hold: it never overwrites what they typed themselves, and a
 * value it can't trust becomes null rather than a guess. Both are tested here,
 * because the failure mode isn't a broken screen — it's a wrong birth date nobody
 * is ever asked to correct, since filling the field also marks the setup task done.
 */

describe('normalizeGender', () => {
  it('accepts each provider spelling', () => {
    // Garmin says MALE, Strava says M, the column holds 'male'.
    expect(normalizeGender('MALE')).toBe('male');
    expect(normalizeGender('M')).toBe('male');
    expect(normalizeGender('female')).toBe('female');
    expect(normalizeGender('F')).toBe('female');
  });

  it('returns null for anything it does not recognise', () => {
    // notifications/copy.ts picks a gendered Hebrew verb from this value, so a
    // guess here misaddresses the member in every push they get.
    for (const raw of [undefined, null, '', 'X', 'other', 'unspecified', 0]) {
      expect(normalizeGender(raw)).toBeNull();
    }
  });
});

describe('normalizeBirthDate', () => {
  it('keeps the date half of whatever shape the provider sends', () => {
    expect(normalizeBirthDate('1985-10-05')).toBe('1985-10-05');
    expect(normalizeBirthDate('1985-10-05T00:00:00.000Z')).toBe('1985-10-05');
  });

  it('rejects implausible and malformed values', () => {
    expect(normalizeBirthDate('0001-01-01')).toBeNull();
    expect(normalizeBirthDate(`${new Date().getFullYear()}-01-01`)).toBeNull();
    expect(normalizeBirthDate('1985-13-05')).toBeNull();
    expect(normalizeBirthDate('05/10/1985')).toBeNull();
    expect(normalizeBirthDate(null)).toBeNull();
  });
});

describe('profileFillUpdates', () => {
  it('fills only what is blank', () => {
    expect(profileFillUpdates({ gender: null, birth_date: null }, { gender: 'male', birthDate: '1990-01-16' }))
      .toEqual({ gender: 'male', birth_date: '1990-01-16' });
  });

  it('never overwrites what the athlete answered themselves', () => {
    // The rule the whole feature rests on: the member's own answer wins over the
    // watch account, always.
    expect(profileFillUpdates({ gender: 'female', birth_date: '1990-01-16' }, { gender: 'male', birthDate: '1970-01-01' }))
      .toEqual({});
  });

  it('writes nothing when the provider had no answer', () => {
    expect(profileFillUpdates({ gender: null, birth_date: null }, { gender: null, birthDate: null })).toEqual({});
  });

  it('knows when a row is not worth a provider request', () => {
    expect(wantsProviderProfile({ gender: 'male', birth_date: '1990-01-16' })).toBe(false);
    expect(wantsProviderProfile({ gender: 'male', birth_date: null })).toBe(true);
    expect(wantsProviderProfile({})).toBe(true);
  });
});

describe('provider readers', () => {
  it('reads gender and birth date out of Garmin user settings', () => {
    const client = { getUserSettings: async () => ({ userData: { gender: 'MALE', birthDate: '1985-10-05', weight: 72000 } }) };
    return expect(garminProfileFields(client)).resolves.toEqual({ gender: 'male', birthDate: '1985-10-05' });
  });

  it('survives a Garmin account with no userData at all', () => {
    return expect(garminProfileFields({ getUserSettings: async () => null }))
      .resolves.toEqual({ gender: null, birthDate: null });
  });

  it('reads sex from Strava and reports no birth date', () => {
    // Not an oversight: Strava's API has no birth date at any scope, so a
    // Strava-only member still gets asked for theirs.
    return expect(stravaProfileFields({ getAthlete: async () => ({ sex: 'F' }) }))
      .resolves.toEqual({ gender: 'female', birthDate: null });
  });
});

/** Minimal PostgREST double: `.from().update().eq()`. */
function supabaseDouble(result: { error: { message: string } | null } = { error: null }) {
  const eq = vi.fn().mockResolvedValue(result);
  const update = vi.fn(() => ({ eq }));
  return { client: { from: vi.fn(() => ({ update })) } as never, update, eq };
}

describe('fillMissingProfileFields', () => {
  it('does not call the provider when nothing is missing', async () => {
    const fetchFields = vi.fn();
    const { client, update } = supabaseDouble();
    expect(await fillMissingProfileFields(client, 'a1', { gender: 'male', birth_date: '1990-01-16' }, fetchFields)).toEqual([]);
    // The cost control: this runs per athlete per sync, so a filled row must not
    // spend a Garmin request on a question that is already answered.
    expect(fetchFields).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('writes only the blank column and reports it', async () => {
    const { client, update } = supabaseDouble();
    const filled = await fillMissingProfileFields(
      client,
      'a1',
      { gender: 'male', birth_date: null },
      async () => ({ gender: 'female', birthDate: '1991-06-21' }),
    );
    expect(filled).toEqual(['birth_date']);
    expect(update).toHaveBeenCalledWith({ birth_date: '1991-06-21' });
  });

  it('skips the write entirely when the provider adds nothing', async () => {
    const { client, update } = supabaseDouble();
    expect(await fillMissingProfileFields(client, 'a1', { gender: 'male' }, async () => ({ birthDate: null }))).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it('swallows a provider that throws', async () => {
    // It runs inside the activity sync. An unanswered profile question must never
    // cost the athlete their runs.
    const { client } = supabaseDouble();
    await expect(
      fillMissingProfileFields(client, 'a1', {}, async () => { throw new Error('Garmin 500'); }),
    ).resolves.toEqual([]);
  });

  it('swallows a failed write', async () => {
    const { client } = supabaseDouble({ error: { message: 'column does not exist' } });
    await expect(
      fillMissingProfileFields(client, 'a1', {}, async () => ({ gender: 'male' })),
    ).resolves.toEqual([]);
  });
});

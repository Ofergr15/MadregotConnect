/**
 * Gender and date of birth, taken from the watch account instead of from a form.
 *
 * Measured on prod 2026-09-11: of 26 active members, 12 had a birth date and 11 a
 * phone number. The provider can answer two of those three — Garmin Connect's
 * user settings carry `birthDate` and `gender`, and Strava's athlete carries `sex`
 * (we already request the `profile:read_all` scope that returns it). **Neither
 * provider exposes a phone number at any scope**, so that one stays a question we
 * have to ask.
 *
 * Two rules hold everywhere in this file:
 *
 *  - **Only ever fill a blank.** What the athlete typed about themselves wins over
 *    what a watch account says, always — the point is to stop asking, not to
 *    overwrite an answer. That also makes the whole thing re-runnable: once a
 *    field is set nothing here touches it again.
 *  - **Never break the caller.** This runs inside the activity syncs. A provider
 *    that won't answer a profile question must cost nothing more than the profile
 *    question.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** The columns this can fill, as a PostgREST select fragment. */
export const PROVIDER_PROFILE_COLUMNS = 'gender, birth_date';

export type Gender = 'male' | 'female';

export interface ProviderProfileFields {
  gender?: Gender | null;
  birthDate?: string | null;
}

/**
 * Providers disagree on spelling: Garmin says `MALE`, Strava says `M`. The column
 * holds the app's own lowercase words, which `notifications/copy.ts` reads to pick
 * a Hebrew verb form — so anything unrecognised must come back null rather than be
 * guessed at, or a member gets addressed wrongly in every push they receive.
 */
export function normalizeGender(raw: unknown): Gender | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return null;
}

/**
 * `birth_date` is a DATE column, and Garmin has been seen returning both
 * `1985-10-05` and a full timestamp. Anything that isn't a plausible birth date
 * is dropped: a bad value here is not a wrong pixel, it's an age that decides
 * age-group placings, and it would also silently mark the "personal info" setup
 * task complete so nobody is ever asked again.
 */
export function normalizeBirthDate(raw: unknown): string | null {
  const m = String(raw ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [iso, year, month, day] = [m[0], Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1920 || year > new Date().getFullYear() - 5) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return iso;
}

export interface ProfileRow {
  gender?: string | null;
  birth_date?: string | null;
}

/** Whether it is worth spending a provider request on this row at all. */
export function wantsProviderProfile(row: ProfileRow): boolean {
  return !row.gender || !row.birth_date;
}

/**
 * The update to write: blank columns only, and only where the provider actually
 * answered. Returns `{}` when there is nothing to do, which the caller treats as
 * "don't write" — an empty PostgREST update is a request that touches a row for
 * no reason and bumps nothing but its `updated_at`.
 */
export function profileFillUpdates(
  row: ProfileRow,
  incoming: ProviderProfileFields,
): Record<string, string> {
  const updates: Record<string, string> = {};
  if (!row.gender && incoming.gender) updates.gender = incoming.gender;
  if (!row.birth_date && incoming.birthDate) updates.birth_date = incoming.birthDate;
  return updates;
}

/** Garmin Connect's user settings: `userData.gender` and `userData.birthDate`. */
export async function garminProfileFields(client: {
  getUserSettings: () => Promise<unknown>;
}): Promise<ProviderProfileFields> {
  const settings = (await client.getUserSettings()) as { userData?: Record<string, unknown> } | null;
  const userData = settings?.userData || {};
  return {
    gender: normalizeGender(userData.gender),
    birthDate: normalizeBirthDate(userData.birthDate),
  };
}

/**
 * Strava's athlete: `sex` only. Strava has no birth date in its API — not at any
 * scope — so a Strava-only member is still asked for theirs.
 */
export async function stravaProfileFields(client: {
  getAthlete: () => Promise<{ sex?: string | null } | null>;
}): Promise<ProviderProfileFields> {
  const athlete = await client.getAthlete();
  return { gender: normalizeGender(athlete?.sex), birthDate: null };
}

/**
 * Fill what's blank on one athlete from one provider. Swallows everything: called
 * from the sync loop, where an unanswered profile question must not cost the
 * athlete their runs.
 *
 * Returns the columns it filled, so a sync can report them.
 */
export async function fillMissingProfileFields(
  supabase: SupabaseClient,
  athleteId: string,
  row: ProfileRow,
  fetchFields: () => Promise<ProviderProfileFields>,
): Promise<string[]> {
  if (!wantsProviderProfile(row)) return [];
  try {
    const updates = profileFillUpdates(row, await fetchFields());
    if (Object.keys(updates).length === 0) return [];
    const { error } = await supabase.from('athletes').update(updates).eq('id', athleteId);
    if (error) {
      console.warn(`Provider profile fill failed for ${athleteId}:`, error.message);
      return [];
    }
    return Object.keys(updates);
  } catch (error) {
    console.warn(`Provider profile fill skipped for ${athleteId}:`, error);
    return [];
  }
}

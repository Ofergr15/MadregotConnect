import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { clubMatchFor, isFormMadeAccount, type LinkableAthlete } from './link';

/**
 * The roster as the candidate matcher reads it, server-side: for the board's
 * "נראה שהוא כבר במועדון" row and the staff mail about a new applicant.
 * `approved` rides along because only an approved row is a club member.
 */
export type RosterRow = LinkableAthlete & { approved: boolean; status: string | null };

export async function readRosterForMatching(supabase: SupabaseClient): Promise<RosterRow[]> {
  let { data, error }: { data: any[] | null; error: any } = await supabase
    .from('athletes')
    .select('id, name, email, phone, approved, status, onboarding_status, is_academy, created_at, strava_auth')
    .eq('coach_id', COACH_ID);
  if (error) {
    // A column this database does not have yet: the matcher works on less.
    ({ data, error } = await supabase
      .from('athletes')
      .select('id, name, email, approved, status, onboarding_status, is_academy, created_at')
      .eq('coach_id', COACH_ID));
  }
  if (error || !data) return [];
  return data.map((a: any) => ({
    id: String(a.id),
    name: String(a.name || ''),
    email: typeof a.email === 'string' ? a.email : null,
    phone: typeof a.phone === 'string' ? a.phone : null,
    approved: a.approved === true,
    status: a.status ?? null,
    onboardingStatus: a.onboarding_status ?? null,
    isAcademy: !!a.is_academy,
    createdAt: a.created_at ?? null,
    hasStrava: !!a.strava_auth,
  }));
}

/** The rows that are somebody already in the club. */
export function clubMembers(rows: readonly RosterRow[]): RosterRow[] {
  return rows.filter(r => r.approved && r.status !== 'removed');
}

export interface ClubMatch {
  athleteId: string;
  name: string;
  confidence: 'exact' | 'likely';
  text: string;
  hasStrava: boolean;
}

/**
 * The board's "נראה שהוא כבר במועדון" row, per card: for each open card that is not yet on a
 * member's account (unlinked, or on the account the form opened), the one member it most
 * likely is. `linkedFromForm` marks the second case, so the sheet can offer to move it.
 */
export function clubMatchesFor(
  cards: ReadonlyArray<{ id: string; name: string; email?: string | null; phone?: string | null; athlete_id?: string | null; archived_at?: string | null }>,
  roster: readonly RosterRow[],
): Record<string, { linkedFromForm: boolean; clubMatch: ClubMatch | null }> {
  const byId = new Map(roster.map(r => [r.id, r]));
  const members = clubMembers(roster);
  const takenBy: Record<string, string> = {};
  for (const c of cards) if (c.athlete_id) takenBy[String(c.athlete_id)] = String(c.id);

  const out: Record<string, { linkedFromForm: boolean; clubMatch: ClubMatch | null }> = {};
  for (const c of cards) {
    const linked = c.athlete_id ? byId.get(String(c.athlete_id)) : undefined;
    const linkedFromForm = !!linked && isFormMadeAccount(linked) && !linked.approved;
    if (c.archived_at || (c.athlete_id && !linkedFromForm)) {
      out[String(c.id)] = { linkedFromForm, clubMatch: null };
      continue;
    }
    const m = clubMatchFor(
      { id: String(c.id), name: String(c.name || ''), email: c.email ?? null, phone: c.phone ?? null, athleteId: c.athlete_id ?? null },
      members,
      { takenBy },
    );
    out[String(c.id)] = {
      linkedFromForm,
      clubMatch: m && m.confidence !== 'weak'
        ? { athleteId: m.athlete.id, name: m.athlete.name, confidence: m.confidence, text: m.text, hasStrava: !!m.athlete.hasStrava }
        : null,
    };
  }
  return out;
}

/**
 * The roster name of the one club member a new form applicant probably is, for the staff
 * push and mail ("ייתכן שזה Avi Barak מהמועדון"). Null on no clear match or any failure:
 * a guess must never cost the applicant their registration.
 */
export async function likelyClubMember(
  supabase: SupabaseClient,
  applicant: { name: string; email?: string | null; phone?: string | null; athleteId?: string | null },
): Promise<string | null> {
  try {
    const roster = await readRosterForMatching(supabase);
    const m = clubMatchFor(
      { id: 'form', name: applicant.name, email: applicant.email ?? null, phone: applicant.phone ?? null, athleteId: applicant.athleteId ?? null },
      clubMembers(roster),
    );
    return m ? m.athlete.name : null;
  } catch {
    return null;
  }
}

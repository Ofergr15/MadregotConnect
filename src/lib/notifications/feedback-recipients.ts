import type { SupabaseClient } from '@supabase/supabase-js';
import { coachIdsOf } from '@/lib/academy/trainee-coaches';
import { academyManagerAthleteIds } from '@/lib/academy/thread-server';

// Who hears a runner's flagged workout feedback — pain, "very hard", or "I'd like a
// reply" — besides the routed staff list (2026-10-19).
//
// The routed list (`notifyStaff`, Control Room → התראות) resolved to the operator
// account alone, so in two months the club's coach received none of the 16 alerts
// and none of the 8 reply requests got an answer: the job existed, but only on an
// account nobody coaches from. staff.ts says what the fix must be — this caller gets
// its own recipient list rather than widening the shared fallback a third time:
//
//   - an academy trainee: every coach of theirs (all equal), plus the academy
//     managers (academy_manager holders and super users — the chat's own definition,
//     thread-server.ts), who have authority over every trainee; a trainee with no
//     coach still reaches the managers;
//   - a club runner: the club's coaches (`coach`, as the primary role or an extra one).
//
// The `Test Coach` fixture (a non-Strava `@madregot.local` address) is left out:
// it holds the coach role for QA, and an alert to it is an alert to nobody.

export interface FeedbackRecipientFacts {
  isAcademy: boolean;
  academyCoaches: string[];
  managers: string[];
  clubCoaches: string[];
}

/** The people a flagged feedback reaches, and whose job it is: their coach, or the managers. */
export function pickFeedbackRecipients(
  runnerId: string,
  f: FeedbackRecipientFacts,
): { ids: string[]; to: 'coach' | 'managers' | null; academy: boolean } {
  const without = (ids: string[]) => [...new Set(ids.filter((id) => id && id !== runnerId))];
  if (f.isAcademy) {
    const coaches = without(f.academyCoaches);
    const ids = without([...coaches, ...f.managers]);
    return { ids, to: coaches.length ? 'coach' : ids.length ? 'managers' : null, academy: true };
  }
  const ids = without(f.clubCoaches);
  return { ids, to: ids.length ? 'coach' : null, academy: false };
}

/** A QA fixture account: `@madregot.local`, but not the synthetic Strava address real people sign in with. */
export function isFixtureEmail(email: string | null | undefined): boolean {
  const e = (email || '').trim().toLowerCase();
  return e.endsWith('@madregot.local') && !e.endsWith('@strava.madregot.local');
}

/** Reads the facts and picks. Best-effort: a failed read costs only that source. */
export async function feedbackRecipients(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  runnerId: string,
): Promise<ReturnType<typeof pickFeedbackRecipients>> {
  const { data: runner } = await supabase.from('athletes').select('is_academy').eq('id', runnerId).maybeSingle();
  const isAcademy = !!runner?.is_academy;
  let academyCoaches: string[] = [];
  let managers: string[] = [];
  let clubCoaches: string[] = [];
  if (isAcademy) {
    [academyCoaches, managers] = await Promise.all([
      coachIdsOf(supabase, runnerId).catch(() => [] as string[]),
      academyManagerAthleteIds(supabase),
    ]);
  } else {
    const none = { data: [], error: null };
    const [primary, extra] = await Promise.all([
      Promise.resolve().then(() => supabase.from('athletes').select('id, email, status').eq('role', 'coach')).catch(() => none),
      // `extra_roles` is migration 127; a database without it is primary roles only.
      Promise.resolve().then(() => supabase.from('athletes').select('id, email, status').contains('extra_roles', ['coach'])).catch(() => none),
    ]);
    const rows = [...(primary.error ? [] : primary.data || []), ...(extra.error ? [] : extra.data || [])] as Array<{ id: string; email: string | null; status?: string | null }>;
    clubCoaches = rows.filter((r) => !isFixtureEmail(r.email) && (r.status ?? 'active') === 'active').map((r) => r.id);
  }
  return pickFeedbackRecipients(runnerId, { isAcademy, academyCoaches, managers, clubCoaches });
}

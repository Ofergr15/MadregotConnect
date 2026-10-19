import { NextResponse } from 'next/server';
import { revalidateTag, unstable_cache } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/encryption';
import { StravaClient, type StravaTokens } from '@/lib/strava/client';
import { getValidStravaToken } from '@/lib/strava/enrich';
import { requireCallerForAthlete } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

/**
 * GET /api/strava/account-check?athleteId=<uuid>
 *
 * Is the Strava account linked to this athlete plausibly THEIRS?
 *
 * Why this exists: the OAuth callback accepts whatever account authorises, and a
 * member who is not already signed in to Strava on that device is offered SIGNUP,
 * not sign-in. Yosi Sabag took that door (measured 2026-09-13): his row carried
 * strava_athlete_id 659081577 — an account created 2026-03-10, display name still
 * the default "Strava Athlete", zero activities, zero gear, zero followers,
 * profile untouched since two seconds after signup — while his real Strava,
 * 95594601, had never been connected at all. Nothing in the app noticed. The
 * profile screen showed a green "מחובר" pill for eight weeks, the poll rotation
 * spent API budget on an empty account every few hours, and his personal records
 * silently came from Garmin alone.
 *
 * An empty account is the one signal that separates the two cases cleanly, and it
 * can only be read with the athlete's own token — so it is read here, server-side,
 * and the profile screen asks this route rather than trusting the pill.
 *
 * Deliberately NOT a fix-it endpoint: it reports, and the member decides. A
 * "connected to an empty account" state is also what a genuinely new runner looks
 * like on their first day, and silently unlinking them would be worse than the bug.
 *
 * Self-or-staff, like every other athlete-scoped route: a runner may check their
 * own link, a coach may check anyone's.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const athleteId = searchParams.get('athleteId');
  if (!athleteId) {
    return NextResponse.json({ error: 'athleteId required' }, { status: 400 });
  }

  const { denied, caller } = await requireCallerForAthlete(request, athleteId);
  if (denied) return denied;

  const supabase = createServerClient();
  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name, strava_athlete_id, strava_auth')
    .eq('id', athleteId)
    .maybeSingle();

  if (!athlete) {
    return NextResponse.json({ error: 'athlete not found' }, { status: 404 });
  }
  if (!athlete.strava_auth) {
    return NextResponse.json({ linked: false });
  }
  // An admin viewing the app as this athlete (lib/auth/view-as.ts) does not get to
  // call Strava with their credential: refreshing it would rewrite strava_auth.
  if (caller.viewingAsBy) {
    return NextResponse.json({
      linked: true,
      stravaAthleteId: athlete.strava_athlete_id ?? null,
      checkable: false,
      reason: 'view_as',
    });
  }

  let auth: StravaTokens;
  try {
    auth = decrypt(athlete.strava_auth as string) as StravaTokens;
  } catch {
    // A key rotation or a truncated column. Reported rather than thrown: the
    // caller's question is "is this link healthy", and this is an answer to it.
    return NextResponse.json({
      linked: true,
      stravaAthleteId: athlete.strava_athlete_id ?? null,
      checkable: false,
      reason: 'decrypt_failed',
    });
  }

  // A burst of opens (a release announcement sends the whole club in at once) used to
  // spend two Strava reads per member on a question whose answer only changes when they
  // reconnect: 2026-10-18 22:04 and 22:28, twice "read rate limit exceeded" right after
  // the 21:55 announcement, on the club's one shared Strava quota — the same quota the
  // syncs need. A healthy answer is kept a week per linked account; an empty-account
  // or failed answer is not kept, so a warning never outlives the member's first run.
  const result = await cachedCheck(athleteId, athlete.strava_athlete_id ?? null, auth);
  if (!(result.checkable && result.hasActivities)) revalidateTag(checkTag(athleteId), { expire: 0 });
  return NextResponse.json(result);
}

const checkTag = (athleteId: string) => `strava-account-check:${athleteId}`;

interface CheckResult {
  linked: true;
  checkable: boolean;
  stravaAthleteId: number | null;
  stravaName?: string | null;
  placeholderName?: boolean;
  hasActivities?: boolean;
  reason?: string;
}

/** Keyed by the athlete AND the linked account, so connecting another account asks again. */
function cachedCheck(athleteId: string, stravaAthleteId: number | null, auth: StravaTokens): Promise<CheckResult> {
  return unstable_cache(() => askStrava(athleteId, stravaAthleteId, auth), ['strava-account-check-v1', athleteId, String(stravaAthleteId)], {
    revalidate: 7 * 24 * 3600,
    tags: [checkTag(athleteId)],
  })();
}

async function askStrava(athleteId: string, stravaAthleteId: number | null, auth: StravaTokens): Promise<CheckResult> {
  const supabase = createServerClient();
  const accessToken = await getValidStravaToken(supabase, athleteId, auth);
  if (!accessToken) {
    // Refresh failed — a revoked authorisation, which the connection-health pill
    // already covers. Not an empty-account verdict, and must not read as one.
    return { linked: true, stravaAthleteId, checkable: false, reason: 'token_refresh_failed' };
  }

  const client = new StravaClient(accessToken);
  try {
    const [profile, activities] = await Promise.all([
      client.getAthlete(),
      // One row is the whole question: does this account hold ANY activity? Asked
      // with per_page=1 so the check costs one cheap call against the 15-minute
      // rate limit even when the account holds thousands.
      client.getActivities({ per_page: 1, page: 1 }),
    ]);

    const stravaName = [profile.firstname, profile.lastname].filter(Boolean).join(' ').trim();
    return {
      linked: true,
      checkable: true,
      stravaAthleteId: profile.id,
      stravaName: stravaName || null,
      // Strava's own placeholder for an account whose owner never set a name. On
      // its own it proves nothing; alongside an empty activity list it is the
      // signature of an account created to get past a connect button.
      placeholderName: stravaName === 'Strava Athlete',
      hasActivities: activities.length > 0,
    };
  } catch (err: any) {
    console.error('Strava account-check failed:', err?.message || err);
    return { linked: true, stravaAthleteId, checkable: false, reason: 'api_error' };
  }
}

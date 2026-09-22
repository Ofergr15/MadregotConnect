import type { SupabaseClient } from '@supabase/supabase-js';
import { COACH_ID } from '@/lib/constants';
import { APP_VERSION } from '@/lib/version';
import {
  CLIENT_DETECTORS, detectBlankScreen, detectClientError, detectDroppedForm,
  detectDuplicateAthlete, detectGarminSilent, detectParseGap, detectPhantomActivity,
  detectPushOrphan, detectServerError, detectStuckVersion, detectSuspiciousPace,
  keepProvable, LIVE_DETECTORS,
  type ActivityRow, type AthleteNameRow, type DetectorKey, type Finding, type PlanRow,
  type ProviderAthlete, type PushSubscriptionRow,
} from './detectors';
import type { ClientEventRow } from './client-events';

/**
 * The nightly pass: read the tables, run the pure rules, and file what they
 * found into the same reports queue a human would have filed into.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not fix anything, it does not message anybody, and it does not close
 * anything. Every finding lands as `status = 'new'` for the coach to accept or
 * reject, because a detector that acts on its own conclusions has to be right,
 * and these are heuristics over a 25-person club. "Send them a reconnect link"
 * is a button on the board, not a line in this file — the one moment a finding
 * becomes a message to an athlete is a moment somebody chose.
 *
 * It also never touches a credential. `garmin_auth` is an encrypted blob and the
 * query FILTERS on it being present without ever selecting it; the question "is
 * this token dead" is answered by the absence of data, not by trying to log in.
 */


export interface DetectRunResult {
  /** Findings after the proof-or-silence filter, strongest first. */
  findings: Finding[];
  /** Newly opened rows in `feedback`, i.e. facts that weren't there last night. */
  opened: number;
  /** Findings that matched an existing row and refreshed it. */
  refreshed: number;
  /** Detectors skipped because their input table or column isn't there. */
  skipped: string[];
  /**
   * Detectors that could not run at all tonight, by name.
   *
   * Reported separately from `skipped` (which names TABLES) because this is the
   * one thing the board must not get wrong: a detector whose table is missing has
   * not been checked, and "checked, found nothing" is a different statement. Its
   * state row is left untouched rather than stamped with a zero.
   */
  notChecked: DetectorKey[];
  /** True when migration 117 has not been applied, so nothing could be filed. */
  storageMissing: boolean;
}

/**
 * Gather the five detectors' inputs.
 *
 * Each read is independent and a failure of one does not cancel the others: a
 * pass that checks four things is worth much more than a pass that checks none
 * because one table was renamed.
 */
async function gather(supabase: SupabaseClient) {
  const skipped: string[] = [];

  // Connected athletes. `garmin_auth`/`strava_auth` are filtered on, never read:
  // they are encrypted credentials and must not leave the database.
  const roster = await supabase
    .from('athletes')
    .select('id, name, garmin_last_sync_at, strava_last_sync_at')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');
  const garminIds = await supabase
    .from('athletes').select('id').eq('coach_id', COACH_ID).not('garmin_auth', 'is', null);
  const stravaIds = await supabase
    .from('athletes').select('id').eq('coach_id', COACH_ID).not('strava_auth', 'is', null);

  // The last activity per athlete, which is the signal the silence detector reads.
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const recent = await supabase
    .from('athlete_activities')
    .select('id, athlete_id, start_time, duration, distance, has_polyline, source')
    .gte('start_time', since)
    .order('start_time', { ascending: false })
    .limit(2000);
  if (recent.error) skipped.push('athlete_activities');

  const lastByAthlete = new Map<string, string>();
  for (const a of (recent.data || []) as ActivityRow[]) {
    if (a.start_time && !lastByAthlete.has(a.athlete_id)) lastByAthlete.set(a.athlete_id, a.start_time);
  }

  const garminSet = new Set((garminIds.data || []).map(r => r.id as string));
  const stravaSet = new Set((stravaIds.data || []).map(r => r.id as string));
  const athletes: ProviderAthlete[] = ((roster.data || []) as Array<{ id: string; name: string | null }>)
    .map(r => ({
      id: r.id,
      name: r.name,
      lastActivityAt: lastByAthlete.get(r.id) || null,
      garminConnected: garminSet.has(r.id),
      stravaConnected: stravaSet.has(r.id),
    }));
  if (roster.error) skipped.push('athletes');

  const subs = await supabase
    .from('push_subscriptions').select('id, athlete_id, created_at, last_success_at');
  if (subs.error) skipped.push('push_subscriptions');

  // Six weeks of plans: enough for a within-week median, short enough that a
  // parse fixed a month ago doesn't keep reopening.
  const planSince = new Date(Date.now() - 42 * 86_400_000).toISOString().slice(0, 10);
  const plansRaw = await supabase
    .from('weekly_plans')
    .select('id, athlete_id, week_start_date, parsed_workouts')
    .gte('week_start_date', planSince);
  if (plansRaw.error) skipped.push('weekly_plans');
  const plans: PlanRow[] = ((plansRaw.data || []) as Array<{
    id: string; athlete_id: string | null; week_start_date: string; parsed_workouts: unknown;
  }>).map(p => ({
    id: p.id,
    athlete_id: p.athlete_id,
    week_start_date: p.week_start_date,
    workoutCount: Array.isArray(p.parsed_workouts) ? p.parsed_workouts.length : 0,
  }));

  // Duplicate rows. The synthetic Strava email is the SIGNATURE of the path that
  // creates them, so it is filtered on rather than selected — the address itself
  // is nobody's business here and doesn't belong in a finding's evidence.
  const allNames = await supabase
    .from('athletes').select('id, name').eq('coach_id', COACH_ID);
  const syntheticIds = await supabase
    .from('athletes').select('id').eq('coach_id', COACH_ID).like('email', 'strava_%');
  const syntheticSet = new Set((syntheticIds.data || []).map(r => r.id as string));
  const nameRows: AthleteNameRow[] = ((allNames.data || []) as Array<{ id: string; name: string | null }>)
    .map(r => ({ id: r.id, name: r.name, synthetic: syntheticSet.has(r.id) }));

  // The browser's own account of what went wrong (migration 118). Seven days:
  // the same window the detectors group over, and long enough that a Friday
  // deploy is still visible on Monday morning.
  //
  // `clientEvents === null` means the table isn't there, which is NOT the same as
  // it being empty — five detectors have to report "not checked" rather than a
  // reassuring zero, so the distinction is carried rather than flattened to [].
  const eventsSince = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const evs = await supabase
    .from('client_events')
    .select('id, athlete_id, kind, route, message, app_version, created_at')
    .gte('created_at', eventsSince)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (evs.error) skipped.push('client_events');

  return {
    athletes,
    subs: (subs.data || []) as PushSubscriptionRow[],
    plans,
    nameRows,
    activities: (recent.data || []) as ActivityRow[],
    clientEvents: evs.error ? null : ((evs.data || []) as ClientEventRow[]),
    skipped,
  };
}

/**
 * File a finding as a row in `feedback`.
 *
 * Upsert on `finding_key`, so a fact that is still true tonight refreshes last
 * night's row — including its triage, its notes and any human reports merged
 * onto it. Re-opening it nightly would be the single fastest way to make the
 * board unreadable.
 */
async function file(
  supabase: SupabaseClient,
  finding: Finding,
): Promise<'opened' | 'refreshed' | 'failed'> {
  const existing = await supabase
    .from('feedback').select('id, first_seen_version').eq('finding_key', finding.key).maybeSingle();
  // Any read failure here means the finding cannot be filed safely — 42703 when
  // migration 117 is not applied, anything else for the same reason as always:
  // inserting without knowing whether a row already exists duplicates it.
  if (existing.error) return 'failed';

  const row = {
    source: 'detector',
    detector: finding.detector,
    finding_key: finding.key,
    evidence: finding.evidence,
    affected_count: finding.affected,
    signal_strength: finding.strength,
    message: finding.title,
    category: 'bug_report',
  };

  if (existing.data?.id) {
    // `first_seen_version` is never rewritten: the point of it is which release
    // STARTED this, and the answer cannot change once it is known.
    const { error } = await supabase.from('feedback').update(row).eq('id', existing.data.id);
    return error ? 'failed' : 'refreshed';
  }

  const { error } = await supabase.from('feedback').insert({
    ...row,
    status: 'new',
    priority: finding.affected >= 5 ? 'high' : 'normal',
    first_seen_version: APP_VERSION,
    athlete_name: 'גלאי',
  });
  return error ? 'failed' : 'opened';
}

/**
 * Record what each detector did tonight, including finding nothing.
 *
 * A detector that could not run is LEFT OUT rather than written with a zero. The
 * board shows `last_run_at` as "checked", and stamping tonight's date on a
 * detector whose table does not exist would be the board telling a lie about
 * itself — the exact failure mode these four rules exist to prevent.
 */
async function recordState(
  supabase: SupabaseClient,
  counts: Map<string, number>,
  notChecked: DetectorKey[],
): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = LIVE_DETECTORS.filter(key => !notChecked.includes(key)).map(key => ({
    key,
    last_run_at: now,
    last_found_count: counts.get(key) || 0,
  }));
  if (!rows.length) return true;
  const { error } = await supabase.from('bug_detectors').upsert(rows, { onConflict: 'key' });
  return !error;
}

export async function runDetectors(supabase: SupabaseClient): Promise<DetectRunResult> {
  const input = await gather(supabase);
  const now = Date.now();

  // Muted detectors are skipped entirely rather than run-and-hidden: a muted
  // detector whose findings are filed anyway is a board that fills up silently.
  const muted = new Set<string>();
  const state = await supabase.from('bug_detectors').select('key, muted_at').not('muted_at', 'is', null);
  for (const r of (state.data || []) as Array<{ key: string }>) muted.add(r.key);

  // The five that read the browser cannot run without their table. They are not
  // silently dropped: they come back in `notChecked`, which is what stops the
  // board from showing them as checked-and-clean.
  const events = input.clientEvents;
  const notChecked: DetectorKey[] = events ? [] : [...CLIENT_DETECTORS];

  const all = keepProvable([
    detectGarminSilent(input.athletes, now),
    detectPushOrphan(input.subs, now),
    detectParseGap(input.plans),
    detectDuplicateAthlete(input.nameRows),
    detectPhantomActivity(input.activities),
    detectSuspiciousPace(input.activities),
    // The grouped ones return a LIST: three unrelated error shapes in one night
    // are three facts with three keys, and a count cannot be triaged or closed.
    ...(events ? detectClientError(events, now) : []),
    ...(events ? detectBlankScreen(events, now) : []),
    ...(events ? detectDroppedForm(events, now) : []),
    ...(events ? detectServerError(events, now) : []),
    ...(events ? detectStuckVersion(events, APP_VERSION, now) : []),
  ]).filter(f => !muted.has(f.detector));

  let opened = 0;
  let refreshed = 0;
  let failed = 0;
  for (const finding of all) {
    const outcome = await file(supabase, finding);
    if (outcome === 'opened') opened += 1;
    else if (outcome === 'refreshed') refreshed += 1;
    else failed += 1;
  }

  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.detector, (counts.get(f.detector) || 0) + 1);
  const recorded = await recordState(supabase, counts, notChecked);

  return {
    findings: all,
    opened,
    refreshed,
    skipped: input.skipped,
    notChecked,
    // Either nothing could be filed, or the state table isn't there. Both mean
    // the pass ran and told nobody, which the route has to say out loud rather
    // than reporting a cheerful zero.
    storageMissing: failed > 0 || !recorded,
  };
}

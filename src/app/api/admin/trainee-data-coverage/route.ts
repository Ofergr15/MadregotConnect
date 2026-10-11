import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { COACH_ID, isStaffRole } from '@/lib/constants';
import { israelToday, planWeekStartOf, activityLocalDateStr } from '@/lib/utils';
import { isMissingColumn } from '@/lib/supabase/schema-drift';
import { pickPlan } from '@/lib/plans/scope';
import { isKindMuted } from '@/lib/notifications/prefs';
import { TRAINEE_V2_FOR_ALL } from '@/lib/trainee/flag';
import { DATA_FEED_COLUMNS } from '@/lib/academy/data-feed';
import { isRunType, MAX_HR_DAYS, shiftDate, thresholdOn } from '@/lib/academy/load';
import { mapLimit, maxHrNow, readAll } from '@/lib/academy/load-server';
import { buildLoadPayload } from '@/lib/academy/load-payload';
import { buildBodyPayload } from '@/lib/academy/body';
import { readBodyNights } from '@/lib/academy/body-server';
import { plausible, RANGE_DAYS } from '@/lib/academy/normal-range';
import { readReminderPref } from '@/lib/academy/morning-reminder';
import { lapsWhy, noLoadReason } from '@/lib/academy/workout-extras';
import { loadTraineeToday } from '@/lib/academy/today-server';
import { LEARNING_DAYS } from '@/lib/academy/pmc';
import {
  coverageText, screenVerdicts, type CoverageData, type CoverageRow, type LatestRun, type PlanSource,
} from '@/lib/academy/data-coverage';
import type { TraineeToday } from '@/lib/academy/trainee-today';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

/** Trainees built side by side: each is ~15 reads, and production pays ~225 ms per round trip. */
const CONCURRENCY = 4;

const MEMBER_COLS = `id, name, status, role, academy_band_id, notification_prefs, max_hr_bpm, ${DATA_FEED_COLUMNS}`;
const MEMBER_COLS_FALLBACK = 'id, name, status, role, academy_band_id, notification_prefs, garmin_auth, strava_auth';

/**
 * GET /api/admin/trainee-data-coverage[?format=text]
 *
 * The production data-coverage check Ofer runs himself (nobody else reads prod): for every
 * academy member, what data we hold — Garmin/Strava and their last sync, runs of the last 42
 * days (with HR, with laps, Strava-only, manual), the newest test and whether a threshold
 * stands, the band, a max HR, the nights of the last 30 days, this week's plan, a push
 * device, the morning-reminder preference — and what each trainee screen will show with it.
 *
 * The verdict per screen is NOT re-derived: each trainee's home is built by the very
 * function GET /api/academy/today returns (`loadTraineeToday`), screen 7's status by
 * `buildLoadPayload` over the same load rows, screen 8 by `buildBodyPayload` over the nights
 * GET /api/academy/body reads, screen 5's laps by `lapsWhy`, screen 9 by `readReminderPref`.
 * lib/academy/data-coverage.ts only names the outcome.
 *
 * ⚠️ Admin-only (role admin or the super user): it lists every trainee's health-data counts.
 * Refused under view-as — the answer would be computed as somebody else. READ-ONLY: every
 * run is priced in memory (`inMemoryLoads`: the numbers the trainee's own next open settles
 * on, never "still computing" for runs that open would price), nothing is stored, no Stream
 * call is made.
 * Credentials are read only to say "linked"; they never leave this route.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) {
    return NextResponse.json({ error: 'view_as_refused', message: 'לא זמין בזמן "צפייה בתור". צא מהצפייה ונסה שוב.' }, { status: 403 });
  }
  if (!caller.isSuperUser && !hasRole(caller, 'admin')) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  try {
    const format = new URL(request.url).searchParams.get('format');
    const supabase = createServerClient();
    const now = new Date();
    const today = israelToday(now);
    const weekStart = planWeekStartOf(today);

    // ── Who: every academy member of the club (any status; the status is a column) ──
    let members: any[] = [];
    {
      const read = (cols: string) => supabase.from('athletes').select(cols).eq('coach_id', COACH_ID).eq('is_academy', true).order('name', { ascending: true });
      let res: any = await read(MEMBER_COLS);
      if (res.error && isMissingColumn(res.error)) res = await read(MEMBER_COLS_FALLBACK);
      if (res.error) throw res.error;
      members = res.data || [];
    }
    const ids = members.map(m => String(m.id));
    if (!ids.length) {
      const empty = { today, generatedAt: now.toISOString(), count: 0, trainees: [] as CoverageRow[] };
      return format === 'text' ? textResponse(coverageText([], empty)) : NextResponse.json(empty);
    }

    // ── Club-wide reads, one round ──
    const since42 = shiftDate(today, -LEARNING_DAYS);
    const since180 = shiftDate(today, -MAX_HR_DAYS);
    const since30 = shiftDate(today, -(RANGE_DAYS - 1));
    const bandIds = [...new Set(members.map(m => m.academy_band_id).filter(Boolean))];
    const [bandsRes, subsRes, plansRes, acts42, acts180, nights30] = await Promise.all([
      bandIds.length
        ? supabase.from('academy_bands').select('id, band_number, name').in('id', bandIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('push_subscriptions').select('athlete_id').in('athlete_id', ids),
      supabase.from('weekly_plans').select('week_start_date, athlete_id, status, created_at')
        .eq('coach_id', COACH_ID).eq('week_start_date', weekStart).order('created_at', { ascending: true }),
      // Only the second lap/split (two or more = laps, lapsWhy's rule), never the arrays.
      readAll<any>((from, to) => supabase.from('athlete_activities')
        .select('id, athlete_id, start_time, activity_type, average_hr, source, lap2:laps->1, split2:splits->1')
        .in('athlete_id', ids).gte('start_time', `${since42}T00:00:00Z`)
        .order('start_time', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      readAll<any>((from, to) => supabase.from('athlete_activities')
        .select('id, athlete_id, start_time, activity_type, max_hr')
        .in('athlete_id', ids).gte('start_time', `${since180}T00:00:00Z`)
        .order('start_time', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      readAll<any>((from, to) => supabase.from('athlete_wellness')
        .select('athlete_id, date, sleep_seconds, resting_hr')
        .in('athlete_id', ids).gte('date', since30).lte('date', today)
        .order('date', { ascending: true }).order('athlete_id', { ascending: true }).range(from, to)),
    ]);
    const bands = new Map(((bandsRes.error ? [] : bandsRes.data) || []).map((b: any) => [String(b.id), b]));
    const subs = new Map<string, number>();
    for (const s of ((subsRes.error ? [] : subsRes.data) || []) as any[]) subs.set(String(s.athlete_id), (subs.get(String(s.athlete_id)) ?? 0) + 1);
    const planRows = ((plansRes.error ? [] : plansRes.data) || []) as any[];
    const by = <T extends { athlete_id: unknown }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) { const k = String(r.athlete_id); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
      return m;
    };
    const acts42By = by(acts42.data);
    const acts180By = by(acts180.data);
    const nightsBy = by(nights30.data);

    // ── Per trainee: each screen's own builder ──
    const rows = await mapLimit(members, CONCURRENCY, async (m): Promise<CoverageRow> => {
      const id = String(m.id);
      const runs = (acts42By.get(id) || []).filter(a => isRunType(a.activity_type) && activityLocalDateStr(a.start_time) >= since42);
      const nights = (nightsBy.get(id) || []).map(n => ({ ...n, date: String(n.date).slice(0, 10) }));
      const prefs = m.notification_prefs ?? null;
      const pref = readReminderPref(prefs, TRAINEE_V2_FOR_ALL);
      const savedEnabled = (prefs as { morningReminder?: { enabled?: unknown } } | null)?.morningReminder?.enabled;
      const band = m.academy_band_id ? bands.get(String(m.academy_band_id)) : null;
      const picked = pickPlan(planRows.filter(r => !r.athlete_id || r.athlete_id === id), id);
      const plan: PlanSource = !picked ? 'none' : picked.athlete_id ? 'own' : 'group';
      const data: CoverageData = {
        athleteId: id,
        name: String(m.name ?? ''),
        status: m.status ?? null,
        garmin: { linked: !!m.garmin_auth, lastSyncAt: m.garmin_last_sync_at ?? null, failedAt: m.garmin_auth_failed_at ?? null },
        strava: { linked: !!m.strava_auth, lastSyncAt: m.strava_last_sync_at ?? null, failedAt: m.strava_auth_failed_at ?? null },
        runFeed: 'none',
        nightFeed: 'none',
        runs42: {
          total: runs.length,
          withHr: runs.filter(a => Number(a.average_hr) > 0).length,
          withLaps: runs.filter(a => a.lap2 != null || a.split2 != null).length,
          stravaOnly: runs.filter(a => a.source === 'strava').length,
          manual: runs.filter(a => a.source === 'manual').length,
        },
        latestRun: runs.length ? activityLocalDateStr(runs[runs.length - 1].start_time) : null,
        test: { kind: 'none', date: null, old: false, threshold: false, thresholdSec: null },
        band: band ? { number: band.band_number ?? null, name: band.name ?? null } : null,
        maxHr: {
          fromRuns: maxHrNow((acts180By.get(id) || []) as any[], today),
          profile: Number(m.max_hr_bpm) > 0 ? Number(m.max_hr_bpm) : null,
        },
        wellness30: {
          sleepNights: nights.filter(n => plausible('sleep_seconds', n.sleep_seconds)).length,
          rhrMornings: nights.filter(n => plausible('resting_hr', n.resting_hr)).length,
          latest: nights.filter(n => plausible('sleep_seconds', n.sleep_seconds) || plausible('resting_hr', n.resting_hr))
            .map(n => n.date).sort().pop() ?? null,
        },
        planThisWeek: plan,
        pushSubscriptions: subs.get(id) ?? 0,
        reminder: {
          enabled: pref.enabled,
          time: pref.time,
          muted: isKindMuted('academy_morning', prefs, isStaffRole(m.role), m.role),
          explicit: typeof savedEnabled === 'boolean',
        },
      };

      // Not active (invited, removed, disconnected): the app shows "הגישה שלך לא פעילה" and no screen.
      if ((m.status ?? 'active') !== 'active') {
        return { ...data, screens: [{ screen: '*', item: 'access', state: 'missing', code: 'inactive', he: `סטטוס ${m.status}: האפליקציה מציגה "הגישה שלך לא פעילה" ולא אף מסך. צריך להפעיל את המתאמן` }] };
      }

      try {
        const [{ payload, parts }, bodyNights] = await Promise.all([
          loadTraineeToday(supabase, id, { write: false, now, unread: false, inMemoryLoads: true }),
          readBodyNights(supabase, id, today),
        ]);
        if (!parts || !('dayState' in payload)) {
          return { ...data, screens: [{ screen: '1', item: 'member', state: 'missing', code: 'notMember', he: 'לא מוגדר כמתאמן אקדמיה' }] };
        }
        const home = payload as TraineeToday;
        const { loads, feeds, testState } = parts;
        const T = thresholdOn(today, loads.tests);
        // Screen 7 (GET /api/academy/load): the same rows, the same gate.
        const loadStatus = buildLoadPayload({ rows: loads.rows, tests: loads.tests, today, range: '6w', gate: { feed: feeds.run, pending: loads.pending } }).status;
        // Screen 8 (GET /api/academy/body): the same nights, the same feed.
        const body = buildBodyPayload({ nights: bodyNights, today, feedback: [], feed: feeds.night });
        // Screen 5 for the newest run: its own laps (lapsWhy needs null vs [] for Strava).
        let latestRun: LatestRun | null = null;
        // The second copy of a run synced twice (twins.ts, stored as `not_run`) is not the run screen 5 opens.
        const twin = new Set(loads.rows.filter(r => r.source === 'not_run').map(r => r.activityId));
        const last = [...runs].reverse().find(a => !twin.has(String(a.id)));
        if (last) {
          const { data: full } = await supabase.from('athlete_activities')
            .select('id, source, laps, splits, average_hr').eq('id', last.id).maybeSingle();
          const row = loads.rows.find(r => r.activityId === String(last.id));
          latestRun = {
            date: activityLocalDateStr(last.start_time),
            lapsWhy: lapsWhy((full as any) ?? { source: last.source, laps: null, splits: null }),
            source: row?.source ?? null,
            noLoad: row?.source === 'none' ? noLoadReason(Number(last.average_hr) > 0 ? Number(last.average_hr) : null) : null,
          };
        }
        data.runFeed = feeds.run.kind;
        data.nightFeed = feeds.night.kind;
        data.test = {
          kind: testState.kind,
          date: testState.kind === 'none' ? null : testState.date,
          old: testState.kind === 'ok' && testState.old,
          threshold: !!T,
          thresholdSec: T?.thresholdSec ?? null,
        };
        return {
          ...data,
          screens: screenVerdicts({
            today: home, loadStatus, body, plan, threshold: !!T, latestRun,
            reminder: data.reminder, subscriptions: data.pushSubscriptions,
          }),
        };
      } catch (err) {
        console.error('[trainee-data-coverage] one trainee failed:', id, err);
        return { ...data, screens: [{ screen: '*', item: 'error', state: 'missing', code: 'error', he: `שגיאה בבניית המסכים: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    });

    const out = { today, generatedAt: now.toISOString(), count: rows.length, trainees: rows };
    return format === 'text' ? textResponse(coverageText(rows, out)) : NextResponse.json(out);
  } catch (error: unknown) {
    console.error('trainee-data-coverage error:', error);
    return NextResponse.json({ error: 'Failed to build the coverage check' }, { status: 500 });
  }
}

function textResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

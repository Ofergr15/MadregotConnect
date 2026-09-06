'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Calendar, ArrowRight, TrendingUp, TrendingDown, MapPin, Flame } from 'lucide-react';
import {
  cn, getActivityWeekStart, getPlanWeekStart, isRecentlyPublished, israelDateAnchor,
  activityWeekStart, activityLocalDateStr, activityDayRelation, israelToday, israelNow, toISODate,
} from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import { apiHeaders, useApi } from '@/lib/api';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { AttendanceRSVP, type AttendanceStatus } from '@/components/AttendanceRSVP';
import { NextWorkoutCard } from '@/components/NextWorkoutCard';
import { StatTiles } from '@/components/StatTiles';
import { WeeklyLeaderboardCard } from '@/components/WeeklyLeaderboardCard';
import { CoachPulse } from '@/components/CoachPulse';
import { AttendanceRoster } from '@/components/AttendanceRoster';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { WORKOUT_TYPE_COLORS as typeColors, WORKOUT_TYPE_TEXT_COLORS as typeTextColors, WORKOUT_TYPE_LABELS as typeLabels, planDayKey } from '@/lib/plans/workout-parsing';
import { Spinner, Card, BigStat, EmptyState, Button } from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
// The goal race lived here as three consts until the designer's Profile frame
// put the same countdown on a second screen — see src/lib/goal-race.ts. The
// h/m/s tick below stays local: only this strip counts down by the second.
import { GOAL_RACE } from '@/lib/goal-race';

interface DashboardStats {
  athleteCount: number;
  totalAthletes: number;
  groupCount: number;
  planCount: number;
  deliverySuccessRate: number;
  recentActivity: Array<{ type: string; description: string; timestamp: string }>;
}

interface DaySession {
  min: number;
  max: number;
  type: string;
  name: string;
}

interface WeeklyData {
  dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string; sessions?: DaySession[] }>;
  weekTotalMin: number;
  weekTotalMax: number;
  weekDelta: number;
  prevWeekTotal: number;
  weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }>;
  longRunProgression: Array<{ week: string; distance: number }>;
  sessions: Array<{ key: string; dayOfWeek: number; name: string; type: string; kmMin: number; kmMax: number; steps: any[] }>;
  typeDistribution: Record<string, number>;
  trainingDays: number;
  currentWeekStart: string;
  /** False when no plan exists for `currentWeekStart` — everything above is then empty. */
  hasPlan?: boolean;
  publishedAt?: string | null;
}

interface RecentActivity {
  id: string;
  athlete_id: string;
  athlete_name: string;
  activity_name: string;
  start_time: string;
  distance: number;
  duration: number;
  average_pace: number | null;
  average_hr: number | null;
  elevation_gain: number | null;
  has_polyline?: boolean;
  garmin_activity_id?: number;
}

/**
 * How many of these activities fall in the current activity week.
 *
 * `activityWeekStart`, not `new Date(a.start_time) >= weekStart`: `start_time`
 * holds the athlete's own wall clock in a TIMESTAMPTZ, so local getters shift it
 * +3h in an Israel browser and a 21:30 Saturday run lands in NEXT week — dropped
 * from the count it belongs to. See the convention note in src/lib/utils.ts.
 */
function countThisWeek(activities: Array<{ start_time: string }>): number {
  const thisWeek = getActivityWeekStart(israelDateAnchor());
  return activities.filter((a) => activityWeekStart(a.start_time) === thisWeek).length;
}

// A radically simplified home: one hero (today's/tomorrow's workout + RSVP),
// a slim stat strip, and a single clear CTA — everything else that used to
// stack below (squad rivalry, leaderboard, weather, a redundant daily bar
// chart already shown on Program, a second activities feed, a training-load
// chart) moved to the tab where it actually belongs (Feed, Settings) or was
// dropped as duplicate. Modeled on the single-focus home screen of simpler
// booking-style apps, per an explicit product decision.
export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tm = useTranslations('momentum');
  const router = useRouter();
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  // Cached via useApi (SWR) instead of a manual fetch+useState: revisiting this
  // tab shows the last-known stats/weekly instantly (keepPreviousData) while
  // quietly revalidating in the background, instead of a blank spinner every
  // single time — the concrete fix for "moving between screens feels slow".
  const { data: weekly, isLoading: weeklyLoading } = useApi<WeeklyData>('/api/dashboard/weekly');
  const { data: reminderConfig } = useApi<{ config?: { teamDays?: number[]; workoutHour?: number } }>('/api/reminder-config');
  // Admin-editable team-workout days (0=Sun..6=Sat) → which days the RSVP card
  // shows on; admin-editable team workout start hour (Israel) → the "add to
  // calendar" event time. Both fall back to the same defaults as before.
  const teamDays = reminderConfig?.config?.teamDays ?? [2, 5];
  const workoutHour = reminderConfig?.config?.workoutHour ?? 18;
  const [rsvpAnswered, setRsvpAnswered] = useState(false); // has the athlete answered the current RSVP target? drives the hero card's CTA
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  // The single most-recently-synced activity from the background Strava sync
  // below, shown once in the Strava-style customization sheet right after it
  // lands. Only set for a genuinely NEW activity from THIS sync (never for
  // activities already on the page), and only when it started within the
  // last 24h — otherwise a first-time 180-day Strava backfill would pop the
  // sheet for a run from months ago.
  const [syncedActivity, setSyncedActivity] = useState<RecentActivity | null>(null);
  const [syncedExtraCount, setSyncedExtraCount] = useState(0);
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const [week, setWeek] = useState(0);
  const [isCoach, setIsCoach] = useState(false);
  // Keyed on isCoach: /api/dashboard/stats is staff-only now, and its numbers
  // only ever render inside the `{isCoach && …}` strip below. Asking for it as a
  // runner would be three 403s (SWR retries twice) for something that can't be
  // displayed. Declared here rather than beside the `weekly` read above because
  // it has to come after isCoach exists.
  const { data: stats } = useApi<DashboardStats>(isCoach ? '/api/dashboard/stats' : null);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  // A push notification's ?rsvp=weekStart:day deep-link (see cron/tick's
  // training_before pushes) — previously ignored entirely, so tapping the
  // notification BODY (not an action button) days after it arrived landed on
  // whatever rsvpTarget "today" happened to compute, not the workout the
  // notification was actually about. Read once on mount (window.location,
  // not useSearchParams — this page has no Suspense boundary).
  const [rsvpUrlOverride, setRsvpUrlOverride] = useState<{ weekStart: string; day: number } | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('rsvp');
    const m = raw?.match(/^(\d{4}-\d{2}-\d{2}):(\d)$/);
    if (m) setRsvpUrlOverride({ weekStart: m[1], day: Number(m[2]) });
  }, []);
  // A push notification's ?editActivity=<id> deep-link — reopens the same
  // "customize your post" sheet the live sync-diff below shows, without
  // needing to catch that narrow window. This is how a Garmin sync (which
  // happens server-side on a schedule, never while this page is open) can
  // still offer the sheet: the cron job that imports it sends a push with
  // this link instead of relying on a client-side diff.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('editActivity');
    if (!id) return;
    const myAthleteId = localStorage.getItem('athlete_id');
    if (!myAthleteId) return;
    (async () => {
      try {
        // `selfOnly`: the push named one of MY activities, and staff would
        // otherwise be handed the club-wide page — where my target row has to
        // beat 200 other people's runs to be in it at all, so the deep-link
        // quietly did nothing for a coach who also runs. No `limit` here: the
        // id can be an older activity if the push sat unopened.
        const res = await fetchActivities({ selfOnly: true });
        if (!res.ok) return;
        const data = await res.json();
        const found = (data.activities || []).find(
          (a: RecentActivity) => a.id === id && a.athlete_id === myAthleteId,
        );
        if (found) setSyncedActivity(found);
      } catch {}
    })();
  }, []);
  const [athleteName, setAthleteName] = useState<string>('');
  const [weeklyRuns, setWeeklyRuns] = useState(0);
  // Week-streak — shown as a small flame badge in the stat strip (same source
  // MomentumCard/Profile→Statistics use, just the headline number, not the
  // full recap card).
  // Not gated on !isCoach — a coach who is ALSO a runner (has their own
  // athleteId) still has personal stats worth fetching. Coaches with no
  // athlete profile simply have no athleteId, so this stays null for them.
  const { data: summary } = useApi<{ weekStreak: number }>(
    athleteId ? `/api/athletes/summary?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const storedAthleteId = localStorage.getItem('athlete_id');
    const name = localStorage.getItem('athlete_name') || '';
    // Coach-vs-athlete body view must honour the super-user "view as" role, like
    // the nav does — otherwise previewing as coach still shows the athlete RSVP
    // (and previewing as runner still shows the coach roster). A role scenario
    // wins; otherwise fall back to whether this is a real coach account.
    const viewMode = getViewMode();
    const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
    setIsCoach(previewRole ? STAFF_ROLES.includes(previewRole) : !!coachEmail);
    setAthleteId(storedAthleteId);
    setAthleteName(name);
  }, []);

  // Stable identity so AttendanceRSVP's status effect doesn't refire on every
  // unrelated parent re-render (e.g. the countdown ticking every second).
  const handleRsvpStatus = useCallback((status: AttendanceStatus) => {
    setRsvpAnswered(status.answered);
  }, []);

  useEffect(() => {
    const tick = () => {
      const diff = GOAL_RACE.date.getTime() - Date.now();
      if (diff <= 0) return;
      setCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      const w = Math.floor((Date.now() - GOAL_RACE.blockStart.getTime()) / 604800000);
      setWeek(Math.max(0, Math.min(w + 1, GOAL_RACE.totalWeeks)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Background activity sync + "just synced" popup detection — deliberately
  // its OWN effect, separate from the stats/weekly SWR reads above. This is a
  // one-time imperative flow (snapshot → sync → diff → maybe show a popup),
  // not a cacheable "fetch and display" read, so it doesn't belong in useApi
  // and — importantly — it no longer blocks the page: recentActivities/
  // weeklyRuns/syncedActivity fill in whenever this resolves, same as before,
  // but the hero above renders the moment stats/weekly are ready.
  useEffect(() => {
    async function load() {
      const myAthleteId = localStorage.getItem('athlete_id');
      const syncKey = myAthleteId ? `dashboard_synced:${myAthleteId}` : 'dashboard_synced';
      // Super-user "view as" preview is read-only (sync POST is blocked).
      const isPreviewing = !!localStorage.getItem('view_as_role');
      // Not gated on isCoach (the component-level state, unrelated to this
      // effect's own locals) — same reasoning as `filtered` below: a coach
      // who's also a runner still has their own Strava/Garmin data worth
      // auto-syncing and still deserves the "just synced, customize your
      // post" popup for their own runs. A pure-admin coach with no athlete
      // profile just has myAthleteId=null, so this stays false for them.
      const canSync = !!myAthleteId && !isPreviewing;

      // Fire every independent request up front — none of these wait on each
      // other's response body, so there's no reason to stage them. The only
      // real ordering constraints are downstream: the activities snapshot must
      // be read BEFORE the background sync starts, and the sync must finish
      // before refetching — both handled below, after these all resolve.
      const mePromise = canSync
        ? apiHeaders().then(headers => fetch(`/api/athletes/me?id=${myAthleteId}`, { headers }))
        : null;
      // Everything this reads is about the signed-in athlete — their last three
      // runs, their runs this week, and the id snapshot for the sync diff — so
      // `selfOnly`, which also makes a small `limit` safe. Previously this asked
      // for the club-wide 200 and filtered client-side, which was quietly WRONG
      // for a coach who also runs: their own runs had to be inside the club's
      // newest 200 to survive the filter, so on a busy week the dashboard could
      // greet the club's own admin with "0 runs this week". 30 own rows covers
      // three recents, any single week, and the diff below (a genuinely new
      // activity lands at the top, so a shorter page can't invent one).
      const activitiesPromise = fetchActivities({ limit: 30, selfOnly: true });

      try {
        let hasStrava = false;
        if (mePromise) {
          try {
            const meRes = await mePromise;
            const meData = await meRes.json();
            hasStrava = meData.athlete?.hasStrava || false;
          } catch {}
        }
        // Decided once here and reused for the background sync below. Re-check
        // happens naturally since this runs after the concurrent fetches above
        // resolve; in React Strict Mode two effects can still start together,
        // so the localStorage lock below still guards against a duplicate sync.
        let willSync = false;
        if (canSync) {
          willSync = !localStorage.getItem(syncKey) && hasStrava;
          if (willSync) {
            // Mark before starting so Strict Mode cannot launch a duplicate sync.
            // On a real sync error we re-arm below so it retries next visit.
            localStorage.setItem(syncKey, '1');
          } else if (!hasStrava) {
            localStorage.setItem(syncKey, '1');
          }
        }

        const actRes = await activitiesPromise;
        // Snapshot of ids seen BEFORE the background sync below, so any activity
        // that shows up after it is provably new — not just "new to this page load".
        let preSyncActivityIds = new Set<string>();
        if (actRes.ok) {
          const actData = await actRes.json();
          const allActs = actData.activities || [];
          // Always the signed-in person's OWN activities — this only feeds the
          // personal "today's/tomorrow's workout" hero calc below, not a club
          // feed, so a coach who's also a runner needs their own activities
          // here too (not every athlete's), and a coach with no athlete
          // profile just gets an empty list, same as before. `scope=self` on the
          // request now does this server-side; the filter stays as a guard (and
          // for the myAthleteId=null case, where the request sends no id).
          const filtered = allActs.filter((a: any) => a.athlete_id === myAthleteId);
          setRecentActivities(filtered.slice(0, 3));
          preSyncActivityIds = new Set(filtered.map((a: any) => a.id));

          if (myAthleteId) {
            setWeeklyRuns(countThisWeek(filtered));
          }
        }

        // Sync Strava in the background without blocking the dashboard UI.
        if (willSync && myAthleteId) {
          try {
            const stravaSyncRes = await fetch('/api/strava/sync-activities', {
              method: 'POST',
              headers: await bearerHeaders(),
              body: JSON.stringify({ athleteId: myAthleteId }),
            });
            if (!stravaSyncRes.ok) throw new Error('Strava sync failed');
          } catch {
            // Re-arm so a failed sync retries on the next visit.
            localStorage.removeItem(syncKey);
          }

          // Refresh activities after sync completes
          try {
            // Same shape as the pre-sync snapshot above — the diff below compares
            // the two, so they have to be the same page of the same athlete.
            const refreshRes = await fetchActivities({ limit: 30, selfOnly: true });
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              const allActs = refreshData.activities || [];
              const filtered = allActs.filter((a: any) => a.athlete_id === myAthleteId);
              setRecentActivities(filtered.slice(0, 3));

              setWeeklyRuns(countThisWeek(filtered));

              // This is the "sync just completed" moment: activities present now
              // that weren't in the pre-sync snapshot are genuinely new. `filtered`
              // is already start_time-desc (server order), so the first match is
              // the most recent. Skip anything that didn't happen today or
              // yesterday so a first-time 180-day Strava backfill doesn't pop the
              // customization sheet for a run from months ago.
              //
              // A day comparison rather than `Date.now() - new Date(start_time)`:
              // that mixed the two time conventions (a wall clock read as an
              // instant), which made every run read 3h newer than it was.
              const newActivities = filtered.filter((a: any) => !preSyncActivityIds.has(a.id));
              const justSynced = newActivities.find(
                (a: any) => activityDayRelation(a.start_time) !== 'older',
              );
              if (justSynced) {
                setSyncedActivity(justSynced);
                setSyncedExtraCount(newActivities.length - 1);
              }
            }
          } catch {}
        }
      } catch (e) { console.error(e); }
    }
    load();
  }, []);

  // Only the very first-ever load (no cached plan yet) blocks on a spinner —
  // keepPreviousData means a revisit shows the last-known content instantly
  // while it quietly revalidates in the background.
  //
  // `weekly` alone, not stats too: the stats key only becomes non-null once
  // isCoach resolves, so gating the spinner on its loading state would put the
  // spinner BACK on screen a moment after a coach's page had already rendered.
  // Nothing is lost — the coach strip reads `stats?.x || 0`, so it just fills in.
  if (weeklyLoading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Spinner size={40} />
    </div>
  );

  // Israel's calendar day, not the device's. Everything below pairs a plan day
  // with a real date, and the plan week itself was chosen in Israel time by the
  // server — reading the day from the browser instead put the two out of step.
  const todayKey = israelToday();
  const todayDow = israelDateAnchor().getDay();
  const tomorrowDate = (() => { const d = israelDateAnchor(); d.setDate(d.getDate() + 1); return d; })();
  const tomorrowKey = toISODate(tomorrowDate);
  const hasData = weekly && weekly.weekTotalMax > 0;

  // Which workout does the RSVP target? RSVP is a DAY-BEFORE flow (matching the
  // Mon 08:00 + Mon 18:00 pushes for a Tue workout): the evening before a team
  // day it asks "coming tomorrow?". On the team day itself it still shows for
  // athletes who NEVER answered (a last-chance nudge) but hides once they have —
  // the coach roster always shows. No time-of-day cutoff. weekStart is derived
  // from the TARGET date so the Sat→Sun plan-week boundary is handled.
  const rsvpTarget = (() => {
    // A notification deep-link always wins — it names an explicit week+day,
    // which may no longer be "today"/"tomorrow" by the time it's tapped
    // (pushes can sit unactioned for days). `dayBefore` only affects the
    // card's title copy ("today?" vs "tomorrow?"); derive it from whether the
    // linked date has already passed rather than defaulting to either.
    if (rsvpUrlOverride) {
      const base = new Date(rsvpUrlOverride.weekStart + 'T00:00:00');
      base.setDate(base.getDate() + rsvpUrlOverride.day);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      return { date: base, dow: rsvpUrlOverride.day, dayBefore: base.getTime() > todayStart.getTime() };
    }
    // Israel-anchored dates: `getPlanWeekStart` below reads local date parts, so
    // a raw `new Date()` files the answer under the wrong week between midnight
    // and 03:00 — and on a Sunday that is the whole previous week.
    if (teamDays.includes(todayDow)) {
      return { date: israelDateAnchor(), dow: todayDow, dayBefore: false }; // workout day
    }
    const tomorrowDow = tomorrowDate.getDay();
    if (teamDays.includes(tomorrowDow)) {
      return { date: tomorrowDate, dow: tomorrowDow, dayBefore: true }; // day before
    }
    return null;
  })();
  const rsvpWeekStart = rsvpUrlOverride ? rsvpUrlOverride.weekStart : (rsvpTarget ? getPlanWeekStart(rsvpTarget.date) : '');
  // `max > 0`, and matched on the RSVP date rather than the weekday: without the
  // first, `dailyDistances` always carries all seven days so a team day with no
  // session labelled the card "Tue · rest"; without the second it could name a
  // session from the previewed week after Saturday 20:00.
  const rsvpWorkout = rsvpTarget && weekly?.hasPlan && weekly.currentWeekStart
    ? weekly.dailyDistances?.find(
        d => d.max > 0 && planDayKey(weekly.currentWeekStart, d.dayOfWeek) === toISODate(rsvpTarget.date),
      )
    : null;
  // The title says "today"/"tomorrow" (via AttendanceRSVP's own dayBefore prop);
  // this label just names the workout itself.
  const rsvpLabel = rsvpWorkout?.type ? `${rsvpWorkout.day} · ${rsvpWorkout.type}` : rsvpWorkout?.day;
  // Time-based greeting, on Israel's clock like every other hour in the app.
  const greetHour = israelNow().hour;
  const greeting = greetHour < 12 ? t('goodMorning') : greetHour < 18 ? t('goodAfternoon') : t('goodEvening');
  const firstName = (athleteName || '').split(' ')[0];
  // Locale-aware race date (was a hardcoded "Dec 6, 2026" — reads as a Hebrew
  // month name once translated instead of forcing English into an RTL page).
  const raceDateLabel = GOAL_RACE.date.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });

  const heroWorkout = (() => {
    // Matched on DATE, not on weekday. `dayOfWeek` alone is meaningless without
    // the week it belongs to, and the week the server returns is not always the
    // one the browser is in: `getDisplayWeekStart` rolls the plan forward after
    // Saturday 20:00 Israel so athletes can preview the coming week. Matching by
    // weekday meant that on Saturday evening this card presented NEXT Saturday's
    // session as "today", and measured tonight's kilometres against it.
    if (!weekly?.hasPlan || !weekly.currentWeekStart) return null;
    const dayFor = (d: { dayOfWeek: number }) => planDayKey(weekly.currentWeekStart, d.dayOfWeek);
    const planned = (weekly.dailyDistances || []).filter(d => d.max > 0);
    const todayW = planned.find(d => dayFor(d) === todayKey);
    const tomorrowW = planned.find(d => dayFor(d) === tomorrowKey);
    if (!todayW && !tomorrowW) return null;

    // activityLocalDateStr, not a local-midnight comparison: see countThisWeek.
    // A 22:00 run used to read as tomorrow's, so the card kept insisting today's
    // workout wasn't done.
    const todayKm = recentActivities
      .filter(a => activityLocalDateStr(a.start_time) === todayKey)
      .reduce((s, a) => s + (a.distance || 0) / 1000, 0);
    const todayDone = !!todayW && todayKm >= todayW.min;
    // Next relevant workout: today's if it isn't done yet; otherwise
    // tomorrow's; falling back to today's (as a completed recap) if
    // there's no workout scheduled tomorrow.
    const nextWorkout = (todayW && !todayDone) ? todayW : (tomorrowW || todayW)!;
    const showingToday = nextWorkout === todayW;
    // Noon anchor off the matched day key, so the date handed to the calendar
    // link is the workout's own date and can't drift across a midnight.
    const nextDate = new Date(`${showingToday ? todayKey : tomorrowKey}T12:00:00`);
    return { nextWorkout, showingToday, todayDone, todayKm, nextDate };
  })();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">

      {/* ═══ LARGE TITLE (native home header) ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-400">{greeting}{firstName ? ` ${firstName}` : ''} 👋</p>
          <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight mt-0.5">מדרגות</h1>
        </div>
      </div>

      {/* ═══ ATTENDANCE (coach) — the coach's own "today's action" hero. RSVP is a
          DAY-BEFORE flow (matches the Mon 08:00 + 18:00 pushes for a Tue workout);
          the roster always shows, regardless of who's answered. The athlete's own
          RSVP lives inside the hero card below instead. ═══ */}
      {rsvpTarget && isCoach && (
        <AttendanceRoster weekStart={rsvpWeekStart} day={rsvpTarget.dow} />
      )}

      {/* ═══ RACE COUNTDOWN — compact native strip, kept minimal on purpose ═══ */}
      <section className="rounded-card bg-card/60 border border-page/60 p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-brand-600/15 flex items-center justify-center shrink-0">
          <MapPin className="h-5 w-5 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-ink-700 truncate">{t(GOAL_RACE.nameKey)}</p>
          <p className="text-xs text-ink-400 mt-0.5">
            {raceDateLabel} · {week > 0 ? t('weekOfTotal', { week, total: GOAL_RACE.totalWeeks }) : t('preSeason')}
          </p>
        </div>
        <div className="text-end shrink-0">
          <div className="text-2xl font-black text-ink-700 leading-none tabular-nums">{countdown.d}</div>
          <div className="text-2xs text-ink-400 mt-1">{tc('days')}</div>
        </div>
      </section>

      {/* ═══ COACH PULSE (attention + celebrate radar) — the rest of the coach hero ═══ */}
      {isCoach && <CoachPulse />}

      {/* ═══ HERO — the one thing this page is for. Coach: a slim stat strip
          (everything else already lives in Coach Pulse + the roster above) —
          PLUS, when the coach is also a runner (has their own athlete
          profile), their own today's/tomorrow's workout + RSVP right below it.
          A coach shouldn't be locked out of RSVPing for themselves just
          because they're staff. Pure athlete: today's/tomorrow's workout +
          embedded RSVP only. ═══ */}
      {isCoach && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <Card variant="muted">
            <BigStat
              value={hasData ? <>{Math.round(weekly!.weekTotalMin)}–{Math.round(weekly!.weekTotalMax)}<span className="text-sm font-medium text-ink-400"> {tc('km')}</span></> : '—'}
              label={t('weeklyVolume')}
            />
            {weekly?.weekDelta !== 0 && weekly?.weekDelta !== undefined && (
              <div className="flex items-center justify-center gap-1 mt-2">
                {weekly.weekDelta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-accent-600" /> : <TrendingDown className="h-3.5 w-3.5 text-band-3" />}
                <span className={cn('text-sm font-semibold', weekly.weekDelta > 0 ? 'text-accent-600' : 'text-band-3')}>
                  {weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}%
                </span>
              </div>
            )}
          </Card>
          <Card variant="muted">
            <BigStat value={stats?.athleteCount || 0} label="Athletes" />
            <p className="text-sm text-ink-400 mt-1 text-center">{stats?.groupCount || 0} groups</p>
          </Card>
          <Card variant="muted">
            <BigStat
              value={<>{stats?.deliverySuccessRate || 0}<span className="text-sm font-medium text-ink-400">%</span></>}
              label={t('delivery')}
            />
            <p className="text-sm text-ink-400 mt-1 text-center">{t('successRate')}</p>
          </Card>
          <Card variant="muted">
            <BigStat
              value={<>{weekly?.trainingDays || 0}<span className="text-sm font-medium text-ink-400">/7</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-ink-400 mt-1 text-center">{t('thisWeek')}</p>
          </Card>
        </section>
      )}

      {athleteId && heroWorkout ? (
        <NextWorkoutCard
          isToday={heroWorkout.showingToday}
          workout={heroWorkout.nextWorkout}
          typeLabel={typeLabels[heroWorkout.nextWorkout.type] || heroWorkout.nextWorkout.type}
          typeColor={typeColors[heroWorkout.nextWorkout.type] || '#159AFF'}
          typeTextColor={typeTextColors[heroWorkout.nextWorkout.type] || '#0B5285'}
          done={heroWorkout.showingToday && heroWorkout.todayDone}
          doneKm={heroWorkout.showingToday ? heroWorkout.todayKm : undefined}
          date={heroWorkout.nextDate}
          workoutHour={workoutHour}
          hasRsvpTarget={!!rsvpTarget}
          rsvpAnswered={rsvpAnswered}
          isNewPlan={isRecentlyPublished(weekly?.publishedAt)}
        >
          {rsvpTarget && (
            <AttendanceRSVP
              workoutLabel={rsvpLabel || undefined}
              weekStart={rsvpWeekStart}
              day={rsvpTarget.dow}
              dayBefore={rsvpTarget.dayBefore}
              workoutHour={workoutHour}
              hideIfAnswered={!rsvpTarget.dayBefore}
              onStatusChange={handleRsvpStatus}
            />
          )}
        </NextWorkoutCard>
      ) : !isCoach ? (
        <Card variant="muted">
          <EmptyState
            icon={Calendar}
            title={t('noPlanLoaded')}
            action={
              <Button onClick={() => router.push('/dashboard/plan/new')}>
                {t('uploadPlan')} <ArrowRight className="h-4 w-4" />
              </Button>
            }
          />
        </Card>
      ) : null}

      {/* ═══ SLIM STAT STRIP — streak · this-week completion · total km ·
          workouts this month. Deeper stats (records, volume trends) live on
          Profile → Statistics, not duplicated here. Shown for anyone with an
          athlete profile, including a coach who's also a runner — not just
          "pure" athletes. ═══ */}
      {athleteId && (
        <>
          {!!summary?.weekStreak && (
            <Card variant="muted">
              <div className="flex items-center justify-center gap-2">
                <Flame className="h-6 w-6 text-band-3" />
                <BigStat value={summary.weekStreak} label={summary.weekStreak === 1 ? tm('weekStreakOne') : tm('weekStreak')} />
              </div>
            </Card>
          )}
          <Card variant="muted">
            <BigStat
              value={<>{weeklyRuns}<span className="text-sm font-medium text-ink-400">/ {hasData ? weekly!.trainingDays : 7}</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-ink-400 mt-1 text-center">{t('completed')}</p>
          </Card>
          <StatTiles athleteId={athleteId} />
        </>
      )}

      {/* ═══ CLUB STANDINGS — this week's top three by distance, with my own row
          appended when I'm outside it. Moved here off the feed: the feed is
          "what happened", and a ranking is a control-panel readout. Renders for
          coaches too (athleteId is null for a coach with no athlete profile, in
          which case the card simply has no "me" row to highlight). ═══ */}
      <WeeklyLeaderboardCard athleteId={athleteId} />

      {/* Coach's "no plan at all" fallback already has its own upload CTA
          above; the athlete case already gets NextWorkoutCard's own built-in
          "confirm attendance / view plan" bar — no separate CTA needed here. */}

      {/* ═══ ACTIVITY SYNC EDITOR — Strava-style bottom sheet shown once, right
          after a background Garmin/Strava sync detects a genuinely new activity
          (set above in load()). Lets the athlete customize the auto-created
          feed post before it's out in the club feed. ═══ */}
      {syncedActivity && (
        <ActivitySyncEditor
          activity={syncedActivity}
          extraCount={syncedExtraCount}
          onClose={() => { setSyncedActivity(null); setSyncedExtraCount(0); }}
        />
      )}
    </div>
  );
}

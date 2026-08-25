'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Calendar, ArrowRight, TrendingUp, TrendingDown, MapPin, Flame } from 'lucide-react';
import { cn, getActivityWeekStart, getPlanWeekStart, isRecentlyPublished } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
import { useApi } from '@/lib/api';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { AttendanceRSVP, type AttendanceStatus } from '@/components/AttendanceRSVP';
import { NextWorkoutCard } from '@/components/NextWorkoutCard';
import { StatTiles } from '@/components/StatTiles';
import { CoachPulse } from '@/components/CoachPulse';
import { AttendanceRoster } from '@/components/AttendanceRoster';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { WORKOUT_TYPE_COLORS as typeColors, WORKOUT_TYPE_LABELS as typeLabels } from '@/lib/plans/workout-parsing';
import { Spinner, Card, BigStat, EmptyState, Button } from '@/components/ui';

const RACE_DATE = new Date('2026-12-06T09:00:00');
const TRAINING_BLOCK_START = new Date('2026-08-09T00:00:00');
const TOTAL_WEEKS = 17;

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
  keySessions: Array<{ day: string; dayOfWeek: number; name: string; type: string; totalKm: number; highlight: string; steps: any[] }>;
  typeDistribution: Record<string, number>;
  trainingDays: number;
  currentWeekStart: string;
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
  const { data: stats, isLoading: statsLoading } = useApi<DashboardStats>('/api/dashboard/stats');
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
        const res = await fetchActivities();
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
      const diff = RACE_DATE.getTime() - Date.now();
      if (diff <= 0) return;
      setCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
      const w = Math.floor((Date.now() - TRAINING_BLOCK_START.getTime()) / 604800000);
      setWeek(Math.max(0, Math.min(w + 1, TOTAL_WEEKS)));
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
      const mePromise = canSync ? fetch(`/api/athletes/me?id=${myAthleteId}`) : null;
      const activitiesPromise = fetchActivities();

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
          // profile just gets an empty list, same as before.
          const filtered = allActs.filter((a: any) => a.athlete_id === myAthleteId);
          setRecentActivities(filtered.slice(0, 3));
          preSyncActivityIds = new Set(filtered.map((a: any) => a.id));

          if (myAthleteId) {
            // Activity week (Sunday-based, matches the club's plan week).
            const weekStart = new Date(getActivityWeekStart(new Date()));
            const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
            setWeeklyRuns(thisWeekActs.length);
          }
        }

        // Sync Strava in the background without blocking the dashboard UI.
        if (willSync && myAthleteId) {
          try {
            const stravaSyncRes = await fetch('/api/strava/sync-activities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ athleteId: myAthleteId }),
            });
            if (!stravaSyncRes.ok) throw new Error('Strava sync failed');
          } catch {
            // Re-arm so a failed sync retries on the next visit.
            localStorage.removeItem(syncKey);
          }

          // Refresh activities after sync completes
          try {
            const refreshRes = await fetchActivities();
            if (refreshRes.ok) {
              const refreshData = await refreshRes.json();
              const allActs = refreshData.activities || [];
              const filtered = allActs.filter((a: any) => a.athlete_id === myAthleteId);
              setRecentActivities(filtered.slice(0, 3));

              const weekStart = new Date(getActivityWeekStart(new Date()));
              const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
              setWeeklyRuns(thisWeekActs.length);

              // This is the "sync just completed" moment: activities present now
              // that weren't in the pre-sync snapshot are genuinely new. `filtered`
              // is already start_time-desc (server order), so the first match is
              // the most recent. Skip anything older than 24h so a first-time
              // 180-day Strava backfill doesn't pop the customization sheet for a
              // run from months ago.
              const newActivities = filtered.filter((a: any) => !preSyncActivityIds.has(a.id));
              const RECENT_MS = 24 * 60 * 60 * 1000;
              const justSynced = newActivities.find(
                (a: any) => Date.now() - new Date(a.start_time).getTime() < RECENT_MS,
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

  // Only the very first-ever load (no cached stats/weekly yet) blocks on a
  // spinner — keepPreviousData means a revisit shows the last-known content
  // instantly while these quietly revalidate in the background.
  if (statsLoading || weeklyLoading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Spinner size={40} />
    </div>
  );

  const todayDow = new Date().getDay();
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
    if (teamDays.includes(todayDow)) {
      return { date: new Date(), dow: todayDow, dayBefore: false }; // workout day
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDow = tomorrow.getDay();
    if (teamDays.includes(tomorrowDow)) {
      return { date: tomorrow, dow: tomorrowDow, dayBefore: true }; // day before
    }
    return null;
  })();
  const rsvpWeekStart = rsvpUrlOverride ? rsvpUrlOverride.weekStart : (rsvpTarget ? getPlanWeekStart(rsvpTarget.date) : '');
  const rsvpWorkout = rsvpTarget ? weekly?.dailyDistances?.find(d => d.dayOfWeek === rsvpTarget.dow) : null;
  // The title says "today"/"tomorrow" (via AttendanceRSVP's own dayBefore prop);
  // this label just names the workout itself.
  const rsvpLabel = rsvpWorkout?.type ? `${rsvpWorkout.day} · ${rsvpWorkout.type}` : rsvpWorkout?.day;
  // Time-based greeting (Israel-ish local hour) for the large title.
  const greetHour = new Date().getHours();
  const greeting = greetHour < 12 ? t('goodMorning') : greetHour < 18 ? t('goodAfternoon') : t('goodEvening');
  const firstName = (athleteName || '').split(' ')[0];
  // Locale-aware race date (was a hardcoded "Dec 6, 2026" — reads as a Hebrew
  // month name once translated instead of forcing English into an RTL page).
  const raceDateLabel = RACE_DATE.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });

  const heroWorkout = (() => {
    const todayW = weekly?.dailyDistances?.find(d => d.dayOfWeek === todayDow && d.max > 0);
    const tomorrowDow = (todayDow + 1) % 7;
    const tomorrowW = weekly?.dailyDistances?.find(d => d.dayOfWeek === tomorrowDow && d.max > 0);
    if (!todayW && !tomorrowW) return null;

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayKm = recentActivities.filter(a => new Date(a.start_time) >= todayStart).reduce((s, a) => s + (a.distance || 0) / 1000, 0);
    const todayDone = !!todayW && todayKm >= todayW.min;
    // Next relevant workout: today's if it isn't done yet; otherwise
    // tomorrow's; falling back to today's (as a completed recap) if
    // there's no workout scheduled tomorrow.
    const nextWorkout = (todayW && !todayDone) ? todayW : (tomorrowW || todayW)!;
    const showingToday = nextWorkout === todayW;
    const nextDate = showingToday ? new Date() : (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })();
    return { nextWorkout, showingToday, todayDone, todayKm, nextDate };
  })();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">

      {/* ═══ LARGE TITLE (native home header) ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">{greeting}{firstName ? ` ${firstName}` : ''} 👋</p>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mt-0.5">מדרגות</h1>
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
      <section className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary-600/15 flex items-center justify-center shrink-0">
          <MapPin className="h-5 w-5 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{t('valenciaMarathon')}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {raceDateLabel} · {week > 0 ? t('weekOfTotal', { week, total: TOTAL_WEEKS }) : t('preSeason')}
          </p>
        </div>
        <div className="text-end shrink-0">
          <div className="text-2xl font-black text-white leading-none tabular-nums">{countdown.d}</div>
          <div className="text-2xs text-slate-500 mt-1">{tc('days')}</div>
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
              value={hasData ? <>{Math.round(weekly!.weekTotalMin)}–{Math.round(weekly!.weekTotalMax)}<span className="text-sm font-medium text-slate-500"> {tc('km')}</span></> : '—'}
              label={t('weeklyVolume')}
            />
            {weekly?.weekDelta !== 0 && weekly?.weekDelta !== undefined && (
              <div className="flex items-center justify-center gap-1 mt-2">
                {weekly.weekDelta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-green-400" /> : <TrendingDown className="h-3.5 w-3.5 text-amber-400" />}
                <span className={cn('text-sm font-semibold', weekly.weekDelta > 0 ? 'text-green-400' : 'text-amber-400')}>
                  {weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}%
                </span>
              </div>
            )}
          </Card>
          <Card variant="muted">
            <BigStat value={stats?.athleteCount || 0} label="Athletes" />
            <p className="text-sm text-slate-500 mt-1 text-center">{stats?.groupCount || 0} groups</p>
          </Card>
          <Card variant="muted">
            <BigStat
              value={<>{stats?.deliverySuccessRate || 0}<span className="text-sm font-medium text-slate-500">%</span></>}
              label={t('delivery')}
            />
            <p className="text-sm text-slate-500 mt-1 text-center">{t('successRate')}</p>
          </Card>
          <Card variant="muted">
            <BigStat
              value={<>{weekly?.trainingDays || 0}<span className="text-sm font-medium text-slate-500">/7</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-slate-500 mt-1 text-center">{t('thisWeek')}</p>
          </Card>
        </section>
      )}

      {athleteId && heroWorkout ? (
        <NextWorkoutCard
          isToday={heroWorkout.showingToday}
          workout={heroWorkout.nextWorkout}
          typeLabel={typeLabels[heroWorkout.nextWorkout.type] || heroWorkout.nextWorkout.type}
          typeColor={typeColors[heroWorkout.nextWorkout.type] || '#6366f1'}
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
                <Flame className="h-6 w-6 text-orange-400" />
                <BigStat value={summary.weekStreak} label={summary.weekStreak === 1 ? tm('weekStreakOne') : tm('weekStreak')} />
              </div>
            </Card>
          )}
          <Card variant="muted">
            <BigStat
              value={<>{weeklyRuns}<span className="text-sm font-medium text-slate-500">/ {hasData ? weekly!.trainingDays : 7}</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-slate-500 mt-1 text-center">{t('completed')}</p>
          </Card>
          <StatTiles athleteId={athleteId} />
        </>
      )}

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

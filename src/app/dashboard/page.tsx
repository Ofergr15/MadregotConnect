'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { Calendar, ArrowRight, TrendingUp, TrendingDown, MapPin } from 'lucide-react';
import { cn, getActivityWeekStart, getPlanWeekStart } from '@/lib/utils';
import { fetchActivities } from '@/lib/activities-client';
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
  const router = useRouter();
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [teamDays, setTeamDays] = useState<number[]>([2, 5]); // team-workout days (0=Sun..6=Sat), admin-editable
  const [workoutHour, setWorkoutHour] = useState(18); // team workout start hour (Israel), admin-editable — used for the "add to calendar" event time
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
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const [week, setWeek] = useState(0);
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [athleteName, setAthleteName] = useState<string>('');
  const [weeklyRuns, setWeeklyRuns] = useState(0);

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
    // Admin-editable team-workout days → which days the RSVP card shows on.
    fetch('/api/reminder-config').then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d?.config?.teamDays)) setTeamDays(d.config.teamDays);
        if (typeof d?.config?.workoutHour === 'number') setWorkoutHour(d.config.workoutHour);
      })
      .catch(() => {});
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

  useEffect(() => {
    async function load() {
      const myAthleteId = localStorage.getItem('athlete_id');
      const myIsCoach = !!localStorage.getItem('coach_email');
      const syncKey = myAthleteId ? `dashboard_synced:${myAthleteId}` : 'dashboard_synced';
      // Super-user "view as" preview is read-only (sync POST is blocked).
      const isPreviewing = !!localStorage.getItem('view_as_role');
      const canSync = !!myAthleteId && !myIsCoach && !isPreviewing;

      // Fire every independent request up front — none of these wait on each
      // other's response body, so there's no reason to stage them. The only
      // real ordering constraints are downstream: the activities snapshot must
      // be read BEFORE the background sync starts, and the sync must finish
      // before refetching — both handled below, after these all resolve.
      const mePromise = canSync ? fetch(`/api/athletes/me?id=${myAthleteId}`) : null;
      const statsPromise = fetch('/api/dashboard/stats');
      const weeklyPromise = fetch('/api/dashboard/weekly');
      const activitiesPromise = fetchActivities();

      try {
        // Gate on res.ok so a 5xx doesn't get parsed as {error} and rendered as
        // zeros / "no plan"; leave the prior state so the UI degrades gracefully.
        const [sRes, wRes] = await Promise.all([statsPromise, weeklyPromise]);
        if (sRes.ok) setStats(await sRes.json());
        if (wRes.ok) setWeekly(await wRes.json());

        // Show the dashboard as soon as stats+plan are in hand — don't wait on
        // activities, which only feeds the sync flow below.
        setLoading(false);

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
          const filtered = myIsCoach ? allActs : allActs.filter((a: any) => a.athlete_id === myAthleteId);
          setRecentActivities(filtered.slice(0, 3));
          preSyncActivityIds = new Set(filtered.map((a: any) => a.id));

          if (!myIsCoach && myAthleteId) {
            // Activity week (Sunday-based, matches the club's plan week).
            const weekStart = new Date(getActivityWeekStart(new Date()));
            const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
            setWeeklyRuns(thisWeekActs.length);
          }
        }

        // Sync Strava in the background without blocking the dashboard UI.
        if (willSync && myAthleteId && !myIsCoach) {
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
      } catch (e) { console.error(e); setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
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
  const rsvpWeekStart = rsvpTarget ? getPlanWeekStart(rsvpTarget.date) : '';
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
          (everything else already lives in Coach Pulse + the roster above).
          Athlete: today's/tomorrow's workout + embedded RSVP. ═══ */}
      {isCoach ? (
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
      ) : heroWorkout ? (
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
        >
          {rsvpTarget && (
            <AttendanceRSVP
              workoutLabel={rsvpLabel || undefined}
              weekStart={rsvpWeekStart}
              day={rsvpTarget.dow}
              dayBefore={rsvpTarget.dayBefore}
              hideIfAnswered={!rsvpTarget.dayBefore}
              onStatusChange={handleRsvpStatus}
            />
          )}
        </NextWorkoutCard>
      ) : (
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
      )}

      {/* ═══ SLIM STAT STRIP (athlete only) — total km · workouts this month,
          plus this-week completion. Deeper stats (records, streak, volume
          trends) live on Profile → Statistics, not duplicated here. ═══ */}
      {!isCoach && athleteId && (
        <>
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

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  Calendar, Users, ArrowRight, TrendingUp, TrendingDown, Heart, Route,
  Sun, Cloud, CloudRain, Droplets, ChevronRight, MapPin, Zap, Wind,
  Loader2, Dumbbell, Trophy,
} from 'lucide-react';
import { cn, getActivityWeekStart, getPlanWeekStart, formatActivityTime, formatActivityDate, activityLocalHour, resolveGroup, israelNow } from '@/lib/utils';
import { fetchActivities, fetchActivityDetails } from '@/lib/activities-client';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { WatchAlertsCard } from '@/components/WatchAlertsCard';
import { AttendanceRSVP, type AttendanceStatus } from '@/components/AttendanceRSVP';
import { NextWorkoutCard } from '@/components/NextWorkoutCard';
import { MomentumCard } from '@/components/MomentumCard';
import { StatTiles } from '@/components/StatTiles';
import { SquadStandings } from '@/components/SquadStandings';
import { CoachPulse } from '@/components/CoachPulse';
import { AttendanceRoster } from '@/components/AttendanceRoster';
import { ActivitySyncEditor } from '@/components/ActivitySyncEditor';
import { WorkoutDetailModal } from '@/components/WorkoutDetailModal';
import { WORKOUT_TYPE_COLORS as typeColors, WORKOUT_TYPE_LABELS as typeLabels } from '@/lib/plans/workout-parsing';
import { Spinner, Card, BigStat, EmptyState, SegmentedControl, Button } from '@/components/ui';

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

interface WeatherDay {
  date: string; day: string; tempMin: number; tempMax: number;
  precipitation: number; windSpeed: number; humidity: number; code: number;
}

function inferRunTypeFromActivity(distanceKm: number, avgPaceSec: number | null): { type: string; label: string; color: string; bg: string } {
  const types: Record<string, { label: string; color: string; bg: string }> = {
    long_run: { label: 'Long Run', color: 'text-purple-400', bg: 'bg-purple-500/15' },
    tempo: { label: 'Tempo', color: 'text-orange-400', bg: 'bg-orange-500/15' },
    intervals: { label: 'Intervals', color: 'text-red-400', bg: 'bg-red-500/15' },
    easy: { label: 'Easy', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    recovery: { label: 'Recovery', color: 'text-slate-400', bg: 'bg-slate-500/15' },
  };

  if (distanceKm >= 16) return { type: 'long_run', ...types.long_run };
  if (avgPaceSec && avgPaceSec < 270 && distanceKm >= 8) return { type: 'tempo', ...types.tempo };
  if (avgPaceSec && avgPaceSec < 290 && distanceKm >= 6 && distanceKm < 14) return { type: 'intervals', ...types.intervals };
  if (distanceKm < 7 && avgPaceSec && avgPaceSec > 330) return { type: 'recovery', ...types.recovery };
  return { type: 'easy', ...types.easy };
}

function WeatherIcon({ code, className = "h-5 w-5" }: { code: number; className?: string }) {
  if (code <= 1) return <Sun className={cn(className, "text-amber-400")} />;
  if (code <= 3) return <Cloud className={cn(className, "text-slate-300")} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className={cn(className, "text-blue-400")} />;
  return <Cloud className={cn(className, "text-slate-300")} />;
}

function heatLevel(temp: number): { emoji: string; label: string; color: string } {
  if (temp >= 32) return { emoji: '🥵', label: 'Extreme', color: 'text-red-400' };
  if (temp >= 28) return { emoji: '🌡️', label: 'Hot', color: 'text-orange-400' };
  if (temp >= 22) return { emoji: '👌', label: 'Good', color: 'text-green-400' };
  return { emoji: '❄️', label: 'Cool', color: 'text-cyan-400' };
}

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
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

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [weather, setWeather] = useState<WeatherDay[]>([]);
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
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const lastClickRef = useRef<{ index: number; time: number } | null>(null);
  const [isCoach, setIsCoach] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [athleteName, setAthleteName] = useState<string>('');
  const [weeklyKm, setWeeklyKm] = useState(0);
  const [weeklyRuns, setWeeklyRuns] = useState(0);
  const [runnerWeeklyVolumes, setRunnerWeeklyVolumes] = useState<Array<{ week: string; km: number; runs: number }>>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; groupId: string; distanceKm: number; runs: number }>>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | string>('all');
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  // Which group's pace the athlete views as "theirs" (0=G1, 1=G2, 2=G3). Defaults
  // to their assigned group; a manual pick is remembered per-browser. Display-only
  // — never changes group assignment or what's pushed to the watch.
  const [viewGroup, setViewGroup] = useState<number>(0);

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
      const leaderboardPromise = !myIsCoach ? fetch('/api/groups/leaderboard') : null;
      const groupsPromise = !myIsCoach ? fetch('/api/groups') : null;

      // Weather — fully non-blocking; renders when it arrives (UI guards empty).
      fetch(
        'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&hourly=temperature_2m,relativehumidity_2m,precipitation,windspeed_10m,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
      )
        .then(r => (r.ok ? r.json() : null))
        .then(wr => {
          if (!wr?.hourly) return;
          const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const map: Record<string, { t: number[]; h: number[]; p: number[]; w: number[]; c: number[] }> = {};
          wr.hourly.time.forEach((time: string, i: number) => {
            const hr = new Date(time).getHours();
            if (hr >= 5 && hr <= 8) {
              const dk = time.split('T')[0];
              if (!map[dk]) map[dk] = { t: [], h: [], p: [], w: [], c: [] };
              map[dk].t.push(wr.hourly.temperature_2m[i]);
              map[dk].h.push(wr.hourly.relativehumidity_2m?.[i] ?? 0);
              map[dk].p.push(wr.hourly.precipitation[i]);
              map[dk].w.push(wr.hourly.windspeed_10m[i]);
              map[dk].c.push(wr.hourly.weathercode[i]);
            }
          });
          setWeather(Object.entries(map).map(([date, d]) => ({
            date, day: dn[new Date(date).getDay()],
            tempMin: Math.round(Math.min(...d.t)), tempMax: Math.round(Math.max(...d.t)),
            humidity: Math.round(d.h.reduce((a, b) => a + b, 0) / d.h.length),
            precipitation: Math.round(d.p.reduce((a, b) => a + b, 0) * 10) / 10,
            windSpeed: Math.round(Math.max(...d.w)),
            code: d.c.sort((a, b) => b - a)[0],
          })));
        })
        .catch(() => {});

      try {
        // Gate on res.ok so a 5xx doesn't get parsed as {error} and rendered as
        // zeros / "no plan"; leave the prior state so the UI degrades gracefully.
        const [sRes, wRes] = await Promise.all([statsPromise, weeklyPromise]);
        if (sRes.ok) setStats(await sRes.json());
        if (wRes.ok) setWeekly(await wRes.json());

        // Show the dashboard as soon as stats+plan are in hand — don't wait on
        // activities/leaderboard/groups, which render into sections further
        // down the page once they land.
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
            const totalKm = thisWeekActs.reduce((sum: number, a: any) => sum + (a.distance || 0), 0) / 1000;
            setWeeklyKm(Math.round(totalKm * 10) / 10);
            setWeeklyRuns(thisWeekActs.length);

            const weekMap: Record<string, { km: number; runs: number }> = {};
            filtered.forEach((a: any) => {
              const key = getActivityWeekStart(new Date(a.start_time))
                .split('-').reverse().slice(0, 2).join('/'); // DD/MM of the week-start Sunday
              if (!weekMap[key]) weekMap[key] = { km: 0, runs: 0 };
              weekMap[key].km += (a.distance || 0) / 1000;
              weekMap[key].runs += 1;
            });

            const sortedWeeks = Object.entries(weekMap)
              .map(([week, data]) => ({ week, km: Math.round(data.km * 10) / 10, runs: data.runs }))
              .sort((a, b) => {
                const [dA, mA] = a.week.split('/').map(Number);
                const [dB, mB] = b.week.split('/').map(Number);
                return mA !== mB ? mA - mB : dA - dB;
              })
              .slice(-12);
            setRunnerWeeklyVolumes(sortedWeeks);
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

              // Monday-based week so weekly km matches Garmin/Strava.
              const weekStart = new Date(getActivityWeekStart(new Date()));
              const thisWeekActs = filtered.filter((a: any) => new Date(a.start_time) >= weekStart);
              const totalKm = thisWeekActs.reduce((sum: number, a: any) => sum + (a.distance || 0), 0) / 1000;
              setWeeklyKm(Math.round(totalKm * 10) / 10);
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

        if (!myIsCoach) {
          try {
            const [lbRes, grpRes] = await Promise.all([
              fetch('/api/groups/leaderboard'),
              fetch('/api/groups'),
            ]);
            if (lbRes.ok) {
              const lbData = await lbRes.json();
              setLeaderboard(lbData.leaderboard || []);
            }
            if (grpRes.ok) {
              const grpData = await grpRes.json();
              setGroups(grpData.groups || grpData || []);
            }
          } catch {}
        }
      } catch (e) { console.error(e); setLoading(false); }
    }
    load();
  }, []);

  // Resolve the athlete's "view group": a remembered manual pick wins, else map
  // their assigned group_id → index (0/1/2) via the group name. Runs once groups
  // are loaded so the name→index mapping is available.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('view_group') : null;
    if (stored !== null && stored !== '') {
      const n = parseInt(stored, 10);
      if (n >= 0 && n <= 2) { setViewGroup(n); return; }
    }
    const myGroupId = typeof window !== 'undefined' ? localStorage.getItem('athlete_group_id') : null;
    const myGroup = groups.find(g => g.id === myGroupId);
    const idx = myGroup ? resolveGroup(myGroup.name).index : -1;
    if (idx >= 0) setViewGroup(idx);
  }, [groups]);

  const pickViewGroup = (idx: number) => {
    setViewGroup(idx);
    try { localStorage.setItem('view_group', String(idx)); } catch { /* ignore */ }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Spinner size={40} />
    </div>
  );

  const todayDow = new Date().getDay();
  const hasData = weekly && weekly.weekTotalMax > 0;
  const todayWeather = weather.find(w => new Date(w.date).getDay() === todayDow);
  const todayWorkout = weekly?.dailyDistances?.find(d => d.dayOfWeek === todayDow);

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

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">

      {/* ═══ LARGE TITLE (native home header) ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">{greeting}{firstName ? ` ${firstName}` : ''} 👋</p>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mt-0.5">מדרגות</h1>
        </div>
      </div>

      {/* ═══ ATTENDANCE (coach) — RSVP is a DAY-BEFORE flow (matches the Mon 08:00 +
          18:00 pushes for a Tue workout); the coach roster always shows, regardless
          of who's answered. Days come from the admin teamDays config. The athlete's
          own RSVP now lives inside the "next workout" hero card further down (same
          rsvpTarget/weekStart/day/dayBefore targeting — only the display moved). */}
      {rsvpTarget && isCoach && (
        <AttendanceRoster weekStart={rsvpWeekStart} day={rsvpTarget.dow} />
      )}

      {/* ═══ RACE COUNTDOWN — compact native strip (was a giant 8xl number) ═══ */}
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

      {/* ═══ COACH PULSE (attention + celebrate radar) ═══ */}
      {isCoach && <CoachPulse />}

      {/* ═══ STATS ROW ═══ */}
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
            <BigStat
              value={<>{weekly?.trainingDays || 0}<span className="text-sm font-medium text-slate-500">/7</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-slate-500 mt-1 text-center">{t('thisWeek')}</p>
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
        </section>
      ) : (
        <section className="space-y-3 sm:space-y-4">
          {/* Training days completed this week — a standalone stat (unrelated to
              which specific workout is "next", so it stays outside the hero card). */}
          <Card variant="muted">
            <BigStat
              value={<>{weeklyRuns}<span className="text-sm font-medium text-slate-500">/ {hasData ? weekly!.trainingDays : 7}</span></>}
              label={t('trainingDays')}
            />
            <p className="text-sm text-slate-500 mt-1 text-center">{t('completed')}</p>
          </Card>

          {/* ═══ NEXT WORKOUT hero card — consolidates the RSVP + the today/tomorrow
              workout tile into one card: next relevant workout, inline "add to
              calendar" + embedded RSVP, and a context-aware CTA bar below it. ═══ */}
          {(() => {
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

            return (
              <NextWorkoutCard
                isToday={showingToday}
                workout={nextWorkout}
                typeLabel={typeLabels[nextWorkout.type] || nextWorkout.type}
                typeColor={typeColors[nextWorkout.type] || '#6366f1'}
                done={showingToday && todayDone}
                doneKm={showingToday ? todayKm : undefined}
                date={nextDate}
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
            );
          })()}
        </section>
      )}

      {/* ═══ HEADLINE STAT TILES (total km · workouts this month) ═══ */}
      {!isCoach && athleteId && (
        <div className="mb-4">
          <StatTiles athleteId={athleteId} />
        </div>
      )}

      {/* ═══ MOMENTUM: week streak + this-week recap ═══ */}
      {!isCoach && athleteId && (
        <div className="mb-4">
          <MomentumCard athleteId={athleteId} />
        </div>
      )}

      {/* ═══ דבוקה SQUAD RIVALRY (team-wide — all roles) ═══ */}
      <div className="mb-4">
        <SquadStandings />
      </div>

      {/* Section header groups the heavier stats/leaderboard below the fold */}
      {!isCoach && runnerWeeklyVolumes.length > 1 && (
        <p className="text-2xs font-bold uppercase tracking-wider text-slate-500 px-1 pt-1">{t('myStats')}</p>
      )}

      {/* ═══ WEEKLY VOLUME + LEADERBOARD (side by side) ═══ */}
      {!isCoach && runnerWeeklyVolumes.length > 1 && (() => {
        const maxKm = Math.max(...runnerWeeklyVolumes.map(w => w.km));
        const lastWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 1];
        const prevWeek = runnerWeeklyVolumes[runnerWeeklyVolumes.length - 2];
        const trend = prevWeek && prevWeek.km > 0 ? Math.round(((lastWeek.km - prevWeek.km) / prevWeek.km) * 100) : 0;
        const targetMin = hasData ? Math.round(weekly!.weekTotalMin) : 0;
        const targetMax = hasData ? Math.round(weekly!.weekTotalMax) : 0;
        const filtered = leaderboardFilter === 'all' ? leaderboard : leaderboard.filter(a => a.groupId === leaderboardFilter);
        const top3 = filtered.slice(0, 3);
        const myRank = filtered.findIndex(a => a.id === athleteId) + 1;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {/* LEFT: Weekly Volume */}
            <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black text-white tabular-nums">{weeklyKm}</span>
                  <span className="text-xs text-slate-500">{tc('km')} {t('thisWeek')}</span>
                </div>
                <div className="flex items-center gap-2">
                  {targetMax > 0 && (
                    <span className="text-xs font-semibold text-slate-300">Goal: {targetMin}–{targetMax} {tc('km')}</span>
                  )}
                  {trend !== 0 && (
                    <span className={cn('text-3xs font-bold px-1.5 py-0.5 rounded-md', trend > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')}>
                      {trend > 0 ? '+' : ''}{trend}%
                    </span>
                  )}
                </div>
              </div>
              {targetMax > 0 && (
                <div className="w-full h-1.5 bg-slate-700/50 rounded-full overflow-hidden mb-4">
                  <div
                    className={cn('h-full rounded-full transition-all', weeklyKm >= targetMin ? 'bg-emerald-400' : 'bg-[#fc5200]')}
                    style={{ width: `${Math.min(100, (weeklyKm / targetMax) * 100)}%` }}
                  />
                </div>
              )}
              <div className="flex items-end justify-center gap-[6px]" style={{ height: '100px' }}>
                {runnerWeeklyVolumes.map((w, i) => {
                  const isLast = i === runnerWeeklyVolumes.length - 1;
                  const barH = maxKm > 0 ? Math.max(10, Math.round((w.km / maxKm) * 65)) : 10;
                  return (
                    <div key={i} className="flex flex-col items-center justify-end" style={{ height: '100px', width: '28px' }}>
                      <span className={cn('text-3xs font-bold mb-1 tabular-nums', isLast ? 'text-[#fc5200]' : 'text-white/70')}>{w.km}</span>
                      <div
                        className={cn('rounded-full', isLast ? 'bg-[#fc5200]' : 'bg-slate-600')}
                        style={{ height: `${barH}px`, width: '12px' }}
                      />
                      <span className={cn('text-3xs mt-1', isLast ? 'text-white' : 'text-slate-400')}>{w.week}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* RIGHT: Leaderboard */}
            {leaderboard.length > 0 && (
              <section className="bg-slate-800/30 rounded-2xl border border-slate-700/20 p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Trophy className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Top 3</span>
                  </div>
                  {groups.length > 1 && (
                    <SegmentedControl
                      value={leaderboardFilter}
                      onChange={setLeaderboardFilter}
                      options={[
                        { value: 'all', label: 'All' },
                        ...groups.map(g => ({ value: g.id, label: g.name.replace('Group ', '').replace(' - SUB ', ' ') })),
                      ]}
                    />
                  )}
                </div>
                <div className="flex items-end justify-center gap-5 px-2" style={{ height: '100px' }}>
                  {top3.length >= 2 && (
                    <div className="flex flex-col items-center" style={{ width: '56px' }}>
                      <span className="text-2xs font-bold text-slate-300 mb-1 tabular-nums">{top3[1].distanceKm}</span>
                      <div className="w-6 rounded-t bg-slate-400/80" style={{ height: '50px' }} />
                      <span className="text-2xs text-slate-300 mt-1.5 font-medium whitespace-nowrap">{top3[1].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {top3.length >= 1 && (
                    <div className="flex flex-col items-center" style={{ width: '56px' }}>
                      <span className="text-sm mb-0.5">👑</span>
                      <span className="text-xs font-black text-yellow-400 mb-1 tabular-nums">{top3[0].distanceKm}</span>
                      <div className="w-6 rounded-t bg-yellow-500" style={{ height: '70px' }} />
                      <span className="text-2xs text-white font-bold mt-1.5 whitespace-nowrap">{top3[0].name.split(' ')[0]}</span>
                    </div>
                  )}
                  {top3.length >= 3 && (
                    <div className="flex flex-col items-center" style={{ width: '56px' }}>
                      <span className="text-2xs font-bold text-amber-500 mb-1 tabular-nums">{top3[2].distanceKm}</span>
                      <div className="w-6 rounded-t bg-amber-600/80" style={{ height: '35px' }} />
                      <span className="text-2xs text-slate-300 mt-1.5 font-medium whitespace-nowrap">{top3[2].name.split(' ')[0]}</span>
                    </div>
                  )}
                </div>
                {myRank > 3 && <p className="text-3xs text-slate-500 text-center mt-2">You: #{myRank}</p>}
              </section>
            )}
          </div>
        );
      })()}

      {/* ═══ WATCH ALERTS & VOICE TIP (athletes only) ═══ */}
      {!isCoach && <WatchAlertsCard />}

      {/* ═══ DAILY KM BAR CHART ═══ */}
      <section className="bg-slate-800/30 rounded-2xl p-4 sm:p-6 border border-slate-700/20">
        <div className="flex items-center justify-between mb-4 sm:mb-5">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white">{t('weeklyPlan')}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{t('weekOf')} {weekly?.currentWeekStart || '—'}</p>
          </div>
          {hasData && (
            <div className="hidden sm:flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(weekly!.typeDistribution || {}).map(([type]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: typeColors[type] }} />
                  <span className="text-xs text-slate-400 font-medium">{typeLabels[type] || type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasData ? (
          <>
            {/* Custom Bar Chart */}
            <div className="relative" onMouseLeave={() => { setHoveredBar(null); setSelectedBar(null); }}>
              {/* Y-axis labels */}
              <div className="flex">
                <div className="w-6 sm:w-8 flex flex-col justify-between py-1 pr-2 h-48 sm:h-60">
                  {(() => {
                    const maxVal = Math.max(...weekly!.dailyDistances.map(d => d.max), 1);
                    const topTick = Math.ceil(maxVal / 8) * 8;
                    return [topTick, Math.round(topTick * 0.75), Math.round(topTick * 0.5), Math.round(topTick * 0.25), 0].map(v => (
                      <span key={v} className="text-2xs text-slate-400 text-end leading-none">{v}</span>
                    ));
                  })()}
                </div>

                {/* Bars */}
                <div className="flex-1 flex items-end gap-1 sm:gap-2 h-48 sm:h-60">
                  {weekly!.dailyDistances.map((d, i) => {
                    const maxVal = Math.max(...weekly!.dailyDistances.map(x => x.max), 1);
                    const topTick = Math.ceil(maxVal / 8) * 8;
                    const session = weekly!.keySessions.find(s => s.dayOfWeek === d.dayOfWeek);
                    const isActive = hoveredBar === i || selectedBar === i;
                    const someActive = hoveredBar !== null || selectedBar !== null;
                    const sessions = d.sessions || [];
                    const hasMultiple = sessions.length > 1;

                    return (
                      <div
                        key={d.dayOfWeek}
                        className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer group relative"
                        onMouseEnter={() => setHoveredBar(i)}
                        onClick={() => {
                          setSelectedBar(i);
                          if (session) setSelectedSession(session);
                        }}
                      >
                        {/* Tooltip on hover */}
                        {isActive && d.max > 0 && (
                          <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-10 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 shadow-xl whitespace-nowrap pointer-events-none">
                            <p className="text-xs font-bold text-white">{d.day}{hasMultiple && ' (2 sessions)'}</p>
                            <p className="text-2xs text-slate-300">
                              {d.min && d.min !== d.max ? `${d.min}–${d.max}` : d.max} km · {typeLabels[d.type] || d.type}
                            </p>
                          </div>
                        )}

                        {/* The bar(s) */}
                        {hasMultiple ? (
                          <div className={cn(
                            'w-full max-w-[44px] flex gap-0.5 items-end transition-all duration-150',
                            isActive && 'scale-105',
                          )} style={{ height: `${(d.max / topTick) * 100}%`, minHeight: '4px' }}>
                            {sessions.map((s, j) => {
                              const segH = d.max > 0 ? (s.max / d.max) * 100 : 0;
                              return (
                                <div
                                  key={j}
                                  className={cn('flex-1 rounded-t-md', isActive && 'ring-1 ring-white/50')}
                                  style={{
                                    height: `${Math.max(segH, 20)}%`,
                                    backgroundColor: typeColors[s.type] || '#6366f1',
                                    opacity: someActive ? (isActive ? 1 : 0.3) : (d.dayOfWeek === todayDow ? 1 : 0.75),
                                    filter: isActive ? 'brightness(1.2)' : 'none',
                                  }}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'w-full max-w-[32px] sm:max-w-[44px] rounded-t-lg transition-all duration-150',
                              isActive && 'ring-2 ring-white/60 scale-105',
                            )}
                            style={{
                              height: `${d.max > 0 ? (d.max / topTick) * 100 : 0}%`,
                              minHeight: d.max > 0 ? '4px' : '0px',
                              backgroundColor: typeColors[d.type] || '#6366f1',
                              opacity: someActive ? (isActive ? 1 : 0.3) : (d.dayOfWeek === todayDow ? 1 : 0.75),
                              filter: isActive ? 'brightness(1.2)' : 'none',
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* X-axis labels + day cards */}
              <div className="flex mt-3 ml-6 sm:ml-8">
                <div className="flex-1 grid grid-cols-7 gap-1 sm:gap-2">
                  {weekly!.dailyDistances.map((d, i) => {
                    const session = weekly!.keySessions.find(s => s.dayOfWeek === d.dayOfWeek);
                    const isActive = hoveredBar === i || selectedBar === i;
                    const sessions = d.sessions || [];
                    const hasMultiple = sessions.length > 1;
                    return (
                      <button
                        key={d.dayOfWeek}
                        type="button"
                        onClick={() => session && setSelectedSession(session)}
                        className={cn(
                          "text-center py-2.5 sm:py-3 rounded-xl transition-all relative min-h-[44px] min-w-[44px] active:scale-[0.98] active:bg-slate-700/60",
                          session ? "cursor-pointer" : "",
                          isActive ? "bg-slate-700/60 ring-1 ring-white/20" :
                            d.dayOfWeek === todayDow ? "bg-primary-600/15 ring-1 ring-primary-600/40" : "bg-slate-800/40 hover:bg-slate-700/40"
                        )}
                        onMouseEnter={() => setHoveredBar(i)}
                      >
                        {hasMultiple && (
                          <span className="absolute -top-1.5 -right-1 text-[8px] font-bold text-amber-300 bg-amber-500/25 border border-amber-500/40 px-1 py-0 rounded-full">
                            x{sessions.length}
                          </span>
                        )}
                        <p className={cn("text-xs font-bold uppercase", d.dayOfWeek === todayDow ? "text-primary-600" : "text-slate-400")}>{d.day}</p>
                        <p className={cn("text-base sm:text-lg font-black tabular-nums mt-1", d.max > 0 ? "text-white" : "text-slate-600")}>
                          {d.max > 0 ? d.max : '—'}
                        </p>
                        {hasMultiple ? (
                          <div className="flex items-center justify-center gap-1 mt-0.5">
                            {sessions.map((s, j) => (
                              <div key={j} className="w-2 h-2 rounded-full" style={{ backgroundColor: typeColors[s.type] || '#6366f1' }} />
                            ))}
                          </div>
                        ) : (
                          <p className={cn("text-3xs sm:text-xs mt-0.5 font-medium", d.max > 0 ? "text-slate-400" : "text-slate-600")}>
                            {d.max > 0 ? typeLabels[d.type] || d.type : 'Rest'}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
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
      </section>



      {/* ═══ RECENT ACTIVITIES (Strava feed style) ═══ */}
      {!isCoach && recentActivities.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white">{t('recentActivities')}</h2>
            <Link href="/dashboard/activities" className="text-2xs font-semibold text-[#fc5200] hover:text-[#ff7433] inline-flex items-center gap-0.5">
              {t('viewAll')} <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-4">
            {recentActivities.slice(0, 3).map((a) => {
              const km = (a.distance / 1000).toFixed(1);
              const pace = a.average_pace ? formatPace(a.average_pace) : null;
              const dateStr = formatActivityDate(a.start_time);
              const timeStr = formatActivityTime(a.start_time);
              const hrs = Math.floor(a.duration / 3600);
              const mins = Math.round((a.duration % 3600) / 60);
              const secs = Math.round(a.duration % 60);
              const durationStr = hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${mins}:${secs.toString().padStart(2, '0')}`;
              const runType = inferRunTypeFromActivity(a.distance / 1000, a.average_pace);
              const initials = a.athlete_name ? a.athlete_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
              return (
                <div key={a.id} className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden">
                  {/* Strava-style header: avatar + name + date + type badge */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/20">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center">
                        <Route className="h-4 w-4 text-slate-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{a.athlete_name || initials}</span>
                          <span className="text-xs text-slate-500">{dateStr} · {timeStr}</span>
                        </div>
                        <p className="text-2xs text-slate-500">
                          {activityLocalHour(a.start_time) < 12 ? 'Morning Run' : activityLocalHour(a.start_time) >= 17 ? 'Evening Run' : 'Afternoon Run'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('text-2xs font-bold px-2.5 py-1 rounded-lg', runType.color, runType.bg)}>
                        {runType.label}
                      </span>
                    </div>
                  </div>

                  {/* Activity name */}
                  <div className="px-5 pt-3 pb-1">
                    <h3 className="text-base font-bold text-white">{a.activity_name || 'Run'}</h3>
                  </div>

                  {/* Stats row — Strava style: Distance, Elev Gain, Time */}
                  <div className="flex items-baseline gap-8 px-5 pb-4 border-b border-slate-700/20">
                    <div>
                      <p className="text-3xs text-slate-500 mb-0.5">{t('distance')}</p>
                      <p className="text-xl font-black text-white tabular-nums">{km} <span className="text-sm font-normal text-slate-500">{tc('km')}</span></p>
                    </div>
                    {a.elevation_gain && a.elevation_gain > 0 ? (
                      <div>
                        <p className="text-3xs text-slate-500 mb-0.5">{t('elevGain')}</p>
                        <p className="text-xl font-black text-white tabular-nums">{Math.round(a.elevation_gain)} <span className="text-sm font-normal text-slate-500">m</span></p>
                      </div>
                    ) : pace ? (
                      <div>
                        <p className="text-3xs text-slate-500 mb-0.5">{t('pace')}</p>
                        <p className="text-xl font-black text-white tabular-nums">{pace} <span className="text-sm font-normal text-slate-500">/{tc('km')}</span></p>
                      </div>
                    ) : null}
                    <div>
                      <p className="text-3xs text-slate-500 mb-0.5">{t('time')}</p>
                      <p className="text-xl font-black text-white tabular-nums">{durationStr}</p>
                    </div>
                  </div>

                  {/* Map — always visible if available */}
                  {a.has_polyline && a.id && (
                    <div className="h-[220px] w-full" id={`map-${a.id}`} ref={(el) => {
                      if (el && !el.dataset.loaded) {
                        el.dataset.loaded = '1';
                        fetchActivityDetails(a.id, a.athlete_id)
                          .then(r => r.ok ? r.json() : null)
                          .then(data => {
                            if (!data?.gpsPoints?.length) return;
                            const initMap = () => {
                              const L = (window as any).L;
                              if (!L) return;
                              const map = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
                              L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
                              const latlngs = data.gpsPoints.map((p: any) => [p.lat, p.lng]);
                              L.polyline(latlngs, { color: '#fc5200', weight: 3, opacity: 0.9 }).addTo(map);
                              L.circleMarker(latlngs[0], { radius: 5, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
                              L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map);
                              map.fitBounds(L.latLngBounds(latlngs), { padding: [20, 20] });
                            };
                            if ((window as any).L) initMap();
                            else {
                              if (!document.getElementById('leaflet-css')) {
                                const link = document.createElement('link');
                                link.id = 'leaflet-css'; link.rel = 'stylesheet';
                                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                                document.head.appendChild(link);
                              }
                              const s = document.createElement('script');
                              s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                              s.onload = initMap;
                              document.head.appendChild(s);
                            }
                          });
                      }
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {selectedSession && (
        <WorkoutDetailModal
          session={selectedSession}
          viewGroup={viewGroup}
          onPickGroup={pickViewGroup}
          onClose={() => setSelectedSession(null)}
        />
      )}

      {/* ═══ ACTIVITY SYNC EDITOR — Strava-style bottom sheet shown once, right
          after a background Garmin/Strava sync detects a genuinely new activity
          (set above in load()). Lets the athlete customize the auto-created
          feed post (caption/audience/photos/hidden stats) before it's out in
          the club feed. ═══ */}
      {syncedActivity && (
        <ActivitySyncEditor
          activity={syncedActivity}
          extraCount={syncedExtraCount}
          onClose={() => { setSyncedActivity(null); setSyncedExtraCount(0); }}
        />
      )}

      {/* ═══ WEATHER FORECAST ═══ */}
      {weather.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-bold text-white">{t('weather7Day')}</h2>
            <span className="text-sm text-slate-400">{t('weatherLocation')}</span>
          </div>
          {/* Mobile: horizontal scroll. Desktop: grid */}
          <div className="flex sm:grid sm:grid-cols-7 gap-2 overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
            {weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              return (
                <div key={i} className={cn(
                  "flex-shrink-0 w-[80px] sm:w-auto text-center py-4 px-2 rounded-2xl transition-all",
                  isToday ? "bg-primary-600/15 ring-1 ring-primary-600/40" : "bg-slate-800/40"
                )}>
                  <p className={cn("text-xs font-bold uppercase", isToday ? "text-primary-600" : "text-slate-400")}>{isToday ? t('today') : day.day}</p>
                  <WeatherIcon code={day.code} className="h-5 w-5 mx-auto mt-2" />
                  <p className={cn("text-lg font-black mt-2 tabular-nums", heatLevel(day.tempMax).color)}>{day.tempMax}°</p>
                  <p className="text-xs text-slate-400 mt-1">{day.humidity}%</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ TRAINING LOAD CURVE ═══ */}
      {weekly?.weeklyVolumes && weekly.weeklyVolumes.length > 1 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm sm:text-base font-bold text-white">{t('trainingLoad')}</h2>
            <Link href="/dashboard/history" className="text-sm font-semibold text-slate-400 hover:text-primary-600 inline-flex items-center gap-1 transition-colors">
              History <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="h-48 sm:h-56 rounded-2xl bg-slate-800/30 border border-slate-700/20 p-4 pt-6">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekly.weeklyVolumes} margin={{ top: 0, right: 4, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4338ff" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4338ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="weekNum" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => `W${v}`} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `${v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '10px', fontSize: '13px', padding: '8px 12px', color: '#f1f5f9' }}
                  labelStyle={{ color: '#fff', fontWeight: 700 }}
                  itemStyle={{ color: '#e2e8f0' }}
                  formatter={(v: any) => [`${v} km`, 'Volume']}
                  labelFormatter={l => `Week ${l}`}
                />
                <Area type="monotone" dataKey="volume" stroke="#4338ff" fill="url(#loadGrad)" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#4338ff', strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* ═══ QUICK LINKS ═══ */}
      <section className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-800/50">
        <Link href="/dashboard/program" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 transition-colors">
          <Dumbbell className="h-4 w-4" /> Program
        </Link>
        <Link href="/dashboard/activities" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
          <Zap className="h-4 w-4" /> Activities
        </Link>
        {isCoach && (
          <Link href="/dashboard/plan/new" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
            <Calendar className="h-4 w-4" /> Weekly Planner
          </Link>
        )}
        {isCoach && (
          <Link href="/dashboard/athletes" className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/40 transition-colors">
            <Users className="h-4 w-4" /> Athletes
          </Link>
        )}
      </section>

    </div>
  );
}

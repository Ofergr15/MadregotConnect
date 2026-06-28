'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar, Users, Layers, ArrowRight, TrendingUp, TrendingDown,
  Target, Activity, Sun, Cloud, CloudRain, Wind, Zap, Flame,
  AlertTriangle, ChevronDown, Droplets, Plus, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, LineChart, Line } from 'recharts';

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

interface WeeklyData {
  dailyDistances: Array<{ day: string; dayOfWeek: number; min: number; max: number; type: string }>;
  weekTotalMin: number;
  weekTotalMax: number;
  weekDelta: number;
  prevWeekTotal: number;
  weeklyVolumes: Array<{ week: string; volume: number; weekNum: number }>;
  longRunProgression: Array<{ week: string; distance: number }>;
  keySessions: Array<{ day: string; dayOfWeek: number; name: string; type: string; totalKm: number; highlight: string }>;
  typeDistribution: Record<string, number>;
}

interface WeatherDay {
  date: string; day: string; tempMin: number; tempMax: number;
  precipitation: number; windSpeed: number; humidity: number; code: number;
}

const typeColors: Record<string, string> = {
  intervals: '#ef4444', long_run: '#a855f7', tempo: '#f97316',
  fartlek: '#ec4899', progressive: '#14b8a6', easy: '#22c55e', rest: '#334155',
};

const typeLabels: Record<string, string> = {
  intervals: 'Intervals', long_run: 'Long Run', tempo: 'Tempo',
  fartlek: 'Fartlek', progressive: 'Progressive', easy: 'Easy', rest: 'Rest',
};

function WeatherIcon({ code, className = "h-5 w-5" }: { code: number; className?: string }) {
  if (code <= 1) return <Sun className={cn(className, "text-amber-400")} />;
  if (code <= 3) return <Cloud className={cn(className, "text-slate-400")} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className={cn(className, "text-blue-400")} />;
  return <Cloud className={cn(className, "text-slate-400")} />;
}

function heatEmoji(temp: number): string {
  if (temp >= 30) return '🥵';
  if (temp >= 26) return '🌡️';
  if (temp >= 20) return '👌';
  return '❄️';
}

function heatColor(temp: number): string {
  if (temp >= 30) return 'text-red-400';
  if (temp >= 26) return 'text-orange-400';
  if (temp >= 20) return 'text-green-400';
  return 'text-cyan-400';
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  const [weather, setWeather] = useState<WeatherDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0 });
  const [week, setWeek] = useState(0);
  const [showCharts, setShowCharts] = useState(false);

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
      try {
        const [s, w] = await Promise.all([
          fetch('/api/dashboard/stats').then(r => r.json()),
          fetch('/api/dashboard/weekly').then(r => r.json()),
        ]);
        setStats(s);
        setWeekly(w);

        const wr = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&hourly=temperature_2m,relativehumidity_2m,precipitation,windspeed_10m,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
        ).then(r => r.json());

        if (wr.hourly) {
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
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" />
    </div>
  );

  const todayDow = new Date().getDay();
  const hasData = weekly && weekly.weekTotalMax > 0;
  const deltaColor = !weekly?.weekDelta ? '' :
    Math.abs(weekly.weekDelta) <= 10 ? 'text-green-400' :
    Math.abs(weekly.weekDelta) <= 15 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-5 pb-8">

      {/* ═══ HERO: RACE COUNTDOWN ═══ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-900 via-primary-800 to-primary-900 p-6 sm:p-8">
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-primary-300 text-xs font-bold uppercase tracking-[0.2em] mb-3">
                🏃 Valencia Marathon &middot; Dec 6, 2026
              </p>
              <div className="flex items-end gap-2">
                <div className="flex items-baseline">
                  <span className="text-6xl sm:text-7xl font-black text-white leading-none tabular-nums">{countdown.d}</span>
                  <span className="text-lg text-primary-300 ml-1 mr-4">days</span>
                </div>
                <div className="flex items-baseline gap-0.5 mb-1">
                  <span className="text-3xl sm:text-4xl font-bold text-primary-100 tabular-nums">{String(countdown.h).padStart(2, '0')}</span>
                  <span className="text-xl text-primary-500 mx-0.5">:</span>
                  <span className="text-3xl sm:text-4xl font-bold text-primary-100 tabular-nums">{String(countdown.m).padStart(2, '0')}</span>
                  <span className="text-xl text-primary-500 mx-0.5">:</span>
                  <span className="text-3xl sm:text-4xl font-bold text-primary-300 tabular-nums">{String(countdown.s).padStart(2, '0')}</span>
                </div>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-primary-400 text-xs uppercase tracking-wider mb-1">Training Block</p>
              <p className="text-2xl font-black text-white">
                {week > 0 ? <>Week {week}<span className="text-primary-400 text-lg ml-1">/ {TOTAL_WEEKS}</span></> : 'Pre-season'}
              </p>
              <div className="w-40 h-2 bg-primary-950 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary-400 to-accent-400 rounded-full transition-all" style={{ width: `${Math.max(3, (week / TOTAL_WEEKS) * 100)}%` }} />
              </div>
              <p className="text-[10px] text-primary-500 mt-1">{TOTAL_WEEKS - week} weeks to go</p>
            </div>
          </div>
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary-600/20 via-transparent to-transparent" />
      </div>

      {/* ═══ STATS + VOLUME ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Flame className="h-4 w-4 text-blue-400" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white leading-none">
            {hasData ? `${Math.round(weekly!.weekTotalMin)}–${Math.round(weekly!.weekTotalMax)}` : '—'}
          </p>
          <p className="text-xs text-slate-400 mt-1">km this week</p>
          {weekly?.weekDelta !== 0 && weekly?.weekDelta !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {weekly.weekDelta > 0 ? <TrendingUp className={cn('h-3.5 w-3.5', deltaColor)} /> : <TrendingDown className={cn('h-3.5 w-3.5', deltaColor)} />}
              <span className={cn('text-xs font-semibold', deltaColor)}>{weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}% vs prev</span>
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-green-400" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white leading-none">{stats?.athleteCount || 0}</p>
          <p className="text-xs text-slate-400 mt-1">active athletes</p>
          <p className="text-[11px] text-slate-600 mt-1">{stats?.totalAthletes || 0} total</p>
        </div>

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Layers className="h-4 w-4 text-purple-400" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white leading-none">{stats?.groupCount || 0}</p>
          <p className="text-xs text-slate-400 mt-1">pace groups</p>
        </div>

        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Target className="h-4 w-4 text-orange-400" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-white leading-none">{stats?.deliverySuccessRate || 0}%</p>
          <p className="text-xs text-slate-400 mt-1">delivery success</p>
        </div>
      </div>

      {/* ═══ CHART + WEATHER ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Weekly Plan Chart */}
        <div className="lg:col-span-3 bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white">Weekly Plan</h2>
              <p className="text-xs text-slate-500 mt-0.5">Planned km per training day</p>
            </div>
            {hasData && (
              <div className="flex gap-2">
                {Object.entries(weekly!.typeDistribution || {}).slice(0, 4).map(([type]) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: typeColors[type] }} />
                    <span className="text-[10px] text-slate-500">{typeLabels[type] || type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {hasData ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly!.dailyDistances} margin={{ top: 8, right: 4, bottom: 4, left: -10 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 500 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={35} tickFormatter={v => `${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', fontSize: '13px', padding: '10px 14px', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
                    labelStyle={{ fontWeight: 700, marginBottom: 4 }}
                    formatter={(v: any) => [`${v} km`, 'Distance']}
                    cursor={{ fill: 'rgba(99, 102, 241, 0.04)' }}
                  />
                  <Bar dataKey="max" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {weekly!.dailyDistances.map((e, i) => (
                      <Cell key={i} fill={typeColors[e.type] || '#6366f1'} fillOpacity={e.max > 0 ? 0.85 : 0.15} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-56 flex flex-col items-center justify-center">
              <Calendar className="h-12 w-12 text-slate-700 mb-3" />
              <p className="text-sm text-slate-500 font-medium">No plan data yet</p>
              <Link href="/dashboard/plan/new" className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary-400 hover:text-primary-300 font-medium">
                <Plus className="h-3.5 w-3.5" /> Upload a plan
              </Link>
            </div>
          )}
        </div>

        {/* Morning Weather */}
        <div className="lg:col-span-2 bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-white">Morning Weather</h2>
            <span className="text-[11px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded-md">5–8 AM TLV</span>
          </div>
          <div className="space-y-1">
            {weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              return (
                <div key={i} className={cn(
                  "flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all",
                  isToday ? "bg-primary-500/8 ring-1 ring-primary-500/20" : "hover:bg-slate-700/30"
                )}>
                  <WeatherIcon code={day.code} className="h-5 w-5 shrink-0" />
                  <span className={cn("text-sm w-12 shrink-0", isToday ? "font-bold text-white" : "text-slate-400")}>
                    {isToday ? 'Today' : day.day}
                  </span>
                  <span className={cn("text-sm font-semibold tabular-nums shrink-0", heatColor(day.tempMax))}>
                    {day.tempMin}–{day.tempMax}°
                  </span>
                  <div className="flex items-center gap-1 text-slate-500 shrink-0">
                    <Droplets className="h-3 w-3" />
                    <span className="text-[11px]">{day.humidity}%</span>
                  </div>
                  <span className="text-sm ml-auto">{heatEmoji(day.tempMax)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ KEY SESSIONS + QUICK ACTIONS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Key Sessions */}
        <div className="lg:col-span-3 bg-slate-800 rounded-xl p-5 border border-slate-700/80">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Zap className="h-4 w-4 text-amber-400" />
              </div>
              <h2 className="text-base font-bold text-white">Key Sessions</h2>
            </div>
            {weekly?.keySessions && weekly.keySessions.length > 0 && (
              <span className="text-xs text-slate-500">{weekly.keySessions.length} quality days</span>
            )}
          </div>
          {weekly?.keySessions && weekly.keySessions.length > 0 ? (
            <div className="space-y-2">
              {weekly.keySessions.map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-750 border border-slate-700/50 hover:border-slate-600/80 transition-colors">
                  <div className="w-1 h-10 rounded-full shrink-0" style={{ background: typeColors[s.type] || '#6366f1' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{s.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{s.day} &middot; {s.totalKm} km</p>
                  </div>
                  {s.highlight && (
                    <code className="text-xs font-semibold text-primary-300 bg-primary-500/10 px-2.5 py-1 rounded-md">{s.highlight}</code>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Calendar className="h-10 w-10 text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No plan loaded for this week</p>
              <Link href="/dashboard/plan/new" className="mt-2 text-sm text-primary-400 hover:text-primary-300 inline-flex items-center gap-1">
                Create plan <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>

        {/* Quick Actions + Activity */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
            <h2 className="text-base font-bold text-white mb-3">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/plan/new" className="flex flex-col items-center gap-2 p-4 rounded-xl bg-primary-500/5 border border-primary-500/10 hover:bg-primary-500/10 hover:border-primary-500/20 transition-all">
                <Calendar className="h-5 w-5 text-primary-400" />
                <span className="text-xs font-medium text-primary-300">New Plan</span>
              </Link>
              <Link href="/dashboard/athletes" className="flex flex-col items-center gap-2 p-4 rounded-xl bg-green-500/5 border border-green-500/10 hover:bg-green-500/10 hover:border-green-500/20 transition-all">
                <Users className="h-5 w-5 text-green-400" />
                <span className="text-xs font-medium text-green-300">Athletes</span>
              </Link>
              <Link href="/dashboard/groups" className="flex flex-col items-center gap-2 p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 hover:bg-purple-500/10 hover:border-purple-500/20 transition-all">
                <Layers className="h-5 w-5 text-purple-400" />
                <span className="text-xs font-medium text-purple-300">Groups</span>
              </Link>
              <Link href="/dashboard/history" className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 hover:bg-orange-500/10 hover:border-orange-500/20 transition-all">
                <Clock className="h-5 w-5 text-orange-400" />
                <span className="text-xs font-medium text-orange-300">History</span>
              </Link>
            </div>
          </div>

          {/* Recent Activity */}
          {stats?.recentActivity && stats.recentActivity.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
              <h2 className="text-sm font-bold text-white mb-3">Recent</h2>
              <div className="space-y-2">
                {stats.recentActivity.slice(0, 3).map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
                    <p className="text-xs text-slate-400 truncate flex-1">{a.description}</p>
                    <span className="text-[10px] text-slate-600 shrink-0">
                      {new Date(a.timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ PROGRESSION (expandable) ═══ */}
      <button
        onClick={() => setShowCharts(!showCharts)}
        className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-all border border-slate-700/50"
      >
        {showCharts ? 'Hide' : 'Show'} Training Progression
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showCharts && "rotate-180")} />
      </button>

      {showCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in duration-300">
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
            <h3 className="text-sm font-bold text-white mb-4">Weekly Volume Trend</h3>
            {weekly?.weeklyVolumes?.length ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weekly.weeklyVolumes} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <XAxis dataKey="weekNum" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px' }} formatter={(v: any) => [`${v} km`]} labelFormatter={l => `Week ${l}`} />
                    <defs><linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
                    <Area type="monotone" dataKey="volume" stroke="#6366f1" fill="url(#volGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs text-slate-500 text-center py-12">No history yet</p>}
          </div>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700/80">
            <h3 className="text-sm font-bold text-white mb-4">Long Run Peak</h3>
            {weekly?.longRunProgression?.length ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekly.longRunProgression} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${new Date(v).getDate()}/${new Date(v).getMonth() + 1}`} />
                    <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', fontSize: '11px' }} formatter={(v: any) => [`${v} km`]} />
                    <Line type="monotone" dataKey="distance" stroke="#a855f7" strokeWidth={2} dot={{ fill: '#a855f7', r: 3, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs text-slate-500 text-center py-12">No history yet</p>}
          </div>
        </div>
      )}
    </div>
  );
}

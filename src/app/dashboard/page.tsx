'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar, Users, Layers, ArrowRight, TrendingUp, TrendingDown,
  Target, Activity, Sun, Cloud, CloudRain, Wind, Zap, Flame,
  AlertTriangle, ChevronDown, Droplets,
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

function WeatherIcon({ code, className = "h-4 w-4" }: { code: number; className?: string }) {
  if (code <= 1) return <Sun className={cn(className, "text-amber-400")} />;
  if (code <= 3) return <Cloud className={cn(className, "text-slate-400")} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className={cn(className, "text-blue-400")} />;
  return <Cloud className={cn(className, "text-slate-400")} />;
}

function heatInfo(temp: number): { label: string; color: string } {
  if (temp >= 30) return { label: '🥵', color: 'text-red-400' };
  if (temp >= 26) return { label: '🌡️', color: 'text-orange-400' };
  if (temp >= 20) return { label: '👌', color: 'text-green-400' };
  return { label: '❄️', color: 'text-cyan-400' };
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

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" /></div>;

  const todayDow = new Date().getDay();
  const deltaColor = !weekly?.weekDelta ? '' :
    Math.abs(weekly.weekDelta) <= 10 ? 'text-green-400' :
    Math.abs(weekly.weekDelta) <= 15 ? 'text-yellow-400' : 'text-red-400';
  const hasData = weekly && weekly.weekTotalMax > 0;

  return (
    <div className="space-y-4 pb-6 max-w-6xl mx-auto">

      {/* === COUNTDOWN === */}
      <div className="bg-gradient-to-r from-primary-900/80 to-primary-800/40 rounded-lg p-5 border border-primary-700/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-primary-300 mb-1">🏃 Valencia Marathon</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-5xl font-black tabular-nums text-white">{countdown.d}</span>
              <span className="text-xs text-primary-300/60 mr-2">days</span>
              <span className="text-2xl font-bold text-primary-200 tabular-nums">{String(countdown.h).padStart(2, '0')}</span>
              <span className="text-primary-500">:</span>
              <span className="text-2xl font-bold text-primary-200 tabular-nums">{String(countdown.m).padStart(2, '0')}</span>
              <span className="text-primary-500">:</span>
              <span className="text-2xl font-bold text-primary-400 tabular-nums">{String(countdown.s).padStart(2, '0')}</span>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-primary-400 uppercase tracking-wider">Dec 6, 2026</p>
            <p className="text-lg font-bold text-white mt-0.5">{week > 0 ? `Week ${week}` : 'Pre-season'}<span className="text-sm text-primary-400">/{TOTAL_WEEKS}</span></p>
            <div className="w-28 h-1 bg-primary-900 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary-400 rounded-full" style={{ width: `${Math.max(3, (week / TOTAL_WEEKS) * 100)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* === STATS ROW === */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide mb-1">Volume</p>
          <p className="text-lg font-black">{hasData ? `${Math.round(weekly!.weekTotalMin)}-${Math.round(weekly!.weekTotalMax)}` : '—'}<span className="text-[10px] text-slate-500 ml-0.5">km</span></p>
          {weekly?.weekDelta !== undefined && weekly.weekDelta !== 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              {weekly.weekDelta > 0 ? <TrendingUp className={cn('h-2.5 w-2.5', deltaColor)} /> : <TrendingDown className={cn('h-2.5 w-2.5', deltaColor)} />}
              <span className={cn('text-[10px]', deltaColor)}>{weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}%</span>
            </div>
          )}
        </div>
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide mb-1">Athletes</p>
          <p className="text-lg font-black">{stats?.athleteCount || 0}</p>
          <p className="text-[10px] text-slate-600">{stats?.totalAthletes} total</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide mb-1">Groups</p>
          <p className="text-lg font-black">{stats?.groupCount || 0}</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wide mb-1">Pushed</p>
          <p className="text-lg font-black">{stats?.deliverySuccessRate || 0}%</p>
        </div>
      </div>

      {/* === CHART + WEATHER === */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Bar chart */}
        <div className="lg:col-span-3 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-semibold">This Week&apos;s Plan</h3>
            <span className="text-[10px] text-slate-500">km</span>
          </div>
          {hasData ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly!.dailyDistances} margin={{ top: 8, right: 0, bottom: 0, left: -20 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '11px' }}
                    formatter={(v: any) => [`${v} km`]}
                    cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  />
                  <Bar dataKey="max" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {weekly!.dailyDistances.map((e, i) => (
                      <Cell key={i} fill={typeColors[e.type] || '#3b82f6'} fillOpacity={0.75} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-slate-500">No plan data yet</p>
                <Link href="/dashboard/plan/new" className="text-xs text-primary-400 mt-1 inline-block">Upload a plan &rarr;</Link>
              </div>
            </div>
          )}
        </div>

        {/* Weather */}
        <div className="lg:col-span-2 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold">Morning Weather</h3>
            <span className="text-[10px] text-slate-500">5-8am</span>
          </div>
          <div className="space-y-0.5">
            {weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              const heat = heatInfo(day.tempMax);
              return (
                <div key={i} className={cn(
                  "grid grid-cols-[auto_2.5rem_3.5rem_2rem_1.5rem_1.5rem] items-center gap-1 py-1.5 px-2 rounded",
                  isToday && "bg-slate-700/50"
                )}>
                  <div className="flex items-center gap-1.5">
                    <WeatherIcon code={day.code} className="h-3.5 w-3.5" />
                    <span className={cn("text-[12px]", isToday ? "font-bold text-white" : "text-slate-400")}>
                      {isToday ? 'Today' : day.day}
                    </span>
                  </div>
                  <span className={cn("text-[11px] font-medium tabular-nums", heat.color)}>{day.tempMin}-{day.tempMax}°</span>
                  <span className="text-[10px] text-slate-500 flex items-center gap-0.5"><Droplets className="h-2.5 w-2.5" />{day.humidity}%</span>
                  <span className="text-[11px]">{heat.label}</span>
                  {day.precipitation > 0 ? <span className="text-[9px] text-blue-400">{day.precipitation}</span> : <span />}
                  {day.windSpeed > 20 ? <Wind className="h-3 w-3 text-cyan-400" /> : <span />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* === KEY SESSIONS + ACTIONS === */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-amber-400" />
            <h3 className="text-[13px] font-semibold">Key Sessions</h3>
          </div>
          {weekly?.keySessions && weekly.keySessions.length > 0 ? (
            <div className="space-y-1.5">
              {weekly.keySessions.map((s, i) => (
                <div key={i} className="flex items-center gap-2 py-2 px-2 rounded bg-slate-750/50">
                  <div className="w-0.5 h-7 rounded-full" style={{ background: typeColors[s.type] || '#3b82f6' }} />
                  <div className="flex-1">
                    <span className="text-[13px] font-medium text-white">{s.name}</span>
                    <span className="text-[11px] text-slate-500 ml-2">{s.day} &middot; {s.totalKm}km</span>
                  </div>
                  {s.highlight && <code className="text-[11px] text-primary-400 bg-slate-900/50 px-1.5 py-0.5 rounded">{s.highlight}</code>}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">No plan loaded</p>
              <Link href="/dashboard/plan/new" className="text-xs text-primary-400 mt-1 inline-block">Create plan &rarr;</Link>
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 className="text-[13px] font-semibold mb-3">Quick Actions</h3>
          <nav className="space-y-1">
            {[
              { href: '/dashboard/plan/new', icon: Calendar, label: 'New Plan', color: 'text-blue-400' },
              { href: '/dashboard/athletes', icon: Users, label: 'Athletes', color: 'text-green-400' },
              { href: '/dashboard/groups', icon: Layers, label: 'Groups', color: 'text-purple-400' },
              { href: '/dashboard/history', icon: Activity, label: 'History', color: 'text-orange-400' },
            ].map(({ href, icon: Icon, label, color }) => (
              <Link key={href} href={href} className="flex items-center gap-2.5 py-2 px-2 rounded hover:bg-slate-700/50 transition-colors group">
                <Icon className={cn("h-4 w-4", color)} />
                <span className="text-[13px] text-slate-300 group-hover:text-white">{label}</span>
                <ArrowRight className="h-3 w-3 text-slate-600 ml-auto" />
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* === EXPANDABLE CHARTS === */}
      <button onClick={() => setShowCharts(!showCharts)} className="flex items-center gap-1.5 mx-auto text-[12px] text-slate-500 hover:text-slate-300 transition-colors">
        {showCharts ? 'Hide' : 'Show'} progression charts
        <ChevronDown className={cn("h-3 w-3 transition-transform", showCharts && "rotate-180")} />
      </button>

      {showCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-[13px] font-semibold mb-3">Weekly Volume</h3>
            {weekly?.weeklyVolumes?.length ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weekly.weeklyVolumes} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <XAxis dataKey="weekNum" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} width={25} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '10px' }} formatter={(v: any) => [`${v} km`]} />
                    <Area type="monotone" dataKey="volume" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs text-slate-500 text-center py-8">No history yet</p>}
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-[13px] font-semibold mb-3">Long Run Peak</h3>
            {weekly?.longRunProgression?.length ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weekly.longRunProgression} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${new Date(v).getDate()}/${new Date(v).getMonth() + 1}`} />
                    <YAxis tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} width={25} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '10px' }} formatter={(v: any) => [`${v} km`]} />
                    <Line type="monotone" dataKey="distance" stroke="#a855f7" strokeWidth={1.5} dot={{ fill: '#a855f7', r: 2, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-xs text-slate-500 text-center py-8">No history yet</p>}
          </div>
        </div>
      )}
    </div>
  );
}

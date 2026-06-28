'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Users,
  Layers,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  Sun,
  Cloud,
  CloudRain,
  Wind,
  Zap,
  MapPin,
  Flame,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, Cell,
} from 'recharts';

const RACE_DATE = new Date('2026-12-06T09:00:00');
const TRAINING_BLOCK_START = new Date('2026-08-09T00:00:00');

interface DashboardStats {
  athleteCount: number;
  totalAthletes: number;
  groupCount: number;
  planCount: number;
  deliverySuccessRate: number;
  recentPlans: Array<{ id: string; week_start_date: string; status: string; created_at: string }>;
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
  currentWeekStart: string;
}

interface WeatherDay {
  date: string;
  day: string;
  tempMin: number;
  tempMax: number;
  precipitation: number;
  windSpeed: number;
  humidity: number;
  code: number;
}

const workoutTypeColors: Record<string, string> = {
  intervals: '#ef4444',
  long_run: '#8b5cf6',
  tempo: '#f97316',
  fartlek: '#ec4899',
  progressive: '#14b8a6',
  easy: '#22c55e',
  rest: '#475569',
};

function getWeatherIcon(code: number, className = "h-4 w-4") {
  if (code === 0 || code === 1) return <Sun className={cn(className, "text-yellow-400")} />;
  if (code <= 3) return <Cloud className={cn(className, "text-slate-400")} />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className={cn(className, "text-blue-400")} />;
  return <Cloud className={cn(className, "text-slate-400")} />;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [weather, setWeather] = useState<WeatherDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [trainingWeek, setTrainingWeek] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const totalTrainingWeeks = 17;

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const diff = RACE_DATE.getTime() - now.getTime();
      if (diff <= 0) { setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 }); return; }
      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
      });
      const weeksSinceStart = Math.floor((now.getTime() - TRAINING_BLOCK_START.getTime()) / (7 * 24 * 60 * 60 * 1000));
      setTrainingWeek(Math.max(0, Math.min(weeksSinceStart + 1, totalTrainingWeeks)));
    }
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [statsRes, weeklyRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/weekly'),
        ]);
        const [statsData, weeklyDataRes] = await Promise.all([statsRes.json(), weeklyRes.json()]);
        setStats(statsData);
        setWeeklyData(weeklyDataRes);

        try {
          const weatherRes = await fetch(
            'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&hourly=temperature_2m,relativehumidity_2m,precipitation,windspeed_10m,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
          );
          const weatherData = await weatherRes.json();
          if (weatherData.hourly) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayMap: Record<string, { temps: number[]; humidity: number[]; precip: number[]; wind: number[]; codes: number[] }> = {};
            weatherData.hourly.time.forEach((time: string, i: number) => {
              const hour = new Date(time).getHours();
              if (hour >= 5 && hour <= 8) {
                const dateKey = time.split('T')[0];
                if (!dayMap[dateKey]) dayMap[dateKey] = { temps: [], humidity: [], precip: [], wind: [], codes: [] };
                dayMap[dateKey].temps.push(weatherData.hourly.temperature_2m[i]);
                dayMap[dateKey].humidity.push(weatherData.hourly.relativehumidity_2m?.[i] ?? 0);
                dayMap[dateKey].precip.push(weatherData.hourly.precipitation[i]);
                dayMap[dateKey].wind.push(weatherData.hourly.windspeed_10m[i]);
                dayMap[dateKey].codes.push(weatherData.hourly.weathercode[i]);
              }
            });
            const days: WeatherDay[] = Object.entries(dayMap).map(([date, data]) => ({
              date,
              day: dayNames[new Date(date).getDay()],
              tempMin: Math.round(Math.min(...data.temps)),
              tempMax: Math.round(Math.max(...data.temps)),
              humidity: Math.round(data.humidity.reduce((a, b) => a + b, 0) / data.humidity.length),
              precipitation: Math.round(data.precip.reduce((a, b) => a + b, 0) * 10) / 10,
              windSpeed: Math.round(Math.max(...data.wind)),
              code: data.codes.sort((a, b) => b - a)[0],
            }));
            setWeather(days);
          }
        } catch {}
      } catch (error) {
        console.error('Dashboard fetch error:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const deltaColor = !weeklyData?.weekDelta ? 'text-slate-400' :
    Math.abs(weeklyData.weekDelta) <= 10 ? 'text-green-400' :
    Math.abs(weeklyData.weekDelta) <= 15 ? 'text-yellow-400' : 'text-red-400';

  const todayDow = new Date().getDay();

  return (
    <div className="space-y-4 pb-6">
      {/* Row 1: Compact countdown + inline stats */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Countdown */}
        <div className="md:col-span-5 relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-800 to-orange-950/20 p-4 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="h-4 w-4 text-orange-400" />
            <span className="text-xs font-semibold text-orange-400">Valencia 2026</span>
            <span className="text-[10px] text-slate-500 ml-auto">Dec 6</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black text-white tabular-nums">{countdown.days}</span>
            <span className="text-xs text-slate-500">days</span>
            <span className="text-xl font-bold text-slate-300 tabular-nums">{countdown.hours}h</span>
            <span className="text-xl font-bold text-slate-400 tabular-nums">{countdown.minutes}m</span>
            <span className="text-xl font-bold text-slate-500 tabular-nums animate-pulse">{countdown.seconds.toString().padStart(2, '0')}s</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full" style={{ width: `${Math.max(2, (trainingWeek / totalTrainingWeeks) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-slate-400 shrink-0">
              {trainingWeek > 0 ? `Wk ${trainingWeek}/${totalTrainingWeeks}` : 'Pre-season'}
            </span>
          </div>
        </div>

        {/* Volume card */}
        <div className="md:col-span-3 rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame className="h-3.5 w-3.5 text-primary-400" />
            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Week Volume</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {weeklyData && weeklyData.weekTotalMax > 0 ? `${Math.round(weeklyData.weekTotalMin)}-${Math.round(weeklyData.weekTotalMax)}` : '—'}
            <span className="text-xs text-slate-500 ml-1">km</span>
          </p>
          {weeklyData?.weekDelta !== undefined && weeklyData.weekDelta !== 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              {weeklyData.weekDelta > 0 ? <TrendingUp className={cn('h-3 w-3', deltaColor)} /> : <TrendingDown className={cn('h-3 w-3', deltaColor)} />}
              <span className={cn('text-[11px] font-medium', deltaColor)}>{weeklyData.weekDelta > 0 ? '+' : ''}{weeklyData.weekDelta}%</span>
              {Math.abs(weeklyData.weekDelta) > 15 && <AlertTriangle className="h-3 w-3 text-red-400" />}
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="md:col-span-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-800/80 p-3 border border-slate-700/50 text-center">
            <Users className="h-4 w-4 text-green-400 mx-auto mb-1" />
            <p className="text-lg font-bold">{stats?.athleteCount || 0}</p>
            <p className="text-[9px] text-slate-500">Athletes</p>
          </div>
          <div className="rounded-xl bg-slate-800/80 p-3 border border-slate-700/50 text-center">
            <Layers className="h-4 w-4 text-purple-400 mx-auto mb-1" />
            <p className="text-lg font-bold">{stats?.groupCount || 0}</p>
            <p className="text-[9px] text-slate-500">Groups</p>
          </div>
          <div className="rounded-xl bg-slate-800/80 p-3 border border-slate-700/50 text-center">
            <Target className="h-4 w-4 text-orange-400 mx-auto mb-1" />
            <p className="text-lg font-bold">{stats?.deliverySuccessRate || 0}%</p>
            <p className="text-[9px] text-slate-500">Push</p>
          </div>
        </div>
      </div>

      {/* Row 2: Bar Chart + Weather (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Daily km chart */}
        <div className="lg:col-span-7 rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Daily Plan</h3>
            <span className="text-[10px] text-slate-500">km / day</span>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData?.dailyDistances || []} margin={{ top: 5, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={35} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 600 }}
                  formatter={(value: any, name: any) => [`${value} km`, name === 'max' ? 'Max' : 'Min']}
                  cursor={{ fill: 'rgba(59, 130, 246, 0.04)' }}
                />
                <Bar dataKey="max" radius={[5, 5, 0, 0]} maxBarSize={36}>
                  {(weeklyData?.dailyDistances || []).map((entry, index) => (
                    <Cell key={index} fill={workoutTypeColors[entry.type] || '#3b82f6'} fillOpacity={0.8} />
                  ))}
                </Bar>
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weather */}
        <div className="lg:col-span-5 rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Sun className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Training Weather</h3>
            <span className="text-[10px] text-slate-500 ml-auto">05:00-08:00 TLV</span>
          </div>
          <div className="space-y-0.5">
            {weather.length > 0 ? weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              const heatLevel = day.tempMax >= 30 ? 'Hot' : day.tempMax >= 26 ? 'Warm' : day.tempMax >= 20 ? 'Nice' : 'Cool';
              const heatColor = day.tempMax >= 30 ? 'text-red-400' : day.tempMax >= 26 ? 'text-orange-400' : day.tempMax >= 20 ? 'text-green-400' : 'text-cyan-400';
              return (
                <div key={i} className={cn(
                  "flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors",
                  isToday ? "bg-primary-500/10 ring-1 ring-primary-500/20" : "hover:bg-slate-700/20"
                )}>
                  {getWeatherIcon(day.code, "h-4 w-4 shrink-0")}
                  <span className={cn("text-[12px] w-10 shrink-0", isToday ? "text-white font-semibold" : "text-slate-400")}>
                    {isToday ? 'Today' : day.day}
                  </span>
                  <span className={cn("text-[11px] font-medium w-12 shrink-0 tabular-nums", heatColor)}>
                    {day.tempMin}-{day.tempMax}°
                  </span>
                  <span className="text-[10px] text-slate-500 w-10 shrink-0">{day.humidity}%</span>
                  <span className={cn("text-[10px] font-medium ml-auto shrink-0", heatColor)}>{heatLevel}</span>
                  {day.precipitation > 0 && <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1 rounded shrink-0">{day.precipitation}mm</span>}
                  {day.windSpeed > 20 && <Wind className="h-3 w-3 text-cyan-400 shrink-0" />}
                </div>
              );
            }) : <p className="text-xs text-slate-500 text-center py-6">Loading...</p>}
          </div>
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-700/50">
            <span className="text-[9px] text-slate-500">Legend:</span>
            <span className="text-[9px] text-cyan-400">Cool &lt;20°</span>
            <span className="text-[9px] text-green-400">Nice 20-25°</span>
            <span className="text-[9px] text-orange-400">Warm 26-29°</span>
            <span className="text-[9px] text-red-400">Hot 30°+</span>
          </div>
        </div>
      </div>

      {/* Row 3: Key Sessions + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Key Sessions */}
        <div className="lg:col-span-8 rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Key Sessions</h3>
          </div>
          {weeklyData?.keySessions && weeklyData.keySessions.length > 0 ? (
            <div className="space-y-2">
              {weeklyData.keySessions.map((session, i) => (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-700/25 border border-slate-700/40">
                  <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: workoutTypeColors[session.type] || '#64748b' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white">{session.name}</p>
                    <p className="text-[11px] text-slate-500">{session.day} &middot; {session.totalKm} km</p>
                  </div>
                  {session.highlight && (
                    <span className="text-[11px] font-mono text-primary-300 bg-slate-900/50 px-2 py-0.5 rounded border border-slate-700/50">{session.highlight}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-slate-500 mb-1">No plan for this week</p>
              <Link href="/dashboard/plan/new" className="text-xs text-primary-400 hover:text-primary-300">Create plan &rarr;</Link>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-4 rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-white mb-3">Actions</h3>
          <div className="space-y-1.5">
            <Link href="/dashboard/plan/new" className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
              <Calendar className="h-4 w-4 text-primary-400" />
              <span className="text-[13px] text-slate-300 group-hover:text-white">New Plan</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
            <Link href="/dashboard/athletes" className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
              <Users className="h-4 w-4 text-green-400" />
              <span className="text-[13px] text-slate-300 group-hover:text-white">Athletes</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
            <Link href="/dashboard/groups" className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
              <Layers className="h-4 w-4 text-purple-400" />
              <span className="text-[13px] text-slate-300 group-hover:text-white">Groups</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
            <Link href="/dashboard/history" className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-700/40 transition-colors group">
              <Activity className="h-4 w-4 text-orange-400" />
              <span className="text-[13px] text-slate-300 group-hover:text-white">History</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
          </div>
        </div>
      </div>

      {/* Expandable: Training Progression */}
      <div>
        <button
          onClick={() => setShowMore(!showMore)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors mx-auto"
        >
          <span>{showMore ? 'Less' : 'Training Progression'}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMore && "rotate-180")} />
        </button>

        {showMore && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            {/* Training Load */}
            <div className="rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
              <h3 className="text-sm font-semibold text-white mb-3">Weekly Volume</h3>
              {weeklyData?.weeklyVolumes && weeklyData.weeklyVolumes.length > 0 ? (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weeklyData.weeklyVolumes} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                      <XAxis dataKey="weekNum" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(value: any) => [`${value} km`]}
                        labelFormatter={(l) => `Week ${l}`}
                      />
                      <defs>
                        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="volume" stroke="#3b82f6" fill="url(#areaGrad)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-xs text-slate-500 text-center py-10">Builds over time</p>}
            </div>

            {/* Long Run */}
            <div className="rounded-xl bg-slate-800/80 p-4 border border-slate-700/50">
              <h3 className="text-sm font-semibold text-white mb-3">Long Run Peak</h3>
              {weeklyData?.longRunProgression && weeklyData.longRunProgression.length > 0 ? (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyData.longRunProgression} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                        formatter={(value: any) => [`${value} km`]}
                      />
                      <Line type="monotone" dataKey="distance" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-xs text-slate-500 text-center py-10">Builds over time</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

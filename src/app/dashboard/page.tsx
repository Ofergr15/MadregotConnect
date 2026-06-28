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
  UserPlus,
  LayoutGrid,
  Activity,
  CheckCircle2,
  Clock,
  Sun,
  Cloud,
  CloudRain,
  Wind,
  Zap,
  Timer,
  AlertTriangle,
  MapPin,
  Flame,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

// Valencia Marathon: December 6, 2026
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

const workoutTypeLabels: Record<string, string> = {
  intervals: 'Intervals',
  long_run: 'Long Run',
  tempo: 'Tempo',
  fartlek: 'Fartlek',
  progressive: 'Progressive',
  easy: 'Easy',
  rest: 'Rest',
};

const pieColors = ['#ef4444', '#8b5cf6', '#f97316', '#22c55e', '#ec4899', '#14b8a6'];

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
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0 });
  const [trainingWeek, setTrainingWeek] = useState(0);
  const [totalTrainingWeeks] = useState(17);

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const diff = RACE_DATE.getTime() - now.getTime();
      if (diff <= 0) {
        setCountdown({ days: 0, hours: 0, minutes: 0 });
        return;
      }
      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      });

      const weeksSinceStart = Math.floor((now.getTime() - TRAINING_BLOCK_START.getTime()) / (7 * 24 * 60 * 60 * 1000));
      setTrainingWeek(Math.max(0, Math.min(weeksSinceStart + 1, totalTrainingWeeks)));
    }
    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);
    return () => clearInterval(interval);
  }, [totalTrainingWeeks]);

  useEffect(() => {
    async function fetchAll() {
      try {
        const [statsRes, weeklyRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/weekly'),
        ]);
        const [statsData, weeklyDataRes] = await Promise.all([
          statsRes.json(),
          weeklyRes.json(),
        ]);
        setStats(statsData);
        setWeeklyData(weeklyDataRes);

        try {
          const weatherRes = await fetch(
            'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&hourly=temperature_2m,precipitation,windspeed_10m,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
          );
          const weatherData = await weatherRes.json();
          if (weatherData.hourly) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayMap: Record<string, { temps: number[]; precip: number[]; wind: number[]; codes: number[] }> = {};

            weatherData.hourly.time.forEach((time: string, i: number) => {
              const hour = new Date(time).getHours();
              if (hour >= 5 && hour <= 8) {
                const dateKey = time.split('T')[0];
                if (!dayMap[dateKey]) dayMap[dateKey] = { temps: [], precip: [], wind: [], codes: [] };
                dayMap[dateKey].temps.push(weatherData.hourly.temperature_2m[i]);
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
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const deltaColor = !weeklyData?.weekDelta ? 'text-slate-400' :
    Math.abs(weeklyData.weekDelta) <= 10 ? 'text-green-400' :
    Math.abs(weeklyData.weekDelta) <= 15 ? 'text-yellow-400' : 'text-red-400';

  const pieData = weeklyData?.typeDistribution
    ? Object.entries(weeklyData.typeDistribution).map(([name, value]) => ({ name, value }))
    : [];

  const todayDow = new Date().getDay();

  return (
    <div className="space-y-5 pb-8">
      {/* Row 1: Marathon Countdown Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-orange-950/40 p-6 md:p-8 border border-slate-700/50">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="bg-orange-500/20 p-2 rounded-lg">
                <MapPin className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Valencia Marathon 2026</h2>
                <p className="text-xs text-slate-400">December 6, 2026</p>
              </div>
            </div>
            <div className="flex items-baseline gap-4 md:gap-8 mt-4">
              <div className="text-center">
                <span className="text-4xl md:text-5xl font-black text-white tabular-nums">{countdown.days}</span>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mt-1">Days</p>
              </div>
              <span className="text-2xl text-slate-600 font-light">:</span>
              <div className="text-center">
                <span className="text-3xl md:text-4xl font-bold text-slate-200 tabular-nums">{countdown.hours}</span>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mt-1">Hours</p>
              </div>
              <span className="text-2xl text-slate-600 font-light">:</span>
              <div className="text-center">
                <span className="text-3xl md:text-4xl font-bold text-slate-200 tabular-nums">{countdown.minutes}</span>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mt-1">Min</p>
              </div>
            </div>
          </div>

          {/* Training Block Progress */}
          <div className="md:text-right">
            <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Training Block</p>
            <p className="text-3xl font-bold text-white">
              {trainingWeek > 0 ? `Week ${trainingWeek}` : 'Pre-season'}
              {trainingWeek > 0 && <span className="text-base text-slate-500 ml-1">/ {totalTrainingWeeks}</span>}
            </p>
            <div className="w-48 h-2.5 bg-slate-700/80 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-600 to-orange-400 rounded-full transition-all duration-1000"
                style={{ width: `${Math.max(2, (trainingWeek / totalTrainingWeeks) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {totalTrainingWeeks - trainingWeek} weeks remaining
            </p>
          </div>
        </div>
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-primary-500/5 rounded-full blur-3xl" />
      </div>

      {/* Row 2: Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-4 border border-slate-700/50 hover:border-primary-500/50 transition-all">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-primary-500/15 p-1.5 rounded-md">
              <Flame className="h-4 w-4 text-primary-400" />
            </div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">Volume</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {weeklyData ? `${Math.round(weeklyData.weekTotalMin)}-${Math.round(weeklyData.weekTotalMax)}` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">km this week</p>
          {weeklyData?.weekDelta !== undefined && weeklyData.weekDelta !== 0 && (
            <div className="flex items-center gap-1 mt-2">
              {weeklyData.weekDelta > 0 ? (
                <TrendingUp className={cn('h-3 w-3', deltaColor)} />
              ) : (
                <TrendingDown className={cn('h-3 w-3', deltaColor)} />
              )}
              <span className={cn('text-[11px] font-medium', deltaColor)}>
                {weeklyData.weekDelta > 0 ? '+' : ''}{weeklyData.weekDelta}%
              </span>
              {Math.abs(weeklyData.weekDelta) > 15 && <AlertTriangle className="h-3 w-3 text-red-400" />}
            </div>
          )}
        </div>

        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-4 border border-slate-700/50 hover:border-green-500/50 transition-all">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-green-500/15 p-1.5 rounded-md">
              <Users className="h-4 w-4 text-green-400" />
            </div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">Athletes</span>
          </div>
          <p className="text-2xl font-bold text-white">{stats?.athleteCount || 0}</p>
          <p className="text-xs text-slate-500 mt-0.5">{stats?.totalAthletes || 0} total</p>
        </div>

        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-4 border border-slate-700/50 hover:border-purple-500/50 transition-all">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-purple-500/15 p-1.5 rounded-md">
              <Layers className="h-4 w-4 text-purple-400" />
            </div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">Groups</span>
          </div>
          <p className="text-2xl font-bold text-white">{stats?.groupCount || 0}</p>
          <p className="text-xs text-slate-500 mt-0.5">pace profiles</p>
        </div>

        <div className="bg-slate-800/80 backdrop-blur rounded-xl p-4 border border-slate-700/50 hover:border-orange-500/50 transition-all">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-orange-500/15 p-1.5 rounded-md">
              <Target className="h-4 w-4 text-orange-400" />
            </div>
            <span className="text-[11px] text-slate-400 uppercase tracking-wide">Delivery</span>
          </div>
          <p className="text-2xl font-bold text-white">{stats?.deliverySuccessRate || 0}%</p>
          <p className="text-xs text-slate-500 mt-0.5">success rate</p>
        </div>
      </div>

      {/* Row 3: Daily Distance Chart + Weather */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Daily Distance Bar Chart */}
        <div className="lg:col-span-3 rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-white">Weekly Training Plan</h3>
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">km / day</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">Planned distances for each training day</p>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData?.dailyDistances || []} margin={{ top: 10, right: 0, bottom: 0, left: -15 }}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v) => `${v}`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value: any, name: any) => [`${value} km`, name === 'max' ? 'Upper estimate' : 'Lower estimate']}
                  cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                />
                <Bar dataKey="max" fill="url(#barGradient)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weather Forecast */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-4">
            <Sun className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Training Weather</h3>
            <span className="text-[10px] text-slate-500 ml-auto">5-8am TLV</span>
          </div>
          <div className="space-y-1.5">
            {weather.length > 0 ? weather.map((day, i) => {
              const isToday = new Date(day.date).getDay() === todayDow;
              return (
                <div key={i} className={cn(
                  "flex items-center justify-between py-2 px-2.5 rounded-lg transition-colors",
                  isToday ? "bg-slate-700/60 ring-1 ring-primary-500/30" : "hover:bg-slate-700/30"
                )}>
                  <div className="flex items-center gap-2.5">
                    {getWeatherIcon(day.code)}
                    <span className={cn("text-xs w-8", isToday ? "text-white font-semibold" : "text-slate-400")}>
                      {isToday ? 'Today' : day.day}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {day.precipitation > 0 && (
                      <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        {day.precipitation}mm
                      </span>
                    )}
                    {day.windSpeed > 25 && (
                      <Wind className="h-3 w-3 text-cyan-400" />
                    )}
                    <span className="text-xs text-white font-medium tabular-nums w-14 text-right">
                      {day.tempMin}° - {day.tempMax}°
                    </span>
                  </div>
                </div>
              );
            }) : (
              <p className="text-xs text-slate-500 text-center py-8">Loading forecast...</p>
            )}
          </div>
        </div>
      </div>

      {/* Row 4: Key Sessions + Type Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Key Sessions */}
        <div className="lg:col-span-3 rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-yellow-500/15 p-1.5 rounded-md">
              <Zap className="h-4 w-4 text-yellow-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Key Sessions This Week</h3>
          </div>
          {weeklyData?.keySessions && weeklyData.keySessions.length > 0 ? (
            <div className="space-y-2.5">
              {weeklyData.keySessions.map((session, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-700/30 border border-slate-700/50 hover:border-slate-600/50 transition-colors">
                  <div
                    className="w-1 h-10 rounded-full shrink-0"
                    style={{ backgroundColor: workoutTypeColors[session.type] || '#64748b' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{session.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-600/50 text-slate-400">
                        {session.day}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{session.totalKm} km total</p>
                  </div>
                  {session.highlight && (
                    <span className="text-xs font-mono bg-slate-900/60 text-primary-300 px-2.5 py-1 rounded-lg border border-slate-700/50">
                      {session.highlight}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <Calendar className="h-10 w-10 text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No plan loaded for this week</p>
              <Link href="/dashboard/plan/new" className="text-xs text-primary-400 hover:text-primary-300 mt-1 inline-block">
                Create a plan
              </Link>
            </div>
          )}
        </div>

        {/* Type Distribution */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-white mb-4">Volume by Type</h3>
          {pieData.length > 0 ? (
            <>
              <div className="h-36 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={55}
                      dataKey="value"
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={workoutTypeColors[entry.name] || pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '11px' }}
                      formatter={(value: any) => [`${value} km`]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {pieData.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: workoutTypeColors[entry.name] || pieColors[i % pieColors.length] }} />
                    <span className="text-[11px] text-slate-400">{workoutTypeLabels[entry.name] || entry.name}</span>
                    <span className="text-[11px] text-slate-500 ml-auto">{entry.value}km</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center py-10">
              <Activity className="h-8 w-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">No workout data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Training Load + Long Run */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Training Load Curve */}
        <div className="rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Training Load</h3>
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">Weekly km</span>
          </div>
          {weeklyData?.weeklyVolumes && weeklyData.weeklyVolumes.length > 0 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyData.weeklyVolumes} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <XAxis dataKey="weekNum" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={35} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '11px' }}
                    formatter={(value: any) => [`${value} km`, 'Volume']}
                    labelFormatter={(label) => `Week ${label}`}
                  />
                  <defs>
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="volume" stroke="#3b82f6" fill="url(#areaGradient)" strokeWidth={2.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-12">Training history builds over time</p>
          )}
        </div>

        {/* Long Run Progression */}
        <div className="rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Long Run Progression</h3>
            <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-0.5 rounded">Peak km</span>
          </div>
          {weeklyData?.longRunProgression && weeklyData.longRunProgression.length > 0 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData.longRunProgression} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 9, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; }}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={35} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '10px', fontSize: '11px' }}
                    formatter={(value: any) => [`${value} km`, 'Longest Run']}
                    labelFormatter={(label) => `Week of ${label}`}
                  />
                  <Line type="monotone" dataKey="distance" stroke="#8b5cf6" strokeWidth={2.5} dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-12">Long run data builds over time</p>
          )}
        </div>
      </div>

      {/* Row 6: Quick Actions + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Actions */}
        <div className="rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-white mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              href="/dashboard/plan/new"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/40 border border-transparent hover:border-slate-600/50 transition-all group"
            >
              <div className="bg-primary-500/15 p-2 rounded-lg group-hover:bg-primary-500/25 transition-colors">
                <Calendar className="h-4 w-4 text-primary-400" />
              </div>
              <div className="flex-1">
                <span className="text-sm text-white font-medium">New Weekly Plan</span>
                <p className="text-[10px] text-slate-500">Create & push workouts</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
            </Link>
            <Link
              href="/dashboard/athletes"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/40 border border-transparent hover:border-slate-600/50 transition-all group"
            >
              <div className="bg-green-500/15 p-2 rounded-lg group-hover:bg-green-500/25 transition-colors">
                <UserPlus className="h-4 w-4 text-green-400" />
              </div>
              <div className="flex-1">
                <span className="text-sm text-white font-medium">Invite Athlete</span>
                <p className="text-[10px] text-slate-500">Add to your roster</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
            </Link>
            <Link
              href="/dashboard/groups"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/40 border border-transparent hover:border-slate-600/50 transition-all group"
            >
              <div className="bg-purple-500/15 p-2 rounded-lg group-hover:bg-purple-500/25 transition-colors">
                <LayoutGrid className="h-4 w-4 text-purple-400" />
              </div>
              <div className="flex-1">
                <span className="text-sm text-white font-medium">Manage Groups</span>
                <p className="text-[10px] text-slate-500">Pace profiles & levels</p>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 rounded-2xl bg-slate-800/80 backdrop-blur p-5 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-primary-500/15 p-1.5 rounded-md">
              <Activity className="h-4 w-4 text-primary-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
          </div>
          {stats?.recentActivity && stats.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center gap-3 p-3 rounded-xl bg-slate-700/20 hover:bg-slate-700/40 transition-colors">
                  <div className={cn(
                    "p-2 rounded-lg",
                    activity.type === 'plan_pushed' && "bg-primary-500/15",
                    activity.type === 'athlete_joined' && "bg-green-500/15",
                    activity.type === 'athlete_invited' && "bg-yellow-500/15"
                  )}>
                    {activity.type === 'plan_pushed' && <Calendar className="h-3.5 w-3.5 text-primary-400" />}
                    {activity.type === 'athlete_joined' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                    {activity.type === 'athlete_invited' && <Clock className="h-3.5 w-3.5 text-yellow-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300">{activity.description}</p>
                  </div>
                  <p className="text-[10px] text-slate-500 shrink-0">
                    {new Date(activity.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <Activity className="h-8 w-8 text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-500">No recent activity</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

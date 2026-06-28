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

const pieColors = ['#ef4444', '#8b5cf6', '#f97316', '#22c55e', '#ec4899', '#14b8a6'];

function getWeatherIcon(code: number) {
  if (code === 0 || code === 1) return <Sun className="h-5 w-5 text-yellow-400" />;
  if (code <= 3) return <Cloud className="h-5 w-5 text-slate-400" />;
  if (code <= 67 || (code >= 80 && code <= 82)) return <CloudRain className="h-5 w-5 text-blue-400" />;
  return <Cloud className="h-5 w-5 text-slate-400" />;
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

        // Fetch weather (Tel Aviv area)
        try {
          const weatherRes = await fetch(
            'https://api.open-meteo.com/v1/forecast?latitude=32.08&longitude=34.78&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode&timezone=Asia/Jerusalem&forecast_days=7'
          );
          const weatherData = await weatherRes.json();
          if (weatherData.daily) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const days: WeatherDay[] = weatherData.daily.time.map((date: string, i: number) => ({
              date,
              day: dayNames[new Date(date).getDay()],
              tempMin: Math.round(weatherData.daily.temperature_2m_min[i]),
              tempMax: Math.round(weatherData.daily.temperature_2m_max[i]),
              precipitation: weatherData.daily.precipitation_sum[i],
              windSpeed: Math.round(weatherData.daily.windspeed_10m_max[i]),
              code: weatherData.daily.weathercode[i],
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

  const currentAvg = weeklyData ? (weeklyData.weekTotalMin + weeklyData.weekTotalMax) / 2 : 0;
  const deltaColor = !weeklyData?.weekDelta ? 'text-slate-400' :
    Math.abs(weeklyData.weekDelta) <= 10 ? 'text-green-400' :
    Math.abs(weeklyData.weekDelta) <= 15 ? 'text-yellow-400' : 'text-red-400';

  const pieData = weeklyData?.typeDistribution
    ? Object.entries(weeklyData.typeDistribution).map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="space-y-6">
      {/* Row 1: Race Countdown + Training Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Valencia Marathon Countdown */}
        <div className="lg:col-span-2 relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-800 via-slate-800 to-orange-900/30 p-6 border border-slate-700">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-5 w-5 text-orange-400" />
                <span className="text-sm font-medium text-orange-400 uppercase tracking-wide">Valencia Marathon 2025</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">December 7, 2025</p>
              <div className="flex items-baseline gap-6">
                <div>
                  <span className="text-5xl font-bold text-white">{countdown.days}</span>
                  <span className="text-sm text-slate-400 ml-1">days</span>
                </div>
                <div>
                  <span className="text-3xl font-bold text-slate-300">{countdown.hours}</span>
                  <span className="text-sm text-slate-400 ml-1">hrs</span>
                </div>
                <div>
                  <span className="text-3xl font-bold text-slate-300">{countdown.minutes}</span>
                  <span className="text-sm text-slate-400 ml-1">min</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400 mb-1">Training Block</p>
              <p className="text-2xl font-bold text-white">Week {trainingWeek}<span className="text-sm text-slate-400">/{totalTrainingWeeks}</span></p>
              <div className="w-32 h-2 bg-slate-700 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all"
                  style={{ width: `${(trainingWeek / totalTrainingWeeks) * 100}%` }}
                />
              </div>
            </div>
          </div>
          <div className="absolute -bottom-8 -right-8 w-40 h-40 bg-orange-500/5 rounded-full blur-2xl" />
        </div>

        {/* Week Volume + Delta */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700 flex flex-col justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">This Week Volume</p>
            <p className="text-3xl font-bold text-white">
              {weeklyData ? `${Math.round(weeklyData.weekTotalMin)}-${Math.round(weeklyData.weekTotalMax)}` : '0'}
              <span className="text-sm text-slate-400 ml-1">km</span>
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {weeklyData?.weekDelta !== undefined && weeklyData.weekDelta !== 0 ? (
              <>
                {weeklyData.weekDelta > 0 ? (
                  <TrendingUp className={cn('h-4 w-4', deltaColor)} />
                ) : (
                  <TrendingDown className={cn('h-4 w-4', deltaColor)} />
                )}
                <span className={cn('text-sm font-medium', deltaColor)}>
                  {weeklyData.weekDelta > 0 ? '+' : ''}{weeklyData.weekDelta}% vs last week
                </span>
                {Math.abs(weeklyData.weekDelta) > 15 && (
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 ml-1" />
                )}
              </>
            ) : (
              <span className="text-sm text-slate-500">No previous week data</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Prev week: {weeklyData?.prevWeekTotal || 0} km</p>
          </div>
        </div>
      </div>

      {/* Row 2: km/day bar chart + Weather */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Daily Distance Bar Chart */}
        <div className="lg:col-span-2 rounded-xl bg-slate-800 p-6 border border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Daily Planned Distance</h3>
            <span className="text-xs text-slate-400">km per day</span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData?.dailyDistances || []} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit=" km" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: any, name: any) => [`${value} km`, name === 'max' ? 'Max' : 'Min']}
                />
                <Bar dataKey="max" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="min" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weather Forecast */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Sun className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Training Weather</h3>
          </div>
          <div className="space-y-2">
            {weather.length > 0 ? weather.slice(0, 7).map((day, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-700/50 last:border-0">
                <div className="flex items-center gap-2">
                  {getWeatherIcon(day.code)}
                  <span className="text-xs text-slate-300 w-8">{day.day}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-white font-medium">{day.tempMin}-{day.tempMax}°</span>
                  {day.windSpeed > 20 && <Wind className="h-3 w-3 text-cyan-400" />}
                  {day.precipitation > 0 && (
                    <span className="text-[10px] text-blue-400">{day.precipitation}mm</span>
                  )}
                </div>
              </div>
            )) : (
              <p className="text-xs text-slate-500 text-center py-4">Loading weather...</p>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Key Sessions + Workout Type Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Key Sessions */}
        <div className="lg:col-span-2 rounded-xl bg-slate-800 p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Key Sessions This Week</h3>
          </div>
          {weeklyData?.keySessions && weeklyData.keySessions.length > 0 ? (
            <div className="space-y-3">
              {weeklyData.keySessions.map((session, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-700/40">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-2 h-8 rounded-full"
                      style={{ backgroundColor: workoutTypeColors[session.type] || '#64748b' }}
                    />
                    <div>
                      <p className="text-sm font-medium text-white">{session.name}</p>
                      <p className="text-xs text-slate-400">{session.day} &middot; {session.totalKm} km</p>
                    </div>
                  </div>
                  {session.highlight && (
                    <span className="text-xs bg-slate-600/50 text-slate-300 px-2 py-1 rounded">
                      {session.highlight}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-6">No plan loaded for this week</p>
          )}
        </div>

        {/* Type Distribution Pie */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-white mb-4">Volume by Type</h3>
          {pieData.length > 0 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={workoutTypeColors[entry.name] || pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(value: any) => [`${value} km`]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-8">No data</p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-1">
            {pieData.map((entry, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: workoutTypeColors[entry.name] || pieColors[i % pieColors.length] }} />
                <span className="text-[10px] text-slate-400 capitalize">{entry.name.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4: Training Load Curve + Long Run Progression */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Training Load Curve */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-white mb-4">Training Load (Weekly Volume)</h3>
          {weeklyData?.weeklyVolumes && weeklyData.weeklyVolumes.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyData.weeklyVolumes} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                  <XAxis dataKey="weekNum" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} label={{ value: 'Week', position: 'bottom', fontSize: 10, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit=" km" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(value: any) => [`${value} km`, 'Volume']}
                    labelFormatter={(label) => `Week ${label}`}
                  />
                  <Area type="monotone" dataKey="volume" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-8">Build up training history to see the load curve</p>
          )}
        </div>

        {/* Long Run Progression */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-white mb-4">Long Run Progression</h3>
          {weeklyData?.longRunProgression && weeklyData.longRunProgression.length > 0 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData.longRunProgression} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                  <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => { const d = new Date(v); return `${d.getDate()}/${d.getMonth() + 1}`; }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit=" km" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(value: any) => [`${value} km`, 'Longest Run']}
                    labelFormatter={(label) => `Week of ${label}`}
                  />
                  <Line type="monotone" dataKey="distance" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-8">Long run data builds over time</p>
          )}
        </div>
      </div>

      {/* Row 5: Quick Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4 text-primary-400" />
            <span className="text-xs text-slate-400">Athletes</span>
          </div>
          <p className="text-2xl font-bold">{stats?.athleteCount || 0}</p>
          <p className="text-[10px] text-slate-500">{stats?.totalAthletes || 0} total</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-4 w-4 text-purple-400" />
            <span className="text-xs text-slate-400">Groups</span>
          </div>
          <p className="text-2xl font-bold">{stats?.groupCount || 0}</p>
          <p className="text-[10px] text-slate-500">Pace profiles</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-orange-400" />
            <span className="text-xs text-slate-400">Plans</span>
          </div>
          <p className="text-2xl font-bold">{stats?.planCount || 0}</p>
          <p className="text-[10px] text-slate-500">This month</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-green-400" />
            <span className="text-xs text-slate-400">Delivery</span>
          </div>
          <p className="text-2xl font-bold">{stats?.deliverySuccessRate || 0}%</p>
          <p className="text-[10px] text-slate-500">Success rate</p>
        </div>
      </div>

      {/* Row 6: Quick Actions + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Actions */}
        <div className="rounded-xl bg-slate-800 p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-white mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link
              href="/dashboard/plan/new"
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700/50 transition-colors group"
            >
              <div className="bg-primary-500/20 p-2 rounded-lg">
                <Calendar className="h-4 w-4 text-primary-400" />
              </div>
              <span className="text-sm text-slate-300 group-hover:text-white">New Weekly Plan</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
            <Link
              href="/dashboard/athletes"
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700/50 transition-colors group"
            >
              <div className="bg-green-500/20 p-2 rounded-lg">
                <UserPlus className="h-4 w-4 text-green-400" />
              </div>
              <span className="text-sm text-slate-300 group-hover:text-white">Invite Athlete</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
            <Link
              href="/dashboard/groups"
              className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700/50 transition-colors group"
            >
              <div className="bg-purple-500/20 p-2 rounded-lg">
                <LayoutGrid className="h-4 w-4 text-purple-400" />
              </div>
              <span className="text-sm text-slate-300 group-hover:text-white">Manage Groups</span>
              <ArrowRight className="h-3 w-3 text-slate-600 ml-auto group-hover:text-slate-400" />
            </Link>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 rounded-xl bg-slate-800 p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-primary-400" />
            <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
          </div>
          {stats?.recentActivity && stats.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-700/30">
                  <div className={cn(
                    "p-1.5 rounded-lg",
                    activity.type === 'plan_pushed' && "bg-primary-500/20",
                    activity.type === 'athlete_joined' && "bg-green-500/20",
                    activity.type === 'athlete_invited' && "bg-yellow-500/20"
                  )}>
                    {activity.type === 'plan_pushed' && <Calendar className="h-3.5 w-3.5 text-primary-400" />}
                    {activity.type === 'athlete_joined' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                    {activity.type === 'athlete_invited' && <Clock className="h-3.5 w-3.5 text-yellow-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-300">{activity.description}</p>
                  </div>
                  <p className="text-[10px] text-slate-500 shrink-0">
                    {new Date(activity.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-6">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}

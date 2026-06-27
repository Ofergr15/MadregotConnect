'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Users,
  Layers,
  ArrowRight,
  TrendingUp,
  Target,
  UserPlus,
  LayoutGrid,
  Activity,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DashboardStats {
  athleteCount: number;
  totalAthletes: number;
  groupCount: number;
  planCount: number;
  deliverySuccessRate: number;
  recentPlans: Array<{
    id: string;
    week_start_date: string;
    status: string;
    created_at: string;
  }>;
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: string;
  }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [coachName] = useState('Coach'); // In production, fetch from auth session

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary-600 to-primary-800 p-8 text-white">
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <svg viewBox="0 0 40 40" className="h-8 w-8" fill="currentColor">
              <rect x="8" y="30" width="24" height="4"/>
              <rect x="12" y="24" width="20" height="4"/>
              <rect x="16" y="18" width="16" height="4"/>
              <rect x="20" y="12" width="12" height="4"/>
              <rect x="24" y="6" width="8" height="4"/>
            </svg>
            <div className="flex flex-col leading-tight">
              <span className="text-xl font-bold uppercase tracking-tight">MADREGOT</span>
              <span className="text-xs text-primary-100 uppercase tracking-wide">After 2KM</span>
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome back, {coachName}!</h1>
          <p className="text-primary-100 text-lg">
            Ready to push some workouts? You have {stats?.athleteCount || 0} active athletes waiting.
          </p>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/20 rounded-full blur-3xl"></div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Athletes */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-primary-500 transition-colors">
          <div className="flex items-start justify-between mb-4">
            <div className="bg-primary-500/20 p-3 rounded-lg">
              <Users className="h-6 w-6 text-primary-400" />
            </div>
            <div className="flex items-center gap-1 text-green-400 text-xs font-medium">
              <TrendingUp className="h-3 w-3" />
              +{stats?.totalAthletes || 0}
            </div>
          </div>
          <p className="text-3xl font-bold mb-1">{stats?.athleteCount || 0}</p>
          <p className="text-sm text-slate-400">Active Athletes</p>
          <p className="text-xs text-slate-500 mt-1">
            {stats?.totalAthletes || 0} total including invited
          </p>
        </div>

        {/* Active Groups */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-purple-500 transition-colors">
          <div className="flex items-start justify-between mb-4">
            <div className="bg-purple-500/20 p-3 rounded-lg">
              <Layers className="h-6 w-6 text-purple-400" />
            </div>
          </div>
          <p className="text-3xl font-bold mb-1">{stats?.groupCount || 0}</p>
          <p className="text-sm text-slate-400">Active Groups</p>
          <p className="text-xs text-slate-500 mt-1">
            Pace profiles configured
          </p>
        </div>

        {/* Workouts This Month */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-orange-500 transition-colors">
          <div className="flex items-start justify-between mb-4">
            <div className="bg-orange-500/20 p-3 rounded-lg">
              <Calendar className="h-6 w-6 text-orange-400" />
            </div>
          </div>
          <p className="text-3xl font-bold mb-1">{stats?.planCount || 0}</p>
          <p className="text-sm text-slate-400">Plans This Month</p>
          <p className="text-xs text-slate-500 mt-1">
            Weekly plans created
          </p>
        </div>

        {/* Success Rate */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-green-500 transition-colors">
          <div className="flex items-start justify-between mb-4">
            <div className="bg-green-500/20 p-3 rounded-lg">
              <Target className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="text-3xl font-bold mb-1">{stats?.deliverySuccessRate || 0}%</p>
          <p className="text-sm text-slate-400">Success Rate</p>
          <p className="text-xs text-slate-500 mt-1">
            Workout delivery success
          </p>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/dashboard/plan/new"
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-primary-500 transition-all group"
          >
            <div className="bg-primary-500/20 p-3 rounded-lg inline-block mb-4 group-hover:bg-primary-500/30 transition-colors">
              <Calendar className="h-6 w-6 text-primary-400" />
            </div>
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              New Weekly Plan
              <ArrowRight className="h-4 w-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </h3>
            <p className="text-sm text-slate-400">
              Create and push workouts to your athletes
            </p>
          </Link>

          <Link
            href="/dashboard/athletes"
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-green-500 transition-all group"
          >
            <div className="bg-green-500/20 p-3 rounded-lg inline-block mb-4 group-hover:bg-green-500/30 transition-colors">
              <UserPlus className="h-6 w-6 text-green-400" />
            </div>
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              Invite Athlete
              <ArrowRight className="h-4 w-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </h3>
            <p className="text-sm text-slate-400">
              Add new athletes to your roster
            </p>
          </Link>

          <Link
            href="/dashboard/groups"
            className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-purple-500 transition-all group"
          >
            <div className="bg-purple-500/20 p-3 rounded-lg inline-block mb-4 group-hover:bg-purple-500/30 transition-colors">
              <LayoutGrid className="h-6 w-6 text-purple-400" />
            </div>
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              Manage Groups
              <ArrowRight className="h-4 w-4 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
            </h3>
            <p className="text-sm text-slate-400">
              Configure pace profiles and groups
            </p>
          </Link>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5 text-primary-400" />
            <h2 className="text-lg font-bold">Recent Activity</h2>
          </div>
          {stats?.recentActivity && stats.recentActivity.length > 0 ? (
            <div className="space-y-3">
              {stats.recentActivity.map((activity, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                >
                  <div className={cn(
                    "p-2 rounded-lg mt-0.5",
                    activity.type === 'plan_pushed' && "bg-primary-500/20",
                    activity.type === 'athlete_joined' && "bg-green-500/20",
                    activity.type === 'athlete_invited' && "bg-yellow-500/20"
                  )}>
                    {activity.type === 'plan_pushed' && <Calendar className="h-4 w-4 text-primary-400" />}
                    {activity.type === 'athlete_joined' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
                    {activity.type === 'athlete_invited' && <Clock className="h-4 w-4 text-yellow-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{activity.description}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {new Date(activity.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No recent activity yet</p>
            </div>
          )}
        </div>

        {/* Recent Plans */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-5 w-5 text-orange-400" />
            <h2 className="text-lg font-bold">Recent Plans</h2>
          </div>
          {stats?.recentPlans && stats.recentPlans.length > 0 ? (
            <div className="space-y-3">
              {stats.recentPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-orange-500/20 p-2 rounded-lg">
                      <Calendar className="h-4 w-4 text-orange-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        Week of {new Date(plan.week_start_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(plan.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-full text-xs font-medium",
                    plan.status === 'pushed' && "bg-green-500/20 text-green-400",
                    plan.status === 'draft' && "bg-yellow-500/20 text-yellow-400",
                    plan.status === 'partial' && "bg-orange-500/20 text-orange-400"
                  )}>
                    {plan.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Calendar className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm mb-3">No plans yet</p>
              <Link
                href="/dashboard/plan/new"
                className="inline-flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300"
              >
                Create your first plan
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

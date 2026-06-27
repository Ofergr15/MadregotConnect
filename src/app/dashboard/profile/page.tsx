'use client';

import { useState, useEffect } from 'react';
import { User, Users, CheckCircle2, Loader2, Save, Dumbbell, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

interface WeekProgram {
  weekLabel: string;
  dateRange: string;
  training: string;
  nutrition: string;
}

const WEEKS: WeekProgram[] = [
  {
    weekLabel: 'Week 5',
    dateRange: '28.06 – 04.07',
    training: '/plans/training-program/week-28-06-04-07-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-28-06-04-07-2026.pdf',
  },
  {
    weekLabel: 'Week 4',
    dateRange: '21.06 – 27.06',
    training: '/plans/training-program/week-21-27-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-21-27-06-2026.pdf',
  },
  {
    weekLabel: 'Week 3',
    dateRange: '14.06 – 20.06',
    training: '/plans/training-program/week-14-20-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-14-20-06-2026.pdf',
  },
  {
    weekLabel: 'Week 2',
    dateRange: '07.06 – 13.06',
    training: '/plans/training-program/week-07-13-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-07-13-06-2026.pdf',
  },
  {
    weekLabel: 'Week 1',
    dateRange: '31.05 – 06.06',
    training: '/plans/training-program/week-31-05-06-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-31-05-06-06-2026.pdf',
  },
];

export default function ProfilePage() {
  const [athleteId, setAthleteId] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [currentGroupId, setCurrentGroupId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    const name = localStorage.getItem('athlete_name') || '';
    const email = localStorage.getItem('athlete_email') || '';
    const groupId = localStorage.getItem('athlete_group_id') || '';
    setAthleteId(id);
    setAthleteName(name);
    setAthleteEmail(email);
    setCurrentGroupId(groupId);
    setSelectedGroupId(groupId);

    fetch('/api/groups')
      .then(res => res.json())
      .then(data => setGroups(data.groups || []))
      .catch(() => {});
  }, []);

  const hasChanges = selectedGroupId !== currentGroupId;

  const saveGroup = async () => {
    if (!athleteId || !hasChanges) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, groupId: selectedGroupId }),
      });

      if (res.ok) {
        setCurrentGroupId(selectedGroupId);
        localStorage.setItem('athlete_group_id', selectedGroupId);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
    } finally {
      setSaving(false);
    }
  };

  if (!athleteId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <User className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No Profile Found</h2>
          <p className="text-slate-400 text-sm">
            Join via your invite link to set up your profile.
          </p>
        </div>
      </div>
    );
  }

  const levelStyles = {
    fast: 'border-green-500/40 bg-green-500/10 hover:bg-green-500/20',
    medium: 'border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20',
    slow: 'border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/20',
  };
  const badgeStyles = {
    fast: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    slow: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  };

  const currentWeek = WEEKS[0];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Manage your settings and pace group
        </p>
      </div>

      {/* Profile Info */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-4">
          <div className="bg-primary-500/20 w-14 h-14 rounded-full flex items-center justify-center">
            <User className="h-7 w-7 text-primary-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{athleteName}</h2>
            <p className="text-sm text-slate-400">{athleteEmail}</p>
          </div>
        </div>
      </div>

      {/* This Week's Program */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Dumbbell className="h-5 w-5 text-primary-400" />
          <h2 className="font-semibold">This Week&apos;s Program</h2>
          <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full font-medium ml-auto">
            {currentWeek.weekLabel}
          </span>
        </div>

        <div className="bg-slate-700/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-medium text-white">Training Program</span>
            </div>
            <span className="text-xs text-slate-400">{currentWeek.dateRange}</span>
          </div>
          <a
            href="/dashboard/program"
            className="mt-3 inline-flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View full program
          </a>
        </div>
      </div>

      {/* Group Selection */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-400" />
            <h2 className="font-semibold">My Pace Group</h2>
          </div>
          {saved && <CheckCircle2 className="h-4 w-4 text-green-400" />}
        </div>

        <div className="space-y-2">
          {groups.map(g => {
            const level = g.level || 'medium';
            const isSelected = selectedGroupId === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                disabled={saving}
                className={cn(
                  'w-full text-left px-4 py-4 rounded-lg border-2 transition-all flex items-center gap-3',
                  isSelected
                    ? `${levelStyles[level]} ring-2 ring-offset-1 ring-offset-slate-800 ring-primary-500/50`
                    : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                )}
              >
                <Users className={cn('h-5 w-5', isSelected ? 'text-primary-400' : 'text-slate-400')} />
                <span className="flex-1 font-medium text-white">{g.name}</span>
                {g.marathonGoal && (
                  <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', badgeStyles[level])}>
                    {g.marathonGoal}
                  </span>
                )}
                {isSelected && <CheckCircle2 className="h-5 w-5 text-primary-400" />}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-500 mt-3">
          Your coach will assign workouts based on your group&apos;s pace
        </p>

        {/* Save button — only shows when group changed */}
        {hasChanges && (
          <button
            onClick={saveGroup}
            disabled={saving}
            className="mt-4 w-full bg-primary-600 hover:bg-primary-700 text-white font-medium px-4 py-3 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

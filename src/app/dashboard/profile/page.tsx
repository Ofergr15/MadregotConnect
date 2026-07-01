'use client';

import { useState, useEffect } from 'react';
import { User, Users, CheckCircle2, Loader2, Save, Dumbbell, FileText, ChevronRight, Watch, Mail, Target } from 'lucide-react';
import Link from 'next/link';
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

  const initials = athleteName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const currentGroup = groups.find(g => g.id === currentGroupId);
  const currentWeek = WEEKS[0];

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-8">
      {/* Profile Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#4338ff]/20 via-slate-800 to-purple-900/20 border border-slate-700/50 p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#4338ff]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
        <div className="relative flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#4338ff] to-purple-600 flex items-center justify-center shadow-lg shadow-[#4338ff]/20">
            <span className="text-xl font-bold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{athleteName}</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-400 truncate">{athleteEmail}</span>
            </div>
            {currentGroup && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <Target className="h-3.5 w-3.5 text-[#4338ff] shrink-0" />
                <span className="text-sm font-medium text-[#4338ff]">{currentGroup.marathonGoal || currentGroup.name}</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
            <Watch className="h-3.5 w-3.5 text-green-400" />
            <span className="text-xs font-medium text-green-400">Garmin Connected</span>
          </div>
        </div>
      </div>

      {/* This Week's Program */}
      <Link
        href="/dashboard/program"
        className="block rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5 hover:border-[#4338ff]/30 hover:bg-slate-800 transition-all group"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#4338ff]/15 flex items-center justify-center">
              <Dumbbell className="h-4.5 w-4.5 text-[#4338ff]" />
            </div>
            <h2 className="font-semibold text-white">This Week&apos;s Program</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#4338ff] bg-[#4338ff]/10 px-2.5 py-1 rounded-full">
              {currentWeek.weekLabel}
            </span>
            <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#4338ff] transition-colors" />
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-xl p-4 flex items-center gap-3">
          <FileText className="h-5 w-5 text-slate-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Training & Nutrition</p>
            <p className="text-xs text-slate-500 mt-0.5">{currentWeek.dateRange}</p>
          </div>
        </div>
      </Link>

      {/* Pace Group Selection */}
      <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex items-center justify-center">
              <Users className="h-4.5 w-4.5 text-purple-400" />
            </div>
            <h2 className="font-semibold text-white">Pace Group</h2>
          </div>
          {saved && (
            <div className="flex items-center gap-1.5 text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Saved</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {groups.map(g => {
            const isSelected = selectedGroupId === g.id;
            const isCurrent = currentGroupId === g.id;
            const levelColor = g.level === 'fast' ? 'green' : g.level === 'medium' ? 'amber' : 'orange';
            return (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                disabled={saving}
                className={cn(
                  'w-full text-left px-4 py-3.5 rounded-xl border transition-all flex items-center gap-3',
                  isSelected
                    ? 'border-[#4338ff]/60 bg-[#4338ff]/5 shadow-sm shadow-[#4338ff]/10'
                    : 'border-slate-700/50 bg-slate-900/30 hover:bg-slate-700/30 hover:border-slate-600'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                  isSelected ? 'bg-[#4338ff]/20' : 'bg-slate-700/50'
                )}>
                  <Users className={cn('h-4 w-4', isSelected ? 'text-[#4338ff]' : 'text-slate-400')} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={cn('font-medium block', isSelected ? 'text-white' : 'text-slate-300')}>
                    {g.name}
                  </span>
                </div>
                {g.marathonGoal && (
                  <span className={cn(
                    'text-xs px-2 py-1 rounded-md font-bold shrink-0',
                    levelColor === 'green' && 'bg-green-500/15 text-green-400',
                    levelColor === 'amber' && 'bg-amber-500/15 text-amber-400',
                    levelColor === 'orange' && 'bg-orange-500/15 text-orange-400',
                  )}>
                    {g.marathonGoal}
                  </span>
                )}
                {isSelected && (
                  <CheckCircle2 className="h-5 w-5 text-[#4338ff] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {hasChanges && (
          <button
            onClick={saveGroup}
            disabled={saving}
            className="mt-4 w-full bg-[#4338ff] hover:bg-[#3730d4] text-white font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Group Change
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

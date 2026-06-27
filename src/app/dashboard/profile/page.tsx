'use client';

import { useState, useEffect } from 'react';
import { User, Users, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

export default function ProfilePage() {
  const [athleteId, setAthleteId] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [currentGroupId, setCurrentGroupId] = useState('');
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

    fetch('/api/groups')
      .then(res => res.json())
      .then(data => setGroups(data.groups || []))
      .catch(() => {});
  }, []);

  const changeGroup = async (groupId: string) => {
    if (!athleteId) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, groupId }),
      });

      if (res.ok) {
        setCurrentGroupId(groupId);
        localStorage.setItem('athlete_group_id', groupId);
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

      {/* Group Selection */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-400" />
            <h2 className="font-semibold">My Pace Group</h2>
          </div>
          {saving && <Loader2 className="h-4 w-4 animate-spin text-primary-400" />}
          {saved && <CheckCircle2 className="h-4 w-4 text-green-400" />}
        </div>

        <div className="space-y-2">
          {groups.map(g => {
            const level = g.level || 'medium';
            const isSelected = currentGroupId === g.id;
            return (
              <button
                key={g.id}
                onClick={() => changeGroup(g.id)}
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
      </div>
    </div>
  );
}

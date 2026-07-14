'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  GraduationCap, Loader2, Watch, Plus, X, Search, UserMinus, Users, ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AcademyCompliance } from '@/components/AcademyCompliance';

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  status: 'active' | 'invited' | 'paused' | 'disconnected';
  isAcademy?: boolean;
  hasGarmin?: boolean;
}

const groupColors: Record<string, { bg: string; text: string; border: string }> = {
  'Group 1': { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/20' },
  'Group 2': { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  'Group 3': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20' },
};

function getGroupStyle(name: string | null) {
  if (!name) return null;
  return groupColors[name] || { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/20' };
}

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

export default function AcademyPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'roster' | 'compliance'>('roster');

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const res = await fetch('/api/athletes');
      const data = await res.json();
      setAthletes(data.athletes || []);
    } catch (err) {
      console.error('Failed to fetch athletes:', err);
    } finally {
      setLoading(false);
    }
  };

  const setAcademy = async (athleteId: string, isAcademy: boolean) => {
    setSaving(athleteId);
    // Optimistic update
    setAthletes(prev => prev.map(a => (a.id === athleteId ? { ...a, isAcademy } : a)));
    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, isAcademy }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch (err) {
      console.error('Failed to update academy status:', err);
      // Revert on failure
      setAthletes(prev => prev.map(a => (a.id === athleteId ? { ...a, isAcademy: !isAcademy } : a)));
    } finally {
      setSaving(null);
    }
  };

  const academyAthletes = useMemo(
    () => athletes.filter(a => a.isAcademy),
    [athletes]
  );

  const addableAthletes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return athletes
      .filter(a => !a.isAcademy && a.status !== 'invited')
      .filter(a => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [athletes, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-primary-600/20 w-12 h-12 rounded-2xl flex items-center justify-center ring-1 ring-primary-500/20">
            <GraduationCap className="h-6 w-6 text-primary-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Academy</h1>
            <p className="text-sm text-slate-400">
              Manage your academy athletes — individual plans, pace targets, and compliance.
            </p>
          </div>
        </div>
        {view === 'roster' && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add athlete</span>
          </button>
        )}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-1 mb-6 bg-slate-800/50 border border-slate-700/50 rounded-xl p-1 w-fit">
        <button
          onClick={() => setView('roster')}
          className={cn(
            'flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-semibold transition-colors',
            view === 'roster' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
          )}
        >
          <Users className="h-4 w-4" /> Roster
        </button>
        <button
          onClick={() => setView('compliance')}
          className={cn(
            'flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-semibold transition-colors',
            view === 'compliance' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
          )}
        >
          <ClipboardCheck className="h-4 w-4" /> Compliance
        </button>
      </div>

      {view === 'compliance' ? (
        <AcademyCompliance />
      ) : (
      <>
      {/* Stat */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
          <div className="text-3xl font-bold text-white">{academyAthletes.length}</div>
          <div className="text-xs text-slate-400 mt-1">Academy athletes</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
          <div className="text-3xl font-bold text-white">
            {academyAthletes.filter(a => a.hasGarmin).length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Connected to Garmin</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
          <div className="text-3xl font-bold text-white">
            {academyAthletes.filter(a => a.status === 'active').length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Active</div>
        </div>
      </div>

      {/* Roster */}
      {academyAthletes.length === 0 ? (
        <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-2xl p-12 text-center">
          <GraduationCap className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No academy athletes yet</p>
          <p className="text-sm text-slate-500 mt-1">
            Add athletes to the academy to give them individual plans and pace targets.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add athlete
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {academyAthletes.map(a => {
            const gs = getGroupStyle(a.groupName);
            return (
              <div
                key={a.id}
                className="flex items-center gap-4 bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4"
              >
                <div className="bg-primary-600/20 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-primary-300 shrink-0">
                  {initialsOf(a.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white truncate">{a.name}</div>
                  <div className="text-xs text-slate-400 truncate">{a.email}</div>
                </div>
                {a.groupName && gs && (
                  <span className={cn('text-xs font-bold px-2.5 py-1 rounded-lg border', gs.bg, gs.text, gs.border)}>
                    {a.groupName}
                  </span>
                )}
                <div className={cn('shrink-0', a.hasGarmin ? 'text-emerald-400' : 'text-slate-600')} title={a.hasGarmin ? 'Garmin connected' : 'No Garmin'}>
                  <Watch className="h-4.5 w-4.5" />
                </div>
                <button
                  onClick={() => setAcademy(a.id, false)}
                  disabled={saving === a.id}
                  className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 text-xs font-semibold transition-colors disabled:opacity-50"
                  title="Remove from academy"
                >
                  {saving === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
                  <span className="hidden sm:inline">Remove</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-lg font-bold text-white">Add to Academy</h2>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 border-b border-slate-700">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search athletes…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl ps-9 pe-3 h-10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500"
                />
              </div>
            </div>
            <div className="overflow-y-auto p-2">
              {addableAthletes.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  {search ? 'No matching athletes.' : 'All athletes are already in the academy.'}
                </p>
              ) : (
                addableAthletes.map(a => {
                  const gs = getGroupStyle(a.groupName);
                  return (
                    <button
                      key={a.id}
                      onClick={() => setAcademy(a.id, true)}
                      disabled={saving === a.id}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-700/50 transition-colors text-start disabled:opacity-50"
                    >
                      <div className="bg-slate-700 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                        {initialsOf(a.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white text-sm truncate">{a.name}</div>
                        <div className="text-xs text-slate-400 truncate">{a.email}</div>
                      </div>
                      {a.groupName && gs && (
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md border', gs.bg, gs.text, gs.border)}>
                          {a.groupName}
                        </span>
                      )}
                      {saving === a.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary-400 shrink-0" />
                      ) : (
                        <Plus className="h-4 w-4 text-primary-400 shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

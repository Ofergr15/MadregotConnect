'use client';

import { useState, useEffect } from 'react';
import { Users, Trophy, Edit3, X, ChevronDown, ChevronUp, Medal } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';

interface Athlete {
  id: string;
  name: string;
  email: string;
  status: string;
}

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  athleteCount: number;
  athletes: Athlete[];
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

interface LeaderboardEntry {
  id: string;
  name: string;
  groupId: string | null;
  distanceKm: number;
  runs: number;
  durationMin: number;
}

const GROUP_COLORS: Record<number, { bg: string; border: string; text: string; badge: string; dot: string }> = {
  0: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', badge: 'bg-green-500/20', dot: 'bg-green-400' },
  1: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', badge: 'bg-yellow-500/20', dot: 'bg-yellow-400' },
  2: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', badge: 'bg-orange-500/20', dot: 'bg-orange-400' },
};

function getGroupColors(index: number) {
  return GROUP_COLORS[index] || GROUP_COLORS[0];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [groupLeaderboards, setGroupLeaderboards] = useState<Record<string, LeaderboardEntry[]>>({});
  const [activeTab, setActiveTab] = useState<'members' | 'leaderboard'>('members');

  useEffect(() => {
    fetchGroups();
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/groups/leaderboard');
      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
      setGroupLeaderboards(data.groupLeaderboards || {});
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      const data = await response.json();
      setGroups(data.groups || []);
      if (data.groups?.length > 0 && !expandedGroup) {
        setExpandedGroup(data.groups[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateGroup = async (updates: Partial<Group> & { id: string }) => {
    try {
      const response = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        setEditingGroup(null);
        fetchGroups();
      }
    } catch (error) {
      console.error('Failed to update group:', error);
    }
  };

  const totalAthletes = groups.reduce((sum, g) => sum + g.athleteCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Training Groups</h1>
        <p className="text-slate-400 mt-1">
          {totalAthletes} athletes across {groups.length} groups
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map((group, idx) => {
          const colors = getGroupColors(idx);
          return (
            <div
              key={group.id}
              className={cn(
                "rounded-xl p-4 border cursor-pointer transition-all hover:scale-[1.02]",
                colors.bg, colors.border
              )}
              onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={cn("text-lg font-bold", colors.text)}>{group.name}</span>
                <span className={cn("text-xs px-2 py-1 rounded-full font-medium", colors.badge, colors.text)}>
                  {group.athleteCount} runners
                </span>
              </div>
              {group.marathonGoal && (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <Trophy className="h-4 w-4 text-yellow-400" />
                  <span className="font-mono">{group.marathonGoal}</span>
                </div>
              )}
              <div className="text-xs text-slate-500 mt-1">
                Pace offset: {group.paceOffsetSeconds > 0 ? '+' : ''}{group.paceOffsetSeconds}s/km
              </div>
            </div>
          );
        })}
      </div>

      {/* Group Details */}
      <div className="space-y-4">
        {groups.map((group, idx) => {
          const colors = getGroupColors(idx);
          const isExpanded = expandedGroup === group.id;

          return (
            <div
              key={group.id}
              className={cn(
                "rounded-xl border overflow-hidden transition-all",
                colors.border,
                isExpanded ? 'bg-slate-800/80' : 'bg-slate-800/40'
              )}
            >
              {/* Group Header */}
              <button
                className="w-full flex items-center justify-between p-4 sm:p-5"
                onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-3 h-3 rounded-full", colors.dot)} />
                  <div className="text-left">
                    <h3 className="text-lg font-semibold">{group.name}</h3>
                    <span className="text-sm text-slate-400">
                      {group.athleteCount} athlete{group.athleteCount !== 1 ? 's' : ''}
                      {group.marathonGoal && ` · Goal: ${group.marathonGoal}`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingGroup(group); }}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    <Edit3 className="h-4 w-4 text-slate-400" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-400" />
                  )}
                </div>
              </button>

              {/* Expanded Content - Athlete List */}
              {isExpanded && (
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-slate-700/50">
                  {group.athletes.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {group.athletes.map((athlete) => (
                        <div
                          key={athlete.id}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-900/50 hover:bg-slate-900/80 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold", colors.badge, colors.text)}>
                              {athlete.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{athlete.name}</p>
                              <p className="text-xs text-slate-500">{athlete.email}</p>
                            </div>
                          </div>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            athlete.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-slate-600/30 text-slate-400'
                          )}>
                            {athlete.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 text-center py-8">
                      <Users className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">No athletes in this group yet</p>
                      <p className="text-xs text-slate-600 mt-1">Assign athletes from the Athletes page</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Leaderboard Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Medal className="h-5 w-5 text-yellow-400" />
            <h2 className="text-xl font-bold">Weekly Leaderboard</h2>
          </div>
          <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700">
            <button
              onClick={() => setActiveTab('members')}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors",
                activeTab === 'members' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
              )}
            >
              By Group
            </button>
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors",
                activeTab === 'leaderboard' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
              )}
            >
              Overall
            </button>
          </div>
        </div>

        {activeTab === 'leaderboard' ? (
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {leaderboard.length > 0 ? (
              <div className="divide-y divide-slate-700/50">
                {leaderboard.map((entry, idx) => {
                  const groupIdx = groups.findIndex(g => g.id === entry.groupId);
                  const colors = groupIdx >= 0 ? getGroupColors(groupIdx) : { dot: 'bg-slate-500', text: 'text-slate-400' };
                  return (
                    <div key={entry.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-700/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                          idx === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                          idx === 1 ? 'bg-slate-400/20 text-slate-300' :
                          idx === 2 ? 'bg-orange-500/20 text-orange-400' :
                          'bg-slate-700 text-slate-400'
                        )}>
                          {idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className={cn("w-2 h-2 rounded-full", colors.dot)} />
                          <span className="font-medium text-sm">{entry.name}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-slate-400">{entry.runs} runs</span>
                        <span className="font-bold font-mono text-white">{entry.distanceKm} km</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <Trophy className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No activity data yet this week</p>
                <p className="text-xs text-slate-600 mt-1">Leaderboard will populate once activities sync from Garmin</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group, idx) => {
              const colors = getGroupColors(idx);
              const entries = groupLeaderboards[group.id] || [];
              const groupTotal = entries.reduce((sum, e) => sum + e.distanceKm, 0);
              return (
                <div key={group.id} className={cn("rounded-xl border overflow-hidden", colors.border)}>
                  <div className={cn("px-4 py-3 flex items-center justify-between", colors.bg)}>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2.5 h-2.5 rounded-full", colors.dot)} />
                      <span className={cn("font-semibold", colors.text)}>{group.name}</span>
                    </div>
                    <span className="text-sm text-slate-300 font-mono">
                      {Math.round(groupTotal * 10) / 10} km total
                    </span>
                  </div>
                  {entries.length > 0 ? (
                    <div className="divide-y divide-slate-700/30">
                      {entries.map((entry, entryIdx) => (
                        <div key={entry.id} className="flex items-center justify-between px-4 py-2.5 bg-slate-800/60">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-500 w-4">{entryIdx + 1}.</span>
                            <span className="text-sm">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-slate-500">{entry.runs} runs</span>
                            <span className="font-mono font-medium">{entry.distanceKm} km</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 bg-slate-800/60 text-center">
                      <p className="text-xs text-slate-500">No activities this week</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {groups.length === 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 text-center py-16">
          <Users className="h-12 w-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">No groups created</h3>
          <p className="text-slate-400 text-sm">Groups will appear here once created</p>
        </div>
      )}

      {/* Edit Modal */}
      {editingGroup && (
        <EditGroupModal
          group={editingGroup}
          onSave={updateGroup}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

function EditGroupModal({ group, onSave, onClose }: {
  group: Group;
  onSave: (group: Partial<Group> & { id: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [paceOffsetSeconds, setPaceOffsetSeconds] = useState(group.paceOffsetSeconds);
  const [marathonGoal, setMarathonGoal] = useState(group.marathonGoal || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ id: group.id, name, paceOffsetSeconds, marathonGoal });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-lg">Edit {group.name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Group Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Marathon Goal</label>
            <input
              type="text"
              value={marathonGoal}
              onChange={(e) => setMarathonGoal(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 font-mono text-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="2:30:00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Pace Offset (s/km)</label>
            <input
              type="number"
              value={paceOffsetSeconds}
              onChange={(e) => setPaceOffsetSeconds(parseInt(e.target.value) || 0)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-center font-mono text-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="mt-2 text-xs text-slate-500">
              Base 4:00/km → This group: {formatPace(240 + paceOffsetSeconds)}/km
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

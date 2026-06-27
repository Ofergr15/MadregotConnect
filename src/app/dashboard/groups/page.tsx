'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit3, Save, Users, Trash2, X, Layers } from 'lucide-react';
import { PaceProfile } from '@/lib/garmin/types';
import { formatPace, parsePaceString, getDefaultPaceProfile } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  paceProfile: PaceProfile;
  athleteCount: number;
}

const ZONES = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace'] as const;
const ZONE_LABELS: Record<string, string> = {
  easy: 'Easy',
  threshold: 'Threshold',
  interval: 'Interval',
  tempo: 'Tempo',
  sprint: 'Sprint',
  marathon_pace: 'Marathon Pace',
};

const ZONE_COLORS: Record<string, string> = {
  easy: 'bg-green-500',
  threshold: 'bg-orange-500',
  interval: 'bg-red-500',
  tempo: 'bg-yellow-500',
  sprint: 'bg-purple-500',
  marathon_pace: 'bg-blue-500',
};

function PaceProfileEditor({
  profile,
  onChange,
}: {
  profile: PaceProfile;
  onChange: (profile: PaceProfile) => void;
}) {
  return (
    <div className="space-y-4 mt-4 bg-slate-700/30 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <Edit3 className="h-4 w-4 text-blue-400" />
        <h4 className="text-sm font-semibold text-blue-400">Editing Pace Profile</h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ZONES.map((zone) => (
          <div key={zone} className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("w-3 h-3 rounded-full", ZONE_COLORS[zone])}></div>
              <label className="text-sm font-medium text-slate-300">
                {ZONE_LABELS[zone]}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={formatPace(profile[zone].min)}
                onChange={(e) => {
                  const val = parsePaceString(e.target.value);
                  if (val > 0) {
                    onChange({
                      ...profile,
                      [zone]: { ...profile[zone], min: val },
                    });
                  }
                }}
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="4:00"
              />
              <span className="text-slate-500 font-medium">to</span>
              <input
                value={formatPace(profile[zone].max)}
                onChange={(e) => {
                  const val = parsePaceString(e.target.value);
                  if (val > 0) {
                    onChange({
                      ...profile,
                      [zone]: { ...profile[zone], max: val },
                    });
                  }
                }}
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="4:30"
              />
              <span className="text-xs text-slate-400 font-medium">/km</span>
            </div>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-slate-600">
        <p className="text-xs text-slate-400">
          Enter paces in minutes:seconds format (e.g., 4:30). Changes are saved automatically.
        </p>
      </div>
    </div>
  );
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const addGroup = async () => {
    if (!newGroupName.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName,
          paceProfile: getDefaultPaceProfile(),
        }),
      });
      const data = await response.json();

      if (response.ok) {
        setNewGroupName('');
        fetchGroups(); // Refresh the list
        setEditingId(data.group.id);
      } else {
        alert('Failed to create group: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to create group:', error);
      alert('Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  const updateGroup = async (id: string, updates: Partial<Group>) => {
    try {
      const response = await fetch('/api/groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });

      if (response.ok) {
        fetchGroups(); // Refresh the list
      } else {
        const data = await response.json();
        alert('Failed to update group: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to update group:', error);
      alert('Failed to update group');
    }
  };

  const deleteGroup = async (id: string) => {
    if (!confirm('Are you sure you want to delete this group? Athletes in this group will be unassigned.')) {
      return;
    }

    try {
      const response = await fetch(`/api/groups?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchGroups(); // Refresh the list
      } else {
        const data = await response.json();
        alert('Failed to delete group: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Failed to delete group:', error);
      alert('Failed to delete group');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Groups</h1>
          <p className="text-slate-400 mt-1">
            Manage athlete groups and their pace profiles
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-purple-500/20 p-2 rounded-lg">
              <Layers className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{groups.length}</p>
              <p className="text-xs text-slate-400">Total Groups</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <Users className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {groups.reduce((sum, g) => sum + g.athleteCount, 0)}
              </p>
              <p className="text-xs text-slate-400">Athletes in Groups</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-green-500/20 p-2 rounded-lg">
              <Edit3 className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{ZONES.length}</p>
              <p className="text-xs text-slate-400">Pace Zones</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add Group */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="font-semibold mb-3">Create New Group</h3>
        <div className="flex items-center gap-3">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Enter group name (e.g., Advanced Runners, Marathon Group)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === 'Enter' && addGroup()}
          />
          <button
            onClick={addGroup}
            disabled={submitting || !newGroupName.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {submitting ? 'Creating...' : 'Add Group'}
          </button>
        </div>
      </div>

      {/* Groups List */}
      {groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.id} className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-500/20 p-2 rounded-lg">
                    <Layers className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{group.name}</h3>
                    <span className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                      <Users className="h-3 w-3" />
                      {group.athleteCount} athlete{group.athleteCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (editingId === group.id) {
                        setEditingId(null);
                      } else {
                        setEditingId(group.id);
                      }
                    }}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
                  >
                    {editingId === group.id ? (
                      <>
                        <X className="h-4 w-4" />
                        Cancel
                      </>
                    ) : (
                      <>
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="bg-red-600/20 hover:bg-red-600/30 text-red-400 px-3 py-2 rounded-lg font-medium transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {editingId === group.id && (
                <PaceProfileEditor
                  profile={group.paceProfile}
                  onChange={(paceProfile) => {
                    updateGroup(group.id, { paceProfile });
                  }}
                />
              )}

              {editingId !== group.id && (
                <div className="space-y-3">
                  {/* Visual Pace Bars */}
                  <div className="space-y-2">
                    {ZONES.map((zone) => {
                      const min = group.paceProfile[zone].min;
                      const max = group.paceProfile[zone].max;
                      // Calculate width based on pace range (slower pace = wider bar for visual effect)
                      const range = max - min;
                      const baseWidth = 60;
                      const widthPercent = Math.min(100, baseWidth + (range / 10) * 5);

                      return (
                        <div key={zone} className="flex items-center gap-3">
                          <div className="w-32 text-sm font-medium text-slate-300">
                            {ZONE_LABELS[zone]}
                          </div>
                          <div className="flex-1">
                            <div className="relative h-8 bg-slate-700/50 rounded-lg overflow-hidden">
                              <div
                                className={cn(
                                  "absolute left-0 top-0 h-full rounded-lg transition-all",
                                  ZONE_COLORS[zone]
                                )}
                                style={{ width: `${widthPercent}%` }}
                              >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10"></div>
                              </div>
                              <div className="absolute inset-0 flex items-center px-3">
                                <span className="text-xs font-semibold text-white drop-shadow-lg">
                                  {formatPace(min)} - {formatPace(max)} /km
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 text-center py-16">
          <div className="bg-slate-700/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Layers className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
          <p className="text-slate-400 mb-4">
            Create groups to assign different pace targets to your athletes
          </p>
        </div>
      )}
    </div>
  );
}


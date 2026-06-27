'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit3, Users, Trash2, X, Layers, Zap, TrendingUp, Activity, Trophy, Target } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  paceOffsetSeconds: number;
  athleteCount: number;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

const LEVEL_COLORS = {
  fast: {
    bg: 'bg-green-500/20',
    border: 'border-green-500/30',
    text: 'text-green-400',
    icon: 'text-green-400',
  },
  medium: {
    bg: 'bg-yellow-500/20',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    icon: 'text-yellow-400',
  },
  slow: {
    bg: 'bg-orange-500/20',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    icon: 'text-orange-400',
  },
};

const LEVEL_ICONS = {
  fast: Zap,
  medium: TrendingUp,
  slow: Activity,
};

function GroupCard({ group, onEdit, onDelete }: {
  group: Group;
  onEdit: (group: Group) => void;
  onDelete: (id: string) => void;
}) {
  const colors = LEVEL_COLORS[group.level];
  const Icon = LEVEL_ICONS[group.level];

  // Example base pace for preview (4:00/km)
  const exampleBasePaceSeconds = 240;
  const groupPaceSeconds = exampleBasePaceSeconds + group.paceOffsetSeconds;

  return (
    <div className={cn(
      "bg-slate-800 rounded-xl p-6 border transition-all hover:shadow-lg",
      colors.border
    )}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-3 rounded-lg", colors.bg)}>
            <Icon className={cn("h-6 w-6", colors.icon)} />
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
            onClick={() => onEdit(group)}
            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <Edit3 className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={() => onDelete(group.id)}
            className="bg-red-600/20 hover:bg-red-600/30 text-red-400 px-3 py-2 rounded-lg font-medium transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {/* Marathon Goal Display */}
        {group.marathonGoal && (
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm text-slate-400">Marathon Goal</span>
              <span className={cn("text-3xl font-bold font-mono", colors.text)}>
                {group.marathonGoal}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Target finish time for marathon training
            </div>
          </div>
        )}

        {/* Pace Offset Display */}
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm text-slate-400">Pace Offset</span>
            <span className={cn("text-2xl font-bold", colors.text)}>
              {group.paceOffsetSeconds > 0 ? '+' : ''}{group.paceOffsetSeconds}s/km
            </span>
          </div>
          <div className="text-xs text-slate-500">
            When coach writes base pace, this group gets adjusted pace
          </div>
        </div>

        {/* Example Preview */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="text-xs font-medium text-slate-400 mb-2">Example:</div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-300">Base pace:</span>
            <span className="font-mono font-bold text-white">{formatPace(exampleBasePaceSeconds)}/km</span>
            <span className="text-slate-500">→</span>
            <span className="text-slate-300">This group:</span>
            <span className={cn("font-mono font-bold", colors.text)}>{formatPace(groupPaceSeconds)}/km</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupEditModal({ group, onSave, onClose }: {
  group: Group | null;
  onSave: (group: Partial<Group> & { id: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name || '');
  const [paceOffsetSeconds, setPaceOffsetSeconds] = useState(group?.paceOffsetSeconds || 0);
  const [level, setLevel] = useState<'fast' | 'medium' | 'slow'>(group?.level || 'medium');
  const [marathonGoal, setMarathonGoal] = useState(group?.marathonGoal || '');

  useEffect(() => {
    if (group) {
      setName(group.name);
      setPaceOffsetSeconds(group.paceOffsetSeconds);
      setLevel(group.level);
      setMarathonGoal(group.marathonGoal || '');
    }
  }, [group]);

  if (!group) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ id: group.id, name, paceOffsetSeconds, level, marathonGoal });
  };

  const exampleBasePaceSeconds = 240;
  const resultPaceSeconds = exampleBasePaceSeconds + paceOffsetSeconds;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-semibold text-lg">Edit Group</h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Group Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., SUB 2:30"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Marathon Goal Time
            </label>
            <input
              type="text"
              value={marathonGoal}
              onChange={(e) => setMarathonGoal(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xl"
              placeholder="2:30:00"
            />
            <p className="text-xs text-slate-500 mt-1">
              Format: H:MM:SS (e.g., 2:30:00 for 2 hours 30 minutes)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Level (Visual Indicator)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['fast', 'medium', 'slow'] as const).map((lvl) => {
                const colors = LEVEL_COLORS[lvl];
                const Icon = LEVEL_ICONS[lvl];
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevel(lvl)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                      level === lvl
                        ? `${colors.bg} ${colors.border}`
                        : "bg-slate-900 border-slate-700 hover:border-slate-600"
                    )}
                  >
                    <Icon className={cn("h-5 w-5", level === lvl ? colors.icon : "text-slate-500")} />
                    <span className={cn(
                      "text-xs font-medium capitalize",
                      level === lvl ? colors.text : "text-slate-400"
                    )}>
                      {lvl}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Pace Offset (seconds per km)
            </label>
            <div className="relative">
              <input
                type="number"
                value={paceOffsetSeconds}
                onChange={(e) => setPaceOffsetSeconds(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-xl font-mono"
                placeholder="0"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                s/km
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setPaceOffsetSeconds(Math.max(-60, paceOffsetSeconds - 5))}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                -5s
              </button>
              <button
                type="button"
                onClick={() => setPaceOffsetSeconds(paceOffsetSeconds + 5)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                +5s
              </button>
              <button
                type="button"
                onClick={() => setPaceOffsetSeconds(paceOffsetSeconds + 10)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                +10s
              </button>
            </div>
          </div>

          {/* Live Preview */}
          <div className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4">
            <div className="text-xs font-medium text-primary-400 mb-2">Live Preview</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-300">Base:</span>
              <span className="font-mono font-bold text-white">{formatPace(exampleBasePaceSeconds)}/km</span>
              <span className="text-slate-500">→</span>
              <span className="text-slate-300">Group:</span>
              <span className="font-mono font-bold text-primary-400">{formatPace(resultPaceSeconds)}/km</span>
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
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupOffset, setNewGroupOffset] = useState(0);
  const [newGroupLevel, setNewGroupLevel] = useState<'fast' | 'medium' | 'slow'>('medium');
  const [newMarathonGoal, setNewMarathonGoal] = useState('');
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

  const createDefaultGroups = async () => {
    setSubmitting(true);
    try {
      const defaultGroups = [
        { name: 'SUB 2:30', paceOffsetSeconds: 0, level: 'fast', marathonGoal: '2:30:00' },
        { name: 'SUB 2:35', paceOffsetSeconds: 10, level: 'medium', marathonGoal: '2:35:00' },
        { name: 'SUB 2:45', paceOffsetSeconds: 20, level: 'slow', marathonGoal: '2:45:00' },
      ];

      for (const group of defaultGroups) {
        await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(group),
        });
      }

      fetchGroups();
    } catch (error) {
      console.error('Failed to create default groups:', error);
      alert('Failed to create default groups');
    } finally {
      setSubmitting(false);
    }
  };

  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setSubmitting(true);
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName,
          paceOffsetSeconds: newGroupOffset,
          level: newGroupLevel,
          marathonGoal: newMarathonGoal,
        }),
      });
      const data = await response.json();

      if (response.ok) {
        setNewGroupName('');
        setNewGroupOffset(0);
        setNewGroupLevel('medium');
        setNewMarathonGoal('');
        setShowCreateModal(false);
        fetchGroups();
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
        fetchGroups();
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pace Groups</h1>
          <p className="text-slate-400 mt-1">
            Manage athlete groups with pace offsets for multi-bracket workouts
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Group
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-gradient-to-r from-primary-500/10 to-purple-500/10 border border-primary-500/30 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="bg-primary-500/20 p-2 rounded-lg">
            <Layers className="h-5 w-5 text-primary-400" />
          </div>
          <div>
            <h3 className="font-semibold text-primary-400 mb-1">How Pace Groups Work</h3>
            <p className="text-sm text-slate-300 mb-2">
              Each group has a pace offset. When your workout has multi-bracket notation like <span className="font-mono text-primary-400">3:50 (4:00) ((4:10))</span>:
            </p>
            <ul className="text-sm text-slate-300 space-y-1 list-disc list-inside">
              <li>No brackets = fastest group (Group A) uses base pace</li>
              <li>(Single brackets) = middle group (Group B) adds their offset to base pace</li>
              <li>((Double brackets)) = slowest group (Group C) adds their offset to base pace</li>
            </ul>
          </div>
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
            <div className="bg-primary-500/20 p-2 rounded-lg">
              <Users className="h-5 w-5 text-primary-400" />
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
              <Activity className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {groups.length > 0 ? Math.max(...groups.map(g => Math.abs(g.paceOffsetSeconds))) : 0}s
              </p>
              <p className="text-xs text-slate-400">Max Pace Offset</p>
            </div>
          </div>
        </div>
      </div>

      {/* Runner Tracks Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold mb-1">Runner Tracks</h2>
          <p className="text-slate-400 text-sm">Two tracks for different levels of commitment</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Core Runners */}
          <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border border-purple-500/30 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="bg-purple-500/20 p-3 rounded-lg">
                <Trophy className="h-6 w-6 text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg text-purple-300 mb-1">Core Runners</h3>
                <p className="text-sm text-slate-300 mb-3">
                  The inner squad driving performance, culture, and operations
                </p>
                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                    <span>Performance-driven mindset</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                    <span>Lead team culture</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                    <span>Drive operations</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Community Runners */}
          <div className="bg-gradient-to-br from-primary-500/10 to-primary-600/10 border border-primary-500/30 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="bg-primary-500/20 p-3 rounded-lg">
                <Target className="h-6 w-6 text-primary-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg text-blue-300 mb-1">Community Runners</h3>
                <p className="text-sm text-slate-300 mb-3">
                  Train within the Madregot system and grow through the community
                </p>
                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400"></div>
                    <span>Access to team environment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400"></div>
                    <span>Madregot training system</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400"></div>
                    <span>Community growth</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Setup Banner - show when groups exist but aren't the 3 defaults */}
      {groups.length > 0 && groups.length < 3 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500/20 p-2 rounded-lg">
              <Layers className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <h3 className="font-semibold text-yellow-300 text-sm">Setup Madregot Groups</h3>
              <p className="text-xs text-slate-400">Create the 3 pace groups (SUB 2:30, SUB 2:35, SUB 2:45) for your athletes to choose from</p>
            </div>
          </div>
          <button
            onClick={createDefaultGroups}
            disabled={submitting}
            className="bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {submitting ? 'Creating...' : 'Create SUB 2:30 / 2:35 / 2:45'}
          </button>
        </div>
      )}

      {/* Groups Grid */}
      {groups.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              onEdit={setEditingGroup}
              onDelete={deleteGroup}
            />
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 text-center py-16">
          <div className="bg-slate-700/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Layers className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No groups yet</h3>
          <p className="text-slate-400 mb-6">
            Create pace groups to support multi-bracket workout notation
          </p>
          <button
            onClick={createDefaultGroups}
            disabled={submitting}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Layers className="h-4 w-4" />
            {submitting ? 'Creating...' : 'Create Default Groups (SUB 2:30, SUB 2:35, SUB 2:45)'}
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingGroup && (
        <GroupEditModal
          group={editingGroup}
          onSave={updateGroup}
          onClose={() => setEditingGroup(null)}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-lg">Create New Group</h3>
              <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-slate-700 rounded transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={addGroup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Group Name
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="e.g., SUB 2:30"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Marathon Goal Time
                </label>
                <input
                  type="text"
                  value={newMarathonGoal}
                  onChange={(e) => setNewMarathonGoal(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xl"
                  placeholder="2:30:00"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Format: H:MM:SS (e.g., 2:30:00 for 2 hours 30 minutes)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Level (Visual Indicator)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['fast', 'medium', 'slow'] as const).map((lvl) => {
                    const colors = LEVEL_COLORS[lvl];
                    const Icon = LEVEL_ICONS[lvl];
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setNewGroupLevel(lvl)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                          newGroupLevel === lvl
                            ? `${colors.bg} ${colors.border}`
                            : "bg-slate-900 border-slate-700 hover:border-slate-600"
                        )}
                      >
                        <Icon className={cn("h-5 w-5", newGroupLevel === lvl ? colors.icon : "text-slate-500")} />
                        <span className={cn(
                          "text-xs font-medium capitalize",
                          newGroupLevel === lvl ? colors.text : "text-slate-400"
                        )}>
                          {lvl}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Pace Offset (seconds per km)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={newGroupOffset}
                    onChange={(e) => setNewGroupOffset(parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500 text-center text-xl font-mono"
                    placeholder="0"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                    s/km
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setNewGroupOffset(0)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                  >
                    0s
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGroupOffset(10)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                  >
                    +10s
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGroupOffset(20)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                  >
                    +20s
                  </button>
                </div>
              </div>

              {/* Live Preview */}
              <div className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-4">
                <div className="text-xs font-medium text-primary-400 mb-2">Preview</div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-300">Base:</span>
                  <span className="font-mono font-bold text-white">4:00/km</span>
                  <span className="text-slate-500">→</span>
                  <span className="text-slate-300">Group:</span>
                  <span className="font-mono font-bold text-primary-400">{formatPace(240 + newGroupOffset)}/km</span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

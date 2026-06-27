'use client';

import { useState, useEffect } from 'react';
import { Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Group {
  id: string;
  name: string;
  athlete_count: number;
}

interface GroupSelectorProps {
  coachId: string;
  selectedGroupIds: string[];
  onSelectionChange: (groupIds: string[]) => void;
}

/**
 * GroupSelector - A checkbox list of available groups with athlete counts.
 * Coach selects which groups to push workouts to.
 */
export function GroupSelector({ coachId, selectedGroupIds, onSelectionChange }: GroupSelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGroups() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/groups?coach_id=${coachId}`);
        if (!res.ok) {
          throw new Error('Failed to fetch groups');
        }

        const data = await res.json();
        setGroups(data.groups || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchGroups();
  }, [coachId]);

  const toggleGroup = (groupId: string) => {
    if (selectedGroupIds.includes(groupId)) {
      onSelectionChange(selectedGroupIds.filter(id => id !== groupId));
    } else {
      onSelectionChange([...selectedGroupIds, groupId]);
    }
  };

  const selectAll = () => {
    onSelectionChange(groups.map(g => g.id));
  };

  const selectNone = () => {
    onSelectionChange([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading groups...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <Users className="h-8 w-8 mx-auto mb-2 text-slate-500" />
        <p>No groups found. Create groups first to organize your athletes.</p>
      </div>
    );
  }

  const totalAthletes = groups
    .filter(g => selectedGroupIds.includes(g.id))
    .reduce((sum, g) => sum + g.athlete_count, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Select Groups</label>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="text-xs text-primary-400 hover:text-primary-300"
          >
            Select All
          </button>
          <span className="text-slate-600">|</span>
          <button
            onClick={selectNone}
            className="text-xs text-slate-400 hover:text-slate-300"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {groups.map(group => (
          <label
            key={group.id}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors',
              selectedGroupIds.includes(group.id)
                ? 'bg-primary-500/10 border-primary-500/50'
                : 'bg-slate-700/50 border-slate-600 hover:border-slate-500'
            )}
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
                className="w-4 h-4 text-primary-600 bg-slate-700 border-slate-500 rounded focus:ring-primary-500"
              />
              <div>
                <div className="font-medium">{group.name}</div>
                <div className="text-xs text-slate-400">
                  {group.athlete_count} athlete{group.athlete_count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      {selectedGroupIds.length > 0 && (
        <div className="bg-slate-700/50 rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Selected athletes:</span>
            <span className="font-semibold text-primary-400">{totalAthletes}</span>
          </div>
        </div>
      )}
    </div>
  );
}

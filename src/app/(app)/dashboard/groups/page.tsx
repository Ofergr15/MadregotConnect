'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Trophy, Edit3, ChevronDown, ChevronUp, Medal, Watch, Flame, User } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';
import {
  SegmentedControl, Sheet, Button, Card, EmptyState,
  Skeleton, SkeletonCard, SkeletonList, InsetSection, InsetRow,
} from '@/components/ui';
import { bearerHeaders } from '@/lib/auth/bearer-headers';

interface Athlete {
  id: string;
  name: string;
  email: string;
  status: string;
  hasGarmin?: boolean;
  hasStrava?: boolean;
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
  weekStreak: number;
}

type LeaderboardMetric = 'distance' | 'streak' | 'runs';

const GROUP_COLORS: Record<number, { bg: string; border: string; text: string; badge: string; dot: string }> = {
  0: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-400', badge: 'bg-green-500/20', dot: 'bg-green-400' },
  1: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', badge: 'bg-yellow-500/20', dot: 'bg-yellow-400' },
  2: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400', badge: 'bg-orange-500/20', dot: 'bg-orange-400' },
};

function getGroupColors(index: number) {
  return GROUP_COLORS[index] || GROUP_COLORS[0];
}

export default function GroupsPage() {
  const t = useTranslations('groups');
  const tm = useTranslations('momentum'); // reuse the weekStreak/weekStreakOne wording from the momentum card
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardByStreak, setLeaderboardByStreak] = useState<LeaderboardEntry[]>([]);
  const [leaderboardByRuns, setLeaderboardByRuns] = useState<LeaderboardEntry[]>([]);
  const [groupLeaderboards, setGroupLeaderboards] = useState<Record<string, LeaderboardEntry[]>>({});
  const [activeTab, setActiveTab] = useState<'members' | 'leaderboard'>('members');
  const [metric, setMetric] = useState<LeaderboardMetric>('distance');

  useEffect(() => {
    fetchGroups();
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      // requireMember on the route — the bearer header is what carries identity.
      // false = no JSON Content-Type; this is a GET with no body.
      const response = await fetch('/api/groups/leaderboard', { headers: await bearerHeaders(false) });
      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
      setLeaderboardByStreak(data.leaderboardByStreak || []);
      setLeaderboardByRuns(data.leaderboardByRuns || []);
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
        headers: await bearerHeaders(),
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
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <SkeletonList count={3} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">{t('title')}</h1>
        <p className="text-slate-400 mt-1">
          {totalAthletes} {t('athletesAcross')} {groups.length} {t('groups')}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map((group, idx) => {
          const colors = getGroupColors(idx);
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
              className="text-start w-full"
            >
              <Card
                variant="muted"
                className={cn('transition-all hover:scale-[1.02] active:scale-[0.98]', colors.bg, colors.border)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={cn("text-lg font-bold", colors.text)}>{group.name}</span>
                  <span className={cn("text-xs px-2 py-1 rounded-full font-medium", colors.badge, colors.text)}>
                    {group.athleteCount} {t('runners')}
                  </span>
                </div>
                {group.marathonGoal && (
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Trophy className="h-4 w-4 text-yellow-400" />
                    <span className="font-mono">{group.marathonGoal}</span>
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-1">
                  {t('paceOffset')}: {group.paceOffsetSeconds > 0 ? '+' : ''}{group.paceOffsetSeconds}s/km
                </div>
              </Card>
            </button>
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
                      {group.athleteCount} {t('athletes')}
                      {group.marathonGoal && ` · Goal: ${group.marathonGoal}`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingGroup(group); }}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] hover:bg-slate-700 active:scale-[0.92] rounded-lg transition-all"
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
                    <InsetSection className="mt-4 mb-0">
                      {group.athletes.map((athlete) => (
                        <InsetRow
                          key={athlete.id}
                          icon={User}
                          iconBg={colors.badge}
                          label={athlete.name}
                          sublabel={athlete.email}
                          trailing={
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full font-medium",
                                athlete.hasGarmin
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-slate-600/30 text-slate-500'
                              )}>
                                <Watch className="h-3 w-3" />
                                {athlete.hasGarmin ? t('garminConnected') : t('notConnected')}
                              </span>
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full",
                                athlete.status === 'active'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-slate-600/30 text-slate-400'
                              )}>
                                {athlete.status}
                              </span>
                            </div>
                          }
                        />
                      ))}
                    </InsetSection>
                  ) : (
                    <EmptyState
                      icon={Users}
                      title={t('noAthletesYet')}
                      description={t('assignAthletes')}
                      className="mt-4 py-8"
                    />
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
            <h2 className="text-xl font-bold">{t('weeklyLeaderboard')}</h2>
          </div>
          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { value: 'members', label: t('byGroup') },
              { value: 'leaderboard', label: t('overall') },
            ]}
            className="w-fit"
          />
        </div>

        {activeTab === 'leaderboard' ? (
          <div className="space-y-3">
            {/* Metric switcher — Overall ranking by distance / streak / run count,
                all three pre-computed by the API in a single request so switching
                tabs is instant (no refetch). */}
            <SegmentedControl
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'distance', label: t('byDistance') },
                { value: 'streak', label: t('byStreak') },
                { value: 'runs', label: t('byRuns') },
              ]}
              className="self-start w-fit"
            />

            <Card variant="solid" className="!p-0 overflow-hidden">
              {(() => {
                const activeList = metric === 'streak' ? leaderboardByStreak
                  : metric === 'runs' ? leaderboardByRuns
                  : leaderboard;
                return activeList.length > 0 ? (
                  <div className="divide-y divide-slate-700/50">
                    {activeList.map((entry, idx) => {
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
                            {metric === 'streak' ? (
                              <span className="font-bold font-mono text-white flex items-center gap-1">
                                <Flame className="h-4 w-4 text-orange-400" />
                                {entry.weekStreak} {entry.weekStreak === 1 ? tm('weekStreakOne') : tm('weekStreak')}
                              </span>
                            ) : metric === 'runs' ? (
                              <>
                                <span className="text-slate-400">{entry.distanceKm} {t('km')}</span>
                                <span className="font-bold font-mono text-white">{entry.runs} {t('runs')}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-slate-400">{entry.runs} {t('runs')}</span>
                                <span className="font-bold font-mono text-white">{entry.distanceKm} {t('km')}</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <Trophy className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">{metric === 'streak' ? t('noStreaks') : t('noActivityData')}</p>
                    <p className="text-xs text-slate-400 mt-1">{t('leaderboardWillPopulate')}</p>
                  </div>
                );
              })()}
            </Card>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group, idx) => {
              const colors = getGroupColors(idx);
              const entries = groupLeaderboards[group.id] || [];
              const groupTotal = entries.reduce((sum, e) => sum + e.distanceKm, 0);
              return (
                <div key={group.id} className={cn("rounded-2xl border overflow-hidden", colors.border)}>
                  <div className={cn("px-4 py-3 flex items-center justify-between", colors.bg)}>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2.5 h-2.5 rounded-full", colors.dot)} />
                      <span className={cn("font-semibold", colors.text)}>{group.name}</span>
                    </div>
                    <span className="text-sm text-slate-300 font-mono">
                      {Math.round(groupTotal * 10) / 10} {t('kmTotal')}
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
                            <span className="text-slate-500">{entry.runs} {t('runs')}</span>
                            <span className="font-mono font-medium">{entry.distanceKm} {t('km')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 bg-slate-800/60 text-center">
                      <p className="text-xs text-slate-500">{t('noActivities')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {groups.length === 0 && (
        <EmptyState icon={Users} title={t('noGroups')} description={t('groupsWillAppear')} className="py-16" />
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
  const t = useTranslations('groups');
  const [name, setName] = useState(group.name);
  const [paceOffsetSeconds, setPaceOffsetSeconds] = useState(group.paceOffsetSeconds);
  const [marathonGoal, setMarathonGoal] = useState(group.marathonGoal || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ id: group.id, name, paceOffsetSeconds, marathonGoal });
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} title={`${t('edit')} ${group.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4 px-1 pb-2">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">{t('groupName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[44px] bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">{t('marathonGoal')}</label>
          <input
            type="text"
            value={marathonGoal}
            onChange={(e) => setMarathonGoal(e.target.value)}
            className="w-full min-h-[44px] bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 font-mono text-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="2:30:00"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">{t('paceOffsetLabel')}</label>
          <input
            type="number"
            value={paceOffsetSeconds}
            onChange={(e) => setPaceOffsetSeconds(parseInt(e.target.value) || 0)}
            className="w-full min-h-[44px] bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-center font-mono text-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="mt-2 text-xs text-slate-500">
            {t('paceOffsetPreview', { pace: `${formatPace(240 + paceOffsetSeconds)}/km` })}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            {t('cancel')}
          </Button>
          <Button type="submit" className="flex-1">
            {t('save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

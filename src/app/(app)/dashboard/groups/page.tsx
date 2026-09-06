'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { Users, Trophy, Edit3, ChevronDown, ChevronUp, Medal, Watch, Flame, User } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { cn, getGroupPanel } from '@/lib/utils';
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

// `status` arrives as a bare string, so translate only the four we have words
// for and print anything else as-is rather than rendering a missing key path.
const ATHLETE_STATUSES = ['active', 'invited', 'paused', 'disconnected'];

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


export default function GroupsPage() {
  const t = useTranslations('groups');
  // The four athlete statuses are already written in Hebrew under `athletes`;
  // this page was printing the raw DB enum instead.
  const ta = useTranslations('athletes');
  const tm = useTranslations('momentum'); // reuse the weekStreak/weekStreakOne wording from the momentum card
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'leaderboard'>('members');
  const [metric, setMetric] = useState<LeaderboardMetric>('distance');

  // Both reads go through useApi rather than the useEffect+fetch+useState triads
  // this page used to run. Not only for the SWR cache and the dedupe: the plain
  // `fetch('/api/groups')` sent NO Authorization header at all, and neither call
  // had the one-shot 401 recovery that apiFetcher does, so a token that expired
  // while the tab sat open left this screen permanently empty until a reload.
  const { data: groupsData, isLoading, mutate: refreshGroups } = useApi<{ groups: Group[] }>('/api/groups');
  const { data: lb } = useApi<{
    leaderboard: LeaderboardEntry[];
    leaderboardByStreak: LeaderboardEntry[];
    leaderboardByRuns: LeaderboardEntry[];
    groupLeaderboards: Record<string, LeaderboardEntry[]>;
  }>('/api/groups/leaderboard');

  const groups = groupsData?.groups ?? [];
  const loading = isLoading;
  const leaderboard = lb?.leaderboard ?? [];
  const leaderboardByStreak = lb?.leaderboardByStreak ?? [];
  const leaderboardByRuns = lb?.leaderboardByRuns ?? [];
  const groupLeaderboards = lb?.groupLeaderboards ?? {};

  // First group open by default. It was previously set inside the fetch, which
  // is why it needed the `!expandedGroup` guard — from here the effect only
  // re-runs when the group list itself changes.
  useEffect(() => {
    if (groups.length > 0 && !expandedGroup) setExpandedGroup(groups[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  const updateGroup = async (updates: Partial<Group> & { id: string }) => {
    try {
      const response = await fetch('/api/groups', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        setEditingGroup(null);
        refreshGroups();
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
        {/* One interpolated string, not four glued children: JSX inserts a space
            between each, so the Hebrew read "ספורטאים ב- 3 קבוצות" — a prefix
            severed from the number it attaches to. */}
        <p className="text-ink-400 mt-1">
          {t('athletesAcrossGroups', { athletes: totalAthletes, groups: groups.length })}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {groups.map((group, idx) => {
          const colors = getGroupPanel(idx);
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
                  <div className="flex items-center gap-2 text-sm text-ink-500">
                    <Trophy className="h-4 w-4 text-band-3" />
                    <span className="font-mono">{group.marathonGoal}</span>
                  </div>
                )}
                {/* ink-500, not ink-400: this caption sits on the squad card's
                    own `bg-band-N/10` wash rather than on the page, which is
                    darker than either surface ink-400 is derived against and
                    left it at 4.32-4.40:1. */}
                <div className="text-xs text-ink-500 mt-1">
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
          const colors = getGroupPanel(idx);
          const isExpanded = expandedGroup === group.id;

          return (
            <div
              key={group.id}
              className={cn(
                "rounded-xl border overflow-hidden transition-all",
                colors.border,
                isExpanded ? 'bg-card/80' : 'bg-card/40'
              )}
            >
              {/* Group Header.

                  The expand control is an `absolute inset-0` button UNDER the
                  row rather than a <button> wrapping it, because the edit
                  control is also a button and `<button>` inside `<button>` is
                  invalid HTML: React was logging a real hydration error here
                  ("In HTML, <button> cannot be a descendant of <button>") —
                  the only application-level console error found anywhere in
                  the app. Safari and screen readers both treat the nesting
                  inconsistently, and `stopPropagation` only papered over the
                  click, not the invalid tree.

                  This keeps the whole row tappable and the layout
                  pixel-identical: the content sits on top with
                  `pointer-events-none`, and the edit button re-enables its own
                  pointer events so it still wins the tap. */}
              <div className="relative">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={group.name}
                  className="absolute inset-0 w-full"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                />
                <div className="pointer-events-none relative w-full flex items-center justify-between p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-3 h-3 rounded-full", colors.dot)} />
                    <div className="text-left">
                      <h3 className="text-lg font-semibold">{group.name}</h3>
                      <span className="text-sm text-ink-400">
                        {group.athleteCount} {t('athletes')}
                        {group.marathonGoal && ` · ${t('goal')}: ${group.marathonGoal}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={t('editGroup')}
                      onClick={() => setEditingGroup(group)}
                      className="pointer-events-auto flex items-center justify-center min-w-[44px] min-h-[44px] hover:bg-page active:scale-[0.92] rounded-lg transition-all"
                    >
                      <Edit3 className="h-4 w-4 text-ink-400" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-ink-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-ink-400" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Content - Athlete List */}
              {isExpanded && (
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-page/50">
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
                                  ? 'bg-accent-600/20 text-accent-900'
                                  : 'bg-ink-300/30 text-ink-400'
                              )}>
                                <Watch className="h-3 w-3" />
                                {athlete.hasGarmin ? t('garminConnected') : t('notConnected')}
                              </span>
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full",
                                athlete.status === 'active'
                                  ? 'bg-accent-600/20 text-accent-900'
                                  : 'bg-ink-300/30 text-ink-400'
                              )}>
                                {ATHLETE_STATUSES.includes(athlete.status)
                                  ? ta(athlete.status as 'active')
                                  : athlete.status}
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
            <Medal className="h-5 w-5 text-band-3" />
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
                  <div className="divide-y divide-page/50">
                    {activeList.map((entry, idx) => {
                      const groupIdx = groups.findIndex(g => g.id === entry.groupId);
                      const colors = groupIdx >= 0 ? getGroupPanel(groupIdx) : { dot: 'bg-ink-300', text: 'text-ink-400' };
                      return (
                        <div key={entry.id} className="flex items-center justify-between px-4 py-3 hover:bg-page/30 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold",
                              idx === 0 ? 'bg-band-3/20 text-band-3-ink' :
                              idx === 1 ? 'bg-ink-300/20 text-ink-500' :
                              idx === 2 ? 'bg-band-3/20 text-band-3-ink' :
                              'bg-page text-ink-400'
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
                              <span className="font-bold font-mono text-ink-700 flex items-center gap-1">
                                <Flame className="h-4 w-4 text-band-3" />
                                {entry.weekStreak} {entry.weekStreak === 1 ? tm('weekStreakOne') : tm('weekStreak')}
                              </span>
                            ) : metric === 'runs' ? (
                              <>
                                <span className="text-ink-400">{entry.distanceKm} {t('km')}</span>
                                <span className="font-bold font-mono text-ink-700">{entry.runs} {t('runs')}</span>
                              </>
                            ) : (
                              <>
                                <span className="text-ink-400">{entry.runs} {t('runs')}</span>
                                <span className="font-bold font-mono text-ink-700">{entry.distanceKm} {t('km')}</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-10">
                    <Trophy className="h-8 w-8 text-ink-400 mx-auto mb-2" />
                    <p className="text-sm text-ink-400">{metric === 'streak' ? t('noStreaks') : t('noActivityData')}</p>
                    <p className="text-xs text-ink-400 mt-1">{t('leaderboardWillPopulate')}</p>
                  </div>
                );
              })()}
            </Card>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group, idx) => {
              const colors = getGroupPanel(idx);
              const entries = groupLeaderboards[group.id] || [];
              const groupTotal = entries.reduce((sum, e) => sum + e.distanceKm, 0);
              return (
                <div key={group.id} className={cn("rounded-2xl border overflow-hidden", colors.border)}>
                  <div className={cn("px-4 py-3 flex items-center justify-between", colors.bg)}>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2.5 h-2.5 rounded-full", colors.dot)} />
                      <span className={cn("font-semibold", colors.text)}>{group.name}</span>
                    </div>
                    <span className="text-sm text-ink-500 font-mono">
                      {Math.round(groupTotal * 10) / 10} {t('kmTotal')}
                    </span>
                  </div>
                  {entries.length > 0 ? (
                    <div className="divide-y divide-page/30">
                      {entries.map((entry, entryIdx) => (
                        <div key={entry.id} className="flex items-center justify-between px-4 py-2.5 bg-card/60">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-ink-400 w-4">{entryIdx + 1}.</span>
                            <span className="text-sm">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-ink-400">{entry.runs} {t('runs')}</span>
                            <span className="font-mono font-medium">{entry.distanceKm} {t('km')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 bg-card/60 text-center">
                      <p className="text-xs text-ink-400">{t('noActivities')}</p>
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
          <label className="block text-sm font-medium text-ink-500 mb-2">{t('groupName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full min-h-[44px] bg-page border border-ink-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-brand-600"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-500 mb-2">{t('marathonGoal')}</label>
          <input
            type="text"
            value={marathonGoal}
            onChange={(e) => setMarathonGoal(e.target.value)}
            className="w-full min-h-[44px] bg-page border border-ink-300 rounded-lg px-4 py-3 font-mono text-xl focus:outline-none focus:ring-2 focus:ring-brand-600"
            placeholder="2:30:00"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-500 mb-2">{t('paceOffsetLabel')}</label>
          <input
            type="number"
            value={paceOffsetSeconds}
            onChange={(e) => setPaceOffsetSeconds(parseInt(e.target.value) || 0)}
            className="w-full min-h-[44px] bg-page border border-ink-300 rounded-lg px-4 py-3 text-center font-mono text-xl focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <div className="mt-2 text-xs text-ink-400">
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

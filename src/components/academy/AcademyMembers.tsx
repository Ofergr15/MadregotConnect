'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Search, UserPlus, Users, Watch, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, EmptyState, SegmentedControl, SkeletonList } from '@/components/ui';
import {
  ATTENTION_ORDER, ATTENTION_STYLE, fmtRate, initialsOf, rateColor,
  type AcademyMember, type AcademyMembersResponse,
} from './types';

// The member directory — "he should see all the members", so this is the tab
// that has to hold up at a few dozen names without turning into a scroll hunt.
//
// What the old roster gave you per row: a name, a group chip, a watch glyph, and
// a remove button. What it could not answer without leaving the tab: did this
// person train this week, and are they keeping up with their plan. Both are on
// the row now, and the row opens the full drill-in.

type SortKey = 'week' | 'adherence' | 'name';
type FilterKey = 'all' | 'attention' | 'active' | 'nowatch';

export function AcademyMembers({
  data,
  isLoading,
  onSelectMember,
  onAdd,
}: {
  data: AcademyMembersResponse | undefined;
  isLoading: boolean;
  onSelectMember: (member: AcademyMember) => void;
  /** Omitted for a coach who may view the academy but not change its roster. */
  onAdd?: () => void;
}) {
  const t = useTranslations('academy');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('week');

  const members = data?.members ?? [];
  const groups = data?.groups ?? [];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = members;
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
    if (groupId) {
      // '__none__' is the unassigned bucket, which is a real filter a manager
      // wants: "who still has no group?"
      list = groupId === '__none__' ? list.filter((m) => !m.groupId) : list.filter((m) => m.groupId === groupId);
    }
    if (filter === 'attention') list = list.filter((m) => m.attention.length > 0);
    else if (filter === 'active') list = list.filter((m) => m.weekRuns > 0);
    else if (filter === 'nowatch') list = list.filter((m) => !m.hasWatch);

    const sorted = [...list];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'adherence') {
      // Members with no plan sort last rather than as 0% — they aren't the worst
      // adherence in the academy, they're a different problem.
      sorted.sort((a, b) => {
        const ax = a.completionRate, bx = b.completionRate;
        if (ax === null && bx === null) return a.name.localeCompare(b.name);
        if (ax === null) return 1;
        if (bx === null) return -1;
        return ax - bx || a.name.localeCompare(b.name);
      });
    } else sorted.sort((a, b) => b.weekKm - a.weekKm || a.name.localeCompare(b.name));
    return sorted;
  }, [members, query, filter, groupId, sort]);

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: t('filterAll'), count: members.length },
    { key: 'attention', label: t('filterAttention'), count: members.filter((m) => m.attention.length > 0).length },
    { key: 'active', label: t('filterActive'), count: members.filter((m) => m.weekRuns > 0).length },
    { key: 'nowatch', label: t('filterNoWatch'), count: members.filter((m) => !m.hasWatch).length },
  ];

  if (isLoading && !data) return <SkeletonList count={8} />;

  if (members.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState icon={Users} title={t('noAthletesYet')} description={t('noAthletesDesc')} />
        {onAdd && (
          <button
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white hover:bg-primary-500 active:scale-[0.99] transition-all min-h-[44px]"
          >
            <UserPlus className="h-4 w-4" /> {t('addAthlete')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="auto">
      {/* Search is always visible, not behind a toggle — at academy scale it's
          the primary way anyone finds one athlete. */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchMembers')}
          className="w-full rounded-xl bg-slate-800/80 border border-slate-700 ps-10 pe-10 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white"
            aria-label={t('clear')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter chips carry their counts, so "3 need attention" is legible
          before you tap in and lose the comparison. */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
              filter === f.key
                ? 'bg-primary-600 border-primary-500 text-white'
                : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800',
            )}
          >
            {f.label} <span className={cn('tabular-nums', filter === f.key ? 'text-white/70' : 'text-slate-500')}>{f.count}</span>
          </button>
        ))}
      </div>

      {groups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          <button
            onClick={() => setGroupId(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
              groupId === null
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800',
            )}
          >
            {t('allGroups')}
          </button>
          {groups.map((g) => {
            const key = g.groupId ?? '__none__';
            return (
              <button
                key={key}
                onClick={() => setGroupId(groupId === key ? null : key)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
                  groupId === key
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'bg-slate-800/70 border-slate-700 text-slate-300 hover:bg-slate-800',
                )}
              >
                {g.groupName || t('unassigned')} <span className="text-slate-500 tabular-nums">{g.members}</span>
              </button>
            );
          })}
        </div>
      )}

      <SegmentedControl
        value={sort}
        onChange={setSort}
        options={[
          { value: 'week', label: t('sortWeekKm') },
          { value: 'adherence', label: t('sortAdherence') },
          { value: 'name', label: t('sortName') },
        ]}
      />

      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-xs text-slate-500">{t('showingCount', { shown: shown.length, total: members.length })}</span>
        {onAdd && (
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-semibold text-primary-400 hover:text-primary-300 min-h-[32px]">
            <UserPlus className="h-3.5 w-3.5" /> {t('addAthlete')}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <Card variant="muted">
          <p className="text-sm text-slate-400 text-center py-4">{t('noMatches')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => (
            <button
              key={m.athleteId}
              onClick={() => onSelectMember(m)}
              className="w-full flex items-center gap-3 rounded-2xl bg-slate-800/50 border border-slate-700/50 p-3 text-start hover:bg-slate-800/80 active:scale-[0.99] transition-all"
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center text-xs font-bold text-primary-300 shrink-0">
                  {initialsOf(m.name)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-white truncate">{m.name}</span>
                  {!m.hasWatch && <Watch className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                  {m.attention.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {m.groupName && (
                    <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20">
                      {m.groupName}
                    </span>
                  )}
                  {/* Only the single worst reason on the row — the sheet lists them
                      all. A row wearing four badges stops being scannable. */}
                  {m.attention.length > 0 && (() => {
                    const worst = ATTENTION_ORDER.find((r) => m.attention.includes(r))!;
                    return (
                      <span className={cn('text-3xs font-semibold px-1.5 py-0.5 rounded border', ATTENTION_STYLE[worst])}>
                        {t(`reason_${worst}`)}
                        {m.attention.length > 1 && ` +${m.attention.length - 1}`}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="text-end shrink-0 w-14">
                <div className="text-sm font-bold text-white tabular-nums leading-none">{m.weekKm.toFixed(1)}</div>
                <div className="text-3xs text-slate-500 mt-0.5">{t('kmUnit')}</div>
              </div>
              <div className="text-end shrink-0 w-11">
                <div className={cn('text-sm font-bold tabular-nums leading-none', rateColor(m.completionRate))}>
                  {fmtRate(m.completionRate)}
                </div>
                <div className="text-3xs text-slate-500 mt-0.5">
                  {m.plannedCount > 0 ? `${m.completedCount}/${m.plannedCount}` : t('noPlanShort')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

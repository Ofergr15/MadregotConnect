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
type FilterKey = 'all' | 'attention' | 'active' | 'nowatch' | 'nocoach';

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
  const [coachId, setCoachId] = useState<string | null>(null);
  const [bandId, setBandId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('week');

  // Memoised, not `data?.members ?? []`: the two memos below both depend on it,
  // and a fresh `[]` on every render made neither of them memoise anything.
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const groups = data?.groups ?? [];
  const coaches = data?.coaches ?? [];
  // A coach's payload is already only their own trainees, so filtering it by
  // coach, or telling them how many of the academy's trainees are unpaired,
  // would be answering a question they can't see the whole of.
  const isManagerView = data?.scope === 'academy';
  const unpaired = members.filter((m) => !m.academyCoachId).length;

  // The goal bands (דבוקות) as chips — but only the buckets that actually hold
  // someone, which is the rule `rollupGroups` already follows. 077 seeds six, and
  // a rail of six zeroes is noise; "דבוקה 7 · 4" is the academy's own way of
  // reading its roster. The unbanded bucket comes last, as an exception list.
  const bandChips = useMemo(() => {
    const chips = (data?.bands ?? [])
      .filter((b) => (b.trainees ?? 0) > 0)
      .map((b) => ({ key: b.id, label: b.name, count: b.trainees ?? 0 }));
    const unbanded = members.filter((m) => !m.band).length;
    if (unbanded > 0) chips.push({ key: '__none__', label: t('noBand'), count: unbanded });
    return chips;
  }, [data?.bands, members, t]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = members;
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
    if (groupId) {
      // '__none__' is the unassigned bucket, which is a real filter a manager
      // wants: "who still has no group?"
      list = groupId === '__none__' ? list.filter((m) => !m.groupId) : list.filter((m) => m.groupId === groupId);
    }
    if (coachId) {
      list = coachId === '__none__'
        ? list.filter((m) => !m.academyCoachId)
        : list.filter((m) => m.academyCoachId === coachId);
    }
    if (bandId) {
      list = bandId === '__none__'
        ? list.filter((m) => !m.band)
        : list.filter((m) => m.band?.id === bandId);
    }
    if (filter === 'attention') list = list.filter((m) => m.attention.length > 0);
    else if (filter === 'active') list = list.filter((m) => m.weekRuns > 0);
    else if (filter === 'nowatch') list = list.filter((m) => !m.hasWatch);
    else if (filter === 'nocoach') list = list.filter((m) => !m.academyCoachId);

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
  }, [members, query, filter, groupId, coachId, bandId, sort]);

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: t('filterAll'), count: members.length },
    { key: 'attention', label: t('filterAttention'), count: members.filter((m) => m.attention.length > 0).length },
    { key: 'active', label: t('filterActive'), count: members.filter((m) => m.weekRuns > 0).length },
    { key: 'nowatch', label: t('filterNoWatch'), count: members.filter((m) => !m.hasWatch).length },
    // Only offered once there is something to find: a chip reading "No coach 0"
    // is a filter nobody needs, and before the academy names its coaches it
    // would read as an alarm rather than a task.
    ...(isManagerView && unpaired > 0
      ? [{ key: 'nocoach' as FilterKey, label: t('filterNoCoach'), count: unpaired }]
      : []),
  ];

  if (isLoading && !data) return <SkeletonList count={8} />;

  if (members.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState icon={Users} title={t('noAthletesYet')} description={t('noAthletesDesc')} />
        {onAdd && (
          <button
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 active:scale-[0.99] transition-all min-h-[44px]"
          >
            <UserPlus className="h-4 w-4" /> {t('addAthlete')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3" dir="auto">
      {/* The manager's one standing job in a 1:1 academy: an unpaired trainee has
          nobody writing their plan and nobody meeting them, so it's said once at
          the top rather than only as a badge you have to scroll to find. */}
      {isManagerView && unpaired > 0 && filter !== 'nocoach' && (
        <button
          onClick={() => { setFilter('nocoach'); setCoachId(null); }}
          className="w-full flex items-center gap-2.5 rounded-2xl bg-band-2/10 border border-band-2/25 px-3 py-2.5 text-start hover:bg-band-2/15 active:scale-[0.99] transition-all min-h-[44px]"
        >
          <AlertTriangle className="h-4 w-4 text-band-2 shrink-0" />
          <span className="flex-1 text-xs font-semibold text-band-2">
            {t('unpairedBanner', { count: unpaired })}
          </span>
          <span className="text-xs font-bold text-band-2 shrink-0">{t('unpairedBannerAction')}</span>
        </button>
      )}

      {/* Search is always visible, not behind a toggle — at academy scale it's
          the primary way anyone finds one athlete. */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchMembers')}
          className="w-full rounded-xl bg-card/80 border border-page ps-10 pe-10 py-3 text-sm text-ink-700 placeholder:text-ink-400 focus:outline-none focus:border-brand-600"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute end-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-400 hover:text-ink-900"
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
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-card/70 border-page text-ink-500 hover:bg-page',
            )}
          >
            {f.label} <span className={cn('tabular-nums', filter === f.key ? 'text-ink-700/70' : 'text-ink-400')}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* By coach — the manager's real lens on a 1:1 academy, since "how is ענת's
          caseload doing?" is a question about a person, not a pace band. Counts
          include a coach holding nobody: spare hours are what a manager looks
          for when the next trainee enrols. */}
      {isManagerView && coaches.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          <button
            onClick={() => setCoachId(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
              coachId === null
                ? 'bg-band-2 border-band-2 text-white'
                : 'bg-card/70 border-page text-ink-500 hover:bg-page',
            )}
          >
            {t('allCoaches')}
          </button>
          {coaches.map((c) => {
            const key = c.coachId ?? '__none__';
            return (
              <button
                key={key}
                onClick={() => { setCoachId(coachId === key ? null : key); setFilter('all'); }}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
                  coachId === key
                    ? 'bg-band-2 border-band-2 text-white'
                    : 'bg-card/70 border-page text-ink-500 hover:bg-page',
                )}
              >
                {c.coachName || t('noCoach')}{' '}
                <span className={cn('tabular-nums', coachId === key ? 'text-ink-700/70' : 'text-ink-400')}>
                  {c.trainees}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* By goal band — what the academy is actually organised around, since it's
          coached online and 1:1, so "who is training for a half?" is a real
          question and "who trains on Tuesday at 17:30" is not one this academy
          asks. Distinct from the club-group rail below: a trainee can be in both. */}
      {bandChips.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          <button
            onClick={() => setBandId(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
              bandId === null
                ? 'bg-accent-600 border-accent-600 text-white'
                : 'bg-card/70 border-page text-ink-500 hover:bg-page',
            )}
          >
            {t('allBands')}
          </button>
          {bandChips.map((b) => (
            <button
              key={b.key}
              onClick={() => { setBandId(bandId === b.key ? null : b.key); setFilter('all'); }}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
                bandId === b.key
                  ? 'bg-accent-600 border-accent-600 text-white'
                  : 'bg-card/70 border-page text-ink-500 hover:bg-page',
              )}
            >
              {b.label}{' '}
              <span className={cn('tabular-nums', bandId === b.key ? 'text-ink-700/70' : 'text-ink-400')}>
                {b.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {groups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          <button
            onClick={() => setGroupId(null)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors min-h-[34px]',
              groupId === null
                ? 'bg-purple-600 border-purple-500 text-white'
                : 'bg-card/70 border-page text-ink-500 hover:bg-page',
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
                    : 'bg-card/70 border-page text-ink-500 hover:bg-page',
                )}
              >
                {g.groupName || t('unassigned')} <span className="text-ink-400 tabular-nums">{g.members}</span>
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
        <span className="text-xs text-ink-400">{t('showingCount', { shown: shown.length, total: members.length })}</span>
        {onAdd && (
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 min-h-[32px]">
            <UserPlus className="h-3.5 w-3.5" /> {t('addAthlete')}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <Card variant="muted">
          <p className="text-sm text-ink-400 text-center py-4">{t('noMatches')}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => (
            <button
              key={m.athleteId}
              onClick={() => onSelectMember(m)}
              className="w-full flex items-center gap-3 rounded-card bg-card/50 border border-page/50 p-3 text-start hover:bg-page/80 active:scale-[0.99] transition-all"
            >
              {m.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-600/20 flex items-center justify-center text-xs font-bold text-brand-600 shrink-0">
                  {initialsOf(m.name)}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-ink-700 truncate">{m.name}</span>
                  {!m.hasWatch && <Watch className="h-3.5 w-3.5 text-accent-red shrink-0" />}
                  {m.attention.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-band-3 shrink-0" />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {/* Who coaches them and what they're training for — the two
                      facts a 1:1 online row is actually about. Each shown only
                      when set: when it isn't, the attention badge below already
                      says "No coach" / "No band", and saying it twice on one row
                      buys nothing. First name only: the surname is never the
                      ambiguous part in an academy this size. */}
                  {m.academyCoachId && m.academyCoachName && (
                    <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-band-2/15 text-band-2-ink border border-band-2/20">
                      {m.academyCoachName.split(' ')[0]}
                    </span>
                  )}
                  {m.band && (
                    <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-accent-600/15 text-accent-900 border border-accent-600/20">
                      {m.band.name}
                    </span>
                  )}
                  {m.groupName && (
                    <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-800 border border-purple-500/20">
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
                <div className="text-sm font-bold text-ink-700 tabular-nums leading-none">{m.weekKm.toFixed(1)}</div>
                <div className="text-3xs text-ink-400 mt-0.5">{t('kmUnit')}</div>
              </div>
              <div className="text-end shrink-0 w-11">
                <div className={cn('text-sm font-bold tabular-nums leading-none', rateColor(m.completionRate))}>
                  {fmtRate(m.completionRate)}
                </div>
                <div className="text-3xs text-ink-400 mt-0.5">
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

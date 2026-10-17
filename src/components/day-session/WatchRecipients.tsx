'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, CheckCircle2, Layers, Search, UserCheck, Users, Watch, XCircle } from 'lucide-react';
import { useApi } from '@/lib/api';
import { COACH_ID } from '@/lib/constants';
import { InsetRow, InsetSection, SegmentedControl } from '@/components/ui';
import { sortByPaceGroup } from '@/lib/plans/pace-group';

// "מי מקבל" for a one-day session — the planner's send sheet (plan/new, the push modal):
// all · by group · specific people, with who has a Garmin connected. Only connected
// athletes are sent to; the count says so before anything goes out.

interface Athlete { id: string; name: string; email?: string; group_id?: string; status: string; hasGarmin?: boolean }
interface Group { id: string; name: string; marathonGoal?: string }

export type RecipientTab = 'all' | 'groups' | 'athletes';

export function useWatchRecipients() {
  const { data: a, isLoading: la } = useApi<{ athletes: Athlete[] }>(`/api/athletes?coach_id=${COACH_ID}`);
  const { data: g, isLoading: lg } = useApi<{ groups: Group[] }>(`/api/groups?coach_id=${COACH_ID}`);
  const active = useMemo(() => (a?.athletes || []).filter((x) => x.status === 'active'), [a]);
  const [tab, setTab] = useState<RecipientTab>('athletes');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [athleteIds, setAthleteIds] = useState<string[]>([]);
  const chosen = tab === 'all' ? active
    : tab === 'groups' ? active.filter((x) => x.group_id && groupIds.includes(x.group_id))
      : active.filter((x) => athleteIds.includes(x.id));
  // Only a connected watch can take the workout.
  const ids = chosen.filter((x) => x.hasGarmin).map((x) => x.id);
  return {
    loading: la || lg, active, groups: g?.groups || [], tab, setTab, groupIds, setGroupIds, athleteIds, setAthleteIds,
    ids, chosenCount: chosen.length,
  };
}

export function WatchRecipients({ r }: { r: ReturnType<typeof useWatchRecipients> }) {
  const t = useTranslations('planner');
  const [search, setSearch] = useState('');
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const filtered = search.trim()
    ? r.active.filter((a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.email?.toLowerCase().includes(search.toLowerCase()))
    : r.active;
  const sorted = sortByPaceGroup(r.groups);

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={r.tab}
        onChange={r.setTab}
        options={[
          { value: 'all', icon: Users, label: t('allAthletesShort') },
          { value: 'groups', icon: Layers, label: t('byGroup') },
          { value: 'athletes', icon: UserCheck, label: t('specific') },
        ]}
      />
      {r.loading ? null : r.tab === 'all' ? (
        <p className="text-center text-sm text-ink-400">
          {t('activeAthletesCount', { count: r.active.length })} · {t('garminWillReceive', { ready: r.ids.length, count: 1 })}
        </p>
      ) : r.tab === 'groups' ? (
        <InsetSection className="mb-0">
          {sorted.map((group, i) => {
            const members = r.active.filter((a) => a.group_id === group.id);
            const on = r.groupIds.includes(group.id);
            return (
              <InsetRow
                key={group.id}
                icon={Layers}
                iconBg={i === 0 ? 'bg-accent-600' : 'bg-band-3'}
                label={group.name}
                sublabel={`${t('groupLabel', { n: Math.min(i + 1, 3) })} · ${t('readyOfTotal', { ready: members.filter((a) => a.hasGarmin).length, total: members.length })}`}
                onClick={() => r.setGroupIds(toggle(r.groupIds, group.id))}
                trailing={on ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : <span className="h-5 w-5 rounded-full border-2 border-ink-300" />}
              />
            );
          })}
        </InsetSection>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchAthletes')}
              className="min-h-[44px] w-full rounded-lg border border-page bg-page ps-9 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/50"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            <InsetSection className="mb-0">
              {filtered.map((a) => {
                const on = r.athleteIds.includes(a.id);
                return (
                  <InsetRow
                    key={a.id}
                    icon={Watch}
                    iconBg={a.hasGarmin ? 'bg-accent-600' : 'bg-ink-300'}
                    label={a.name}
                    sublabel={r.groups.find((g) => g.id === a.group_id)?.name}
                    onClick={a.hasGarmin ? () => r.setAthleteIds(toggle(r.athleteIds, a.id)) : undefined}
                    trailing={!a.hasGarmin
                      ? <span className="flex items-center gap-1 text-2xs text-ink-400"><XCircle className="h-3.5 w-3.5" />{t('notConnected')}</span>
                      : on ? <CheckCircle className="h-5 w-5 text-brand-600" /> : <span className="h-5 w-5 rounded-full border-2 border-ink-300" />}
                  />
                );
              })}
            </InsetSection>
          </div>
        </>
      )}
    </div>
  );
}

'use client';

// רצים (mockup "יאיר · אימונים" › רצים): everyone, a search, the filter chips
// (כולם / packs / לא רצו / כאב / בלי שעון) and per row the pack, the flags and the km this
// week against last week. A tap opens the runner card.

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { personMatches } from '@/lib/search/match';
import { filterCounts, matchesFilter, packLabel, runnerRows, type RunnerFilter } from '@/lib/coach-space/model';
import { Avatar, B, Card, Loading, ScreenHeader, painIds, useFeedback, useOpenRunner, usePeople, useVolume } from './shared';

const CHIPS: Array<[RunnerFilter, string]> = [
  ['all', 'כולם'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['notRun', 'לא רצו'], ['pain', 'כאב'], ['noWatch', 'בלי שעון'],
];

export function CoachRunners() {
  const openRunner = useOpenRunner();
  const people = usePeople();
  const volume = useVolume();
  const feedback = useFeedback();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RunnerFilter>('all');

  const rows = useMemo(
    () => runnerRows(people.data?.people ?? [], volume.data?.athletes ?? [], painIds(feedback.data?.items, people.data?.today)),
    [people.data, volume.data, feedback.data],
  );
  if (!people.data) return <><ScreenHeader title="רצים" /><Loading /></>;

  const counts = filterCounts(rows);
  const shown = rows.filter((r) => matchesFilter(r, filter) && (!q.trim() || personMatches(r.person.name, q)));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.thisWeekKm, r.lastWeekKm)));

  return (
    <>
      <ScreenHeader title="רצים" />
      <div className="mx-4 mb-2.5 flex min-h-[44px] items-center gap-2 rounded-[14px] bg-card px-3">
        <Search className="h-4 w-4 text-ink-400" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש רץ…" aria-label="חיפוש רץ"
          className="min-h-[44px] flex-1 bg-transparent text-[16px] text-ink-900 outline-none placeholder:text-ink-400" />
      </div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {CHIPS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={cn('flex min-h-[44px] flex-none items-center gap-1 rounded-full px-3.5 text-[13px] font-bold', filter === k ? 'bg-ink-900 text-white' : 'bg-card text-ink-600')}>
            {label}<span className={filter === k ? 'text-white/70' : 'text-ink-400'}><B>{counts[k]}</B></span>
          </button>
        ))}
      </div>

      <Card className="p-0">
        {shown.length === 0 ? <p className="px-4 py-6 text-center text-[14px] text-ink-400">אין רצים בסינון הזה</p> : (
          <ul className="divide-y divide-page">
            {shown.map((r) => (
              <li key={r.person.id}>
                <button type="button" onClick={() => openRunner(r.person.id)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-start">
                  <Avatar person={r.person} size={40} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[15px] font-bold text-ink-900" dir="auto">{r.person.name}</b>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-400">
                      {packLabel(r.person.groupName) && <B>{packLabel(r.person.groupName)}</B>}
                      {r.pain && <span className="font-bold text-accent-red">· כאב</span>}
                      {r.noWatch && <span className="font-bold text-[#B45309]">· בלי שעון</span>}
                      {!r.ranThisWeek && <span className="font-bold text-ink-500">· לא רץ השבוע</span>}
                    </span>
                  </span>
                  <span className="w-[74px] shrink-0">
                    <span className="block text-end text-[15px] font-black text-ink-900"><B>{r.thisWeekKm}</B></span>
                    <span className="mt-1 flex flex-col gap-[3px]" aria-hidden>
                      <i className="block h-[4px] rounded-full bg-ink-200" style={{ width: `${(r.lastWeekKm / max) * 100}%` }} />
                      <i className="block h-[4px] rounded-full bg-brand-600" style={{ width: `${(r.thisWeekKm / max) * 100}%` }} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mx-5 flex items-center gap-3 text-[11.5px] text-ink-400">
        <span className="flex items-center gap-1"><i className="block h-[4px] w-3 rounded-full bg-ink-200" />שבוע שעבר</span>
        <span className="flex items-center gap-1"><i className="block h-[4px] w-3 rounded-full bg-brand-600" />השבוע</span>
        <span>· נגיעה ברץ פותחת את הכרטיס</span>
      </p>
    </>
  );
}

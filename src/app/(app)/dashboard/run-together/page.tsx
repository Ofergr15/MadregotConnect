'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { List, Map as MapIcon, Plus } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui';
import { byDay, dayHeading, paceMatch, type MeetupPerson, type RunMeetup } from '@/lib/runs/meetups';
import { RunCard, packHex } from '@/components/run-together/parts';
import { MeetupsMap } from '@/components/run-together/MeetupsMap';
import { NewRunSheet, type Spot } from '@/components/run-together/NewRunSheet';

// "לרוץ ביחד" (mockup ~/.cache/madregot/run-together-v2.html, Ofer 2026-10-19: "a plus
// to post, offers easy to see, where, which pack and who"). The board by day or on a
// map, filtered by pack or by pace, and a floating + that is always there.

interface Board {
  meetups: RunMeetup[];
  today: string;
  viewer: (MeetupPerson & { pace: string | null }) | null;
  spots: Spot[];
}
type Filter = 'all' | 1 | 2 | 3 | 'pace';

export default function RunTogetherPage() {
  return <Suspense fallback={<div className="flex justify-center py-16"><Spinner /></div>}><Board /></Suspense>;
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, mutate } = useApi<Board>('/api/runs/meetups');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [composing, setComposing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (params?.get('new') === '1') setComposing(true); }, [params]);

  const all = useMemo(() => data?.meetups ?? [], [data]);
  const myPace = data?.viewer?.pace ?? null;
  const shown = useMemo(() => all.filter((m) => filter === 'all' ? true
    : filter === 'pace' ? ['close', 'near'].includes(paceMatch(m.plannedPace, myPace) ?? '')
      : m.pack === filter), [all, filter, myPace]);
  const counts = useMemo(() => ({
    1: all.filter((m) => m.pack === 1).length, 2: all.filter((m) => m.pack === 2).length, 3: all.filter((m) => m.pack === 3).length,
    pace: all.filter((m) => ['close', 'near'].includes(paceMatch(m.plannedPace, myPace) ?? '')).length,
  }), [all, myPace]);
  const runners = new Set(all.flatMap((m) => m.going.map((p) => p.id))).size;
  const onMap = shown.filter((m) => m.lat != null && m.lng != null);
  const sel = onMap.find((m) => m.id === selected) ?? onMap[0] ?? null;

  if (!data) return <div className="flex justify-center py-16"><Spinner /></div>;
  const today = data.today;

  const chip = (f: Filter, label: React.ReactNode, n?: number) => (
    <button key={String(f)} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
      className={cn('flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-extrabold shadow-[0_1px_2px_rgba(0,0,0,0.05)]', filter === f ? 'bg-ink-900 text-white' : 'bg-card text-ink-900')}>
      {label}{n != null && n > 0 && <span className={cn('tabular-nums', filter === f ? 'text-white/70' : 'text-ink-400')}>{n}</span>}
    </button>
  );
  const filters = (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1.5">
      {chip('all', 'כל הדבוקות')}
      {([1, 2, 3] as const).map((p) => chip(p, <><i className="h-2.5 w-2.5 rounded-full" style={{ background: packHex(p) }} />דבוקה {p}</>, counts[p]))}
      {myPace && chip('pace', '⚡ בקצב שלי', counts.pace)}
    </div>
  );
  const toggle = (
    <div className="flex shrink-0 rounded-[13px] bg-ink-900/[0.07] p-[3px]" role="tablist">
      {(['list', 'map'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
          className={cn('flex h-11 items-center gap-1 rounded-[10px] px-3 text-[12.5px] font-extrabold', view === v ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>
          {v === 'list' ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}{v === 'list' ? 'רשימה' : 'מפה'}
        </button>
      ))}
    </div>
  );
  const fab = (compact: boolean) => (
    <button type="button" onClick={() => setComposing(true)} aria-label="ריצה חדשה"
      className={cn('fixed z-[600] flex h-[58px] items-center justify-center gap-1.5 rounded-full bg-brand-600 text-white shadow-[0_12px_24px_-8px_rgba(21,37,255,0.65),0_2px_6px_rgba(0,0,0,0.2)] active:scale-95 start-auto end-4 md:end-8',
        compact ? 'w-[58px] bottom-[calc(env(safe-area-inset-bottom)+238px)]' : 'ps-4 pe-5 bottom-[calc(env(safe-area-inset-bottom)+88px)]')}>
      <Plus className="h-6 w-6" strokeWidth={2.6} />{!compact && <b className="text-[15.5px] font-black">ריצה חדשה</b>}
    </button>
  );

  return (
    <div dir="rtl" className="pb-24">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[30px] font-black leading-tight tracking-tight text-ink-900">לרוץ ביחד</h1>
          <p className="text-[13px] font-semibold text-ink-400">{all.length ? `${all.length} ${all.length === 1 ? 'ריצה' : 'ריצות'} · ${runners} רצים` : 'מתי ואיפה רצים — ומי בא'}</p>
        </div>
        {all.length > 0 && toggle}
      </div>
      {all.length > 0 && filters}

      {all.length === 0 ? (
        <div className="mt-6 rounded-[24px] bg-card px-6 py-10 text-center">
          <p className="text-[40px] leading-none">🏃‍♀️🏃</p>
          <p className="mt-3 text-lg font-black text-ink-900">עוד אף אחד לא פרסם ריצה</p>
          <p className="mx-auto mt-1 max-w-[260px] text-sm text-ink-500">יוצאים לרוץ? ספרו מתי ואיפה — הדבוקה שלכם תקבל התראה, ואולי מישהו יצטרף.</p>
          <button type="button" onClick={() => setComposing(true)} className="mt-5 h-12 rounded-2xl bg-brand-600 px-6 text-[15px] font-black text-white">לפרסם ריצה</button>
        </div>
      ) : view === 'list' ? (
        shown.length === 0 ? (
          <p className="mt-8 text-center text-sm font-bold text-ink-400">אין ריצות בסינון הזה</p>
        ) : byDay(shown).map(({ date, items }) => {
          const h = dayHeading(date, today);
          return (
            <section key={date} className="mt-3">
              <p className="mb-2 flex items-baseline gap-2 px-1"><b className="text-xl font-black tracking-tight text-ink-900">{h.title}</b><span className="text-[13px] font-bold text-ink-400"><bdi>{h.sub}</bdi></span></p>
              <div className="space-y-2.5">{items.map((m) => <RunCard key={m.id} m={m} myPace={myPace} dayLabel={h.title} />)}</div>
            </section>
          );
        })
      ) : (
        <div className="relative -mx-4 mt-1 h-[calc(100dvh-245px)] min-h-[420px] overflow-hidden">
          <MeetupsMap meetups={onMap} selected={sel?.id ?? null} onSelect={setSelected} className="absolute inset-0" />
          {onMap.length < shown.length && (
            <p className="absolute start-1/2 top-3 z-[500] -translate-x-1/2 whitespace-nowrap rounded-full bg-ink-900 px-3 py-1.5 text-xs font-extrabold text-white rtl:translate-x-1/2">
              {shown.length - onMap.length} בלי נקודת מפגש — ברשימה
            </p>
          )}
          {sel && (
            <div className="absolute inset-x-3 bottom-3 z-[500]">
              <RunCard m={sel} myPace={myPace} dayLabel={dayHeading(sel.date, today).title} className="shadow-[0_14px_30px_-10px_rgba(0,0,0,0.35)]" />
              {onMap.length > 1 && (
                <div className="mt-2 flex justify-center gap-1.5">
                  {onMap.map((m) => (
                    <button key={m.id} type="button" onClick={() => setSelected(m.id)} aria-label={`${m.location} ${m.startTime}`} className="flex h-6 items-center px-0.5">
                      <i className={cn('block h-1.5 rounded-full', m.id === sel.id ? 'w-4 bg-ink-900' : 'w-1.5 bg-ink-900/25')} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {fab(view === 'map')}
      <NewRunSheet open={composing} onClose={() => setComposing(false)} spots={data.spots} today={today} me={data.viewer} myPace={myPace}
        onPosted={async (id) => { setComposing(false); await mutate(); router.push(`/dashboard/run-together/${id}`); }} />
    </div>
  );
}

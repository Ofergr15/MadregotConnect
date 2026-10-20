'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, israelToday } from '@/lib/utils';
import { SkeletonList } from '@/components/ui';
import { AthleteLink } from '@/components/AthleteLink';
import type { Person, SessionDay } from '@/lib/attendance/real-server';
import {
  addDays, avg, counts, dm, held, laneAvg, laneLabel, laneOf, LANE_HEX, WEEKDAY, week, weekdayOf,
  type AttendanceData, type Lane,
} from '@/components/attendance/model';

// "נוכחות באימון" (mockup ~/.cache/madregot/attendance-mockup.html, Ofer 2026-10-20):
// who really ran with the group — the RSVP said 2–9, the GPS says 11–18. The main
// screen is the week; the month's calendar, the month in numbers and a session's day
// open from it.

type View = { v: 'week' } | { v: 'month' } | { v: 'numbers' } | { v: 'day'; date: string; from: 'week' | 'month' };
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const LANES: Lane[] = [1, 2, 3, 'academy'];
const heat = (n: number) => (n >= 15 ? { bg: '#0E7A3C', fg: '#fff' } : n >= 10 ? { bg: '#7BD39A', fg: '#0E3F22' } : { bg: '#FFD98A', fg: '#5A3A00' });
const monthRange = (y: number, m: number) => {
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const to = addDays(m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, '0')}-01`, -1);
  return { from, to };
};

export default function PracticeAttendancePage() {
  const today = israelToday();
  const [view, setView] = useState<View>({ v: 'week' });
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const wide = useApi<AttendanceData>(`/api/attendance/real?from=${addDays(today, -62)}&to=${addDays(today, 7)}`);
  const mr = monthRange(ym.y, ym.m);
  const pr = monthRange(ym.m === 0 ? ym.y - 1 : ym.y, ym.m === 0 ? 11 : ym.m - 1);
  const month = useApi<AttendanceData>(view.v === 'month' || view.v === 'numbers' || (view.v === 'day' && view.from === 'month') ? `/api/attendance/real?from=${mr.from}&to=${mr.to}` : null);
  const prev = useApi<AttendanceData>(view.v === 'numbers' ? `/api/attendance/real?from=${pr.from}&to=${pr.to}` : null);
  const shift = (d: number) => setYm(({ y, m }) => { const t = y * 12 + m + d; return { y: Math.floor(t / 12), m: t % 12 }; });

  return (
    <div className="mx-auto max-w-2xl pb-10" dir="rtl">
      {view.v === 'week' || view.v === 'month' ? (
        <>
          <h1 className="flex items-center gap-2 text-2xl font-black text-ink-900"><Users className="h-6 w-6 text-brand-600" /> נוכחות באימון</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-ink-400">מי באמת רץ עם הקבוצה — לפי ה־GPS</p>
          <div className="mt-3 flex rounded-xl bg-ink-900/[0.07] p-[3px]" role="tablist">
            {(['week', 'month'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view.v === v} onClick={() => setView({ v })}
                className={cn('h-11 flex-1 rounded-[10px] text-[14px] font-extrabold', view.v === v ? 'bg-card text-ink-900 shadow-sm' : 'text-ink-500')}>
                {v === 'week' ? 'שבוע' : 'חודש'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setView(view.v === 'day' && view.from === 'week' ? { v: 'week' } : { v: 'month' })}
          className="flex min-h-[44px] items-center gap-1 text-[15px] font-extrabold text-brand-600">
          <ChevronRight className="h-5 w-5" />{view.v === 'day' && view.from === 'week' ? 'השבוע' : 'לוח החודש'}
        </button>
      )}

      {view.v === 'week' && (wide.data ? <WeekView data={wide.data} onDay={(date) => setView({ v: 'day', date, from: 'week' })} onMonth={() => setView({ v: 'month' })} onNumbers={() => setView({ v: 'numbers' })} /> : <Loading />)}
      {view.v === 'month' && (month.data
        ? <MonthView data={month.data} y={ym.y} m={ym.m} onShift={shift} onDay={(date) => setView({ v: 'day', date, from: 'month' })} onNumbers={() => setView({ v: 'numbers' })} />
        : <Loading />)}
      {view.v === 'numbers' && (month.data && prev.data ? <NumbersView data={month.data} prev={prev.data} label={MONTHS[ym.m]} prevLabel={MONTHS[(ym.m + 11) % 12]} /> : <Loading />)}
      {view.v === 'day' && (() => {
        const src = view.from === 'month' ? month.data : wide.data;
        const d = src?.days.find((x) => x.date === view.date);
        return src && d ? <DayView day={d} people={src.people} /> : <Loading />;
      })()}
    </div>
  );
}

function Loading() { return <div className="mt-4"><SkeletonList count={4} /></div>; }

function Face({ p, size = 36 }: { p: Person | undefined; size?: number }) {
  const ring = p ? LANE_HEX[String(laneOf(p) ?? '')] ?? '#9A9BA5' : '#9A9BA5';
  const st = { width: size, height: size, boxShadow: `0 0 0 2.5px ${ring}` };
  return p?.avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={p.avatarUrl} alt="" style={st} className="shrink-0 rounded-full bg-page object-cover" referrerPolicy="no-referrer" />
    : <span style={st} className="flex shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-[12px] font-black text-brand-600">{(p?.name[0] || '?').toUpperCase()}</span>;
}
const first = (p: Person | undefined) => (p?.name || '').split(/\s+/)[0];

/** A face and a first name that open the person's profile. */
function Tile({ id, p, children }: { id: string; p: Person | undefined; children?: React.ReactNode }) {
  return (
    <AthleteLink athleteId={id} name={p?.name || ''} className="relative block w-[46px] text-center">
      <span className="mx-auto block w-fit"><Face p={p} /></span>
      {children}
      <small className="mt-1 block truncate text-[11px] font-extrabold text-ink-900"><bdi>{first(p)}</bdi></small>
    </AthleteLink>
  );
}
/** A row: face, name, and a number at the end — opening the profile. */
function Row({ id, p, full, end, tone }: { id: string; p: Person | undefined; full?: boolean; end: React.ReactNode; tone?: string }) {
  return (
    <AthleteLink athleteId={id} name={p?.name || ''} className="flex min-h-[44px] items-center gap-2.5">
      <Face p={p} size={30} />
      <b className="flex-1 truncate text-[13.5px] font-extrabold text-ink-900"><bdi>{full ? p?.name : first(p)}</bdi></b>
      <span className={cn('text-[12.5px] font-extrabold', tone ?? 'text-accent-900')}>{end}</span>
    </AthleteLink>
  );
}

function Kpis({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {items.map(([v, l]) => (
        <div key={l} className="rounded-2xl bg-card px-2 py-3 text-center">
          <b className="block text-[26px] font-black leading-none text-ink-900"><bdi>{v}</bdi></b>
          <small className="mt-1 block text-[11.5px] font-bold leading-tight text-ink-400">{l}</small>
        </div>
      ))}
    </div>
  );
}
function Card({ title, children, tone }: { title?: string; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <section className={cn('mt-2.5 rounded-[20px] p-3.5', tone === 'warn' ? 'bg-[#FFF6EE]' : 'bg-card')}>
      {title && <h2 className="mb-2.5 text-[14px] font-black text-ink-900">{title}</h2>}
      {children}
    </section>
  );
}
function Bars({ items }: { items: Array<{ key: string; label: string; value: number; mark?: number; strong?: boolean }> }) {
  const max = Math.max(1, ...items.map((i) => i.value), ...items.map((i) => i.mark ?? 0));
  return (
    <div className="flex gap-2" dir="rtl">
      {items.map((i) => (
        <div key={i.key} className="flex flex-1 flex-col items-center">
          <span className="mb-1 text-[12px] font-black text-ink-900 tabular-nums">{Math.round(i.value)}</span>
          {/* The column: the bar for who came, a line where "said they'd come" reached. */}
          <div className="relative flex h-[96px] w-full items-end">
            <i className="block w-full rounded-t-[7px] rounded-b-[3px]" style={{ height: `${(i.value / max) * 100}%`, background: i.strong ? '#1525FF' : '#7BD39A' }} />
            {i.mark != null && i.mark > 0 && <b className="absolute inset-x-[15%] h-[3px] rounded bg-brand-600" style={{ bottom: `${(i.mark / max) * 100}%` }} />}
          </div>
          <small className="mt-1.5 whitespace-nowrap text-[10.5px] font-extrabold text-ink-500">{i.label}</small>
        </div>
      ))}
    </div>
  );
}

function WeekView({ data, onDay, onMonth, onNumbers }: { data: AttendanceData; onDay: (d: string) => void; onMonth: () => void; onNumbers: () => void }) {
  const w = useMemo(() => week(data), [data]);
  const P = data.people;
  const sessions = [...w.ahead.sort((a, b) => b.date.localeCompare(a.date)), ...w.last7];
  return (
    <>
      <Kpis items={[[w.last7.length ? String(Math.round(w.average)) : '—', 'בממוצע באימון'], [String(w.c7.size), 'רצים שונים השבוע'], [w.delta == null ? '—' : `${w.delta >= 0 ? '+' : ''}${w.delta.toFixed(1)}`, 'מול השבוע שלפני']]} />
      <Card title="האימונים">
        {sessions.length === 0 && <p className="text-[13px] text-ink-400">אין אימוני קבוצה השבוע</p>}
        {sessions.map((d) => (
          <button key={d.date} type="button" disabled={!d.held} onClick={() => onDay(d.date)}
            className="flex w-full items-center gap-3 border-t border-page py-2.5 text-start first:border-t-0 disabled:cursor-default">
            <span className="w-12 shrink-0 text-center"><b className="block text-[13.5px] font-black text-ink-900">{WEEKDAY[weekdayOf(d.date)]}</b><small className="text-[11.5px] font-bold text-ink-400"><bdi>{dm(d.date)}</bdi></small></span>
            <span className="min-w-0 flex-1">
              {d.held ? (<>
                <b className="block text-[15px] font-black text-ink-900">{d.came.length ? `${d.came.length} הגיעו` : 'לא נמצאה ריצה קבוצתית'}</b>
                <small className="block text-[11.5px] font-bold text-ink-400">{d.said.length} אמרו מראש{d.groups.length ? ` · ${d.groups.length} ${d.groups.length === 1 ? 'קבוצה' : 'קבוצות'}` : ''}</small>
                {d.came.length > 0 && (
                  <span className="mt-1.5 flex" dir="ltr">{d.came.slice(0, 9).map((id, i) => <span key={id} className={cn('rounded-full border-2 border-card', i > 0 && '-ms-2')}><Face p={P[id]} size={24} /></span>)}
                    {d.came.length > 9 && <span className="ms-1 self-center text-[11px] font-black text-brand-600">+{d.came.length - 9}</span>}</span>
                )}
              </>) : (<>
                <b className="block text-[15px] font-black text-ink-400">עוד לא היה</b>
                <small className="block text-[11.5px] font-bold text-ink-400">אמרו שיגיעו: {d.said.length}</small>
              </>)}
            </span>
            {d.held && <ChevronLeft className="h-5 w-5 shrink-0 text-ink-300" />}
          </button>
        ))}
      </Card>
      <Card title="מי הגיע · 7 ימים">
        {LANES.map((lane) => {
          const xs = [...w.c7.entries()].filter(([id]) => laneOf(P[id]) === lane).sort((a, b) => b[1] - a[1]);
          if (lane === 'academy' && data.sizes.academy === 0) return null;
          return (
            <div key={lane} className="border-t border-page py-2 first:border-t-0">
              <p className="mb-2 flex items-center gap-1.5 text-[13px]"><i className="h-2.5 w-2.5 rounded-full" style={{ background: LANE_HEX[lane] }} /><b className="font-black text-ink-900">{laneLabel(lane)}</b><span className="ms-auto font-extrabold text-ink-400">{xs.length ? xs.length : 'אף אחד השבוע'}</span></p>
              {xs.length > 0 && (
                <div className="flex flex-wrap gap-2.5">
                  {xs.map(([id, n]) => (
                    <Tile key={id} id={id} p={P[id]}>
                      {n > 1 && <em className="absolute -top-1 start-0 rounded-md border-2 border-card bg-brand-600 px-1 text-[10px] font-black not-italic text-white">{n}×</em>}
                    </Tile>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
      {w.missing.length > 0 && (
        <Card title="בדרך כלל מגיעים — לא נמצאו השבוע" tone="warn">
          {w.missing.map(({ id, n }) => <Row key={id} id={id} p={P[id]} full end={`${n} ב־4 שבועות`} tone="text-[#B23A0C]" />)}
          <p className="mt-1.5 text-[11.5px] text-ink-400">אולי רצו מסלול אחר או בלי GPS — שווה הודעה קטנה.</p>
        </Card>
      )}
      {w.trend.length > 1 && (
        <Card title={`ממוצע באימון · ${w.trend.length} שבועות`}>
          <Bars items={w.trend.map((t, i) => ({ key: t.week, label: dm(t.week), value: t.avg, strong: i === w.trend.length - 1 }))} />
        </Card>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={onMonth} className="h-12 rounded-2xl bg-card text-[14px] font-black text-brand-600">לוח החודש ›</button>
        <button type="button" onClick={onNumbers} className="h-12 rounded-2xl bg-card text-[14px] font-black text-brand-600">החודש במספרים ›</button>
      </div>
    </>
  );
}

function MonthView({ data, y, m, onShift, onDay, onNumbers }: { data: AttendanceData; y: number; m: number; onShift: (d: number) => void; onDay: (d: string) => void; onNumbers: () => void }) {
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const h = held(data.days);
  const firstDow = weekdayOf(`${y}-${String(m + 1).padStart(2, '0')}-01`);
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const saidShare = h.length ? Math.round((100 * h.reduce((s, d) => s + d.said.length, 0)) / Math.max(1, h.reduce((s, d) => s + d.came.length, 0))) : 0;
  return (
    <>
      <Kpis items={[[h.length ? String(Math.round(avg(h.map((d) => d.came.length)))) : '—', 'בממוצע באימון'], [String(h.length), 'אימוני קבוצה'], [h.length ? `${saidShare}%` : '—', 'אמרו מראש שיגיעו']]} />
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-card px-1">
        <button type="button" onClick={() => onShift(-1)} aria-label="החודש הקודם" className="flex h-11 w-11 items-center justify-center text-brand-600"><ChevronRight className="h-5 w-5" /></button>
        <b className="text-[16px] font-black text-ink-900">{MONTHS[m]} {y}</b>
        <button type="button" onClick={() => onShift(1)} aria-label="החודש הבא" className="flex h-11 w-11 items-center justify-center text-brand-600"><ChevronLeft className="h-5 w-5" /></button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map((x) => <span key={x} className="text-[11.5px] font-extrabold text-ink-400">{x}</span>)}
        {Array.from({ length: firstDow }, (_, i) => <i key={`b${i}`} />)}
        {Array.from({ length: dim }, (_, i) => {
          const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
          const d = byDate.get(iso);
          if (!d) return <span key={iso} className="flex h-[54px] items-center justify-center text-[13px] font-bold text-ink-500">{i + 1}</span>;
          if (!d.held) return (
            <span key={iso} className="flex h-[54px] flex-col items-center justify-center rounded-xl bg-card">
              <b className="text-[13px] font-extrabold text-ink-900">{i + 1}</b>
              <em className="mt-0.5 rounded-md border-[1.5px] border-dashed border-ink-300 px-1 text-[10px] font-black not-italic text-ink-400">אימון</em>
            </span>
          );
          const c = heat(d.came.length);
          return (
            <button key={iso} type="button" onClick={() => onDay(iso)} disabled={!d.came.length} className={cn('flex h-[54px] flex-col items-center justify-center rounded-xl bg-card', iso === data.today && 'ring-2 ring-brand-600')}>
              <b className="text-[13px] font-extrabold text-ink-900">{i + 1}</b>
              {d.came.length > 0
                ? <em className="mt-0.5 whitespace-nowrap rounded-md px-1 text-[10.5px] font-black not-italic" style={{ background: c.bg, color: c.fg }}>{d.came.length} רצו</em>
                : <em className="mt-0.5 text-[10px] font-bold not-italic text-ink-300">—</em>}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-extrabold text-ink-500">
        {[['#0E7A3C', '15+'], ['#7BD39A', '10–14'], ['#FFD98A', '1–9']].map(([c, l]) => <span key={l} className="flex items-center gap-1"><i className="h-3 w-3 rounded" style={{ background: c }} />{l}</span>)}
        <span className="flex items-center gap-1"><i className="h-3 w-3 rounded border-[1.5px] border-dashed border-ink-300" />אימון שעוד לא היה</span>
        <span className="basis-full font-bold text-ink-400">המספר בתג = כמה רצו עם הקבוצה · לחיצה — מי היה שם</span>
      </div>
      <button type="button" onClick={onNumbers} className="mt-3 h-12 w-full rounded-2xl bg-card text-[14px] font-black text-brand-600">{MONTHS[m]} במספרים ›</button>
    </>
  );
}

function NumbersView({ data, prev, label, prevLabel }: { data: AttendanceData; prev: AttendanceData; label: string; prevLabel: string }) {
  const h = held(data.days).sort((a, b) => a.date.localeCompare(b.date));
  const hp = held(prev.days);
  const P = { ...prev.people, ...data.people };
  if (!h.length) return <p className="mt-8 text-center text-sm font-bold text-ink-400">אין עדיין אימונים ב{label}</p>;
  const a = avg(h.map((d) => d.came.length)), ap = avg(hp.map((d) => d.came.length));
  const c = counts(h), cp = counts(hp);
  const gone = [...cp.entries()].filter(([id, n]) => n >= 3 && !c.has(id)).map(([id, n]) => ({ id, n }));
  const tue = h.filter((d) => weekdayOf(d.date) === 2), fri = h.filter((d) => weekdayOf(d.date) === 5);
  return (
    <>
      <h1 className="mt-1 text-[26px] font-black text-ink-900">{label} במספרים</h1>
      <Kpis items={[[String(Math.round(a)), 'בממוצע באימון'], [hp.length ? `${a - ap >= 0 ? '+' : ''}${(a - ap).toFixed(1)}` : '—', `מול ${prevLabel}`], [String(c.size), 'רצים שונים הגיעו']]} />
      <Card title="כמה הגיעו בכל אימון">
        <Bars items={h.map((d) => ({ key: d.date, label: `${['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][weekdayOf(d.date)]}׳ ${Number(d.date.slice(8, 10))}`, value: d.came.length, mark: d.said.length }))} />
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-ink-400"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#7BD39A]" />הגיעו <i className="ms-2 inline-block h-[3px] w-3 bg-brand-600" />אמרו מראש</p>
      </Card>
      <Card title="לפי דבוקה · ממוצע באימון">
        {LANES.map((lane) => {
          const size = lane === 'academy' ? data.sizes.academy : data.sizes[lane];
          if (!size) return null;
          const v = laneAvg(h, P, lane), vp = laneAvg(hp, P, lane);
          return (
            <div key={lane} className="flex items-center gap-2 py-1.5 text-[13px]">
              <span className="flex w-[74px] items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ background: LANE_HEX[lane] }} />{laneLabel(lane)}</span>
              <bdi dir="ltr" className="w-[62px] text-end"><b className="text-[15px] font-black text-ink-900">{v.toFixed(1)}</b> <span className="text-ink-400">/ {size}</span></bdi>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-page"><i className="block h-full" style={{ width: `${Math.min(100, (v / size) * 100)}%`, background: LANE_HEX[lane] }} /></span>
              <span className="w-9 text-end font-extrabold text-ink-700">{Math.round((v / size) * 100)}%</span>
              {hp.length > 0 && <span className="w-10 text-end text-[11.5px] font-extrabold text-ink-400">{v >= vp ? '▲' : '▼'} {Math.abs(v - vp).toFixed(1)}</span>}
            </div>
          );
        })}
      </Card>
      {tue.length > 0 && fri.length > 0 && (
        <Card>
          <div className="grid grid-cols-2 gap-2 text-center">
            {[['שלישי', tue], ['שישי', fri]].map(([l, ds]) => (
              <div key={l as string} className="rounded-2xl bg-page py-2"><small className="text-[12px] font-extrabold text-ink-400">{l as string}</small><b className="block text-[24px] font-black text-ink-900">{Math.round(avg((ds as SessionDay[]).map((d) => d.came.length)))}</b></div>
            ))}
          </div>
          <p className="mt-1.5 text-center text-[11.5px] text-ink-400">בממוצע באימון</p>
        </Card>
      )}
      <Card title={`הכי קבועים ב${label}`}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {[...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([id, n]) => <Row key={id} id={id} p={P[id]} end={`${n}/${h.length}`} />)}
        </div>
      </Card>
      {gone.length > 0 && (
        <Card title={`היו ב${prevLabel} — לא הגיעו ב${label}`} tone="warn">
          {gone.map(({ id, n }) => <Row key={id} id={id} p={P[id]} full end={`${n} ב${prevLabel}`} tone="text-[#B23A0C]" />)}
        </Card>
      )}
    </>
  );
}

function DayView({ day, people }: { day: SessionDay; people: Record<string, Person> }) {
  const said = new Set(day.said);
  const came = new Set(day.came);
  const noShared = day.said.filter((id) => !came.has(id));
  const unannounced = day.came.filter((id) => !said.has(id)).length;
  return (
    <>
      <h1 className="mt-1 text-[26px] font-black text-ink-900">{WEEKDAY[weekdayOf(day.date)]} <bdi>{dm(day.date)}</bdi></h1>
      <Kpis items={[[String(day.came.length), 'הגיעו'], [String(day.said.length), 'אמרו שיגיעו'], [String(unannounced), 'הגיעו בלי להגיד']]} />
      {day.groups.map((g, k) => {
        const lanes = g.map((id) => laneOf(people[id])).filter(Boolean) as Lane[];
        const main = lanes.sort((a, b) => lanes.filter((x) => x === b).length - lanes.filter((x) => x === a).length)[0];
        return (
          <Card key={k}>
            <p className="mb-2.5 flex items-baseline justify-between"><b className="text-[14px] font-black text-ink-900">קבוצה {k + 1}</b><span className="text-[12px] font-bold text-ink-400">{g.length} רצו יחד{main ? ` · בעיקר ${laneLabel(main)}` : ''}</span></p>
            <div className="flex flex-wrap gap-2.5">
              {g.map((id) => (
                <Tile key={id} id={id} p={people[id]}>
                  {said.has(id) && <em className="absolute -top-1 start-0 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-card bg-[#0E7A3C] text-[10px] font-black not-italic text-white">✓</em>}
                </Tile>
              ))}
            </div>
          </Card>
        );
      })}
      {noShared.length > 0 && (
        <Card title="אמרו שיגיעו — לא נמצאה ריצה משותפת" tone="warn">
          <div className="flex flex-wrap gap-2.5">
            {noShared.map((id) => <Tile key={id} id={id} p={people[id]} />)}
          </div>
          <p className="mt-2 text-[11.5px] text-ink-400">אולי רצו מסלול אחר, או בלי GPS.</p>
        </Card>
      )}
      <p className="mt-2 px-1 text-[11.5px] leading-relaxed text-ink-400">✓ = אמר/ה מראש. ״רצו יחד״ — כמו בפיד: התחילו בהפרש של עד 5 דקות, ו־80% מהמסלול צמודים.</p>
    </>
  );
}

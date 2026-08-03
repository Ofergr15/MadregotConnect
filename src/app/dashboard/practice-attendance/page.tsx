'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Users, Loader2, Check, X, CalendarDays, ChevronRight, ChevronLeft, List, CalendarRange } from 'lucide-react';
import { getPlanWeekStart, resolveGroup } from '@/lib/utils';

interface RosterRow {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  squad: string | null;
  responded: boolean;
  attending: boolean | null;
  groupLabel: string | null;
}

type DayCounts = { going: number; notGoing: number; total: number };

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DOW_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const TEAM_DAYS = [2, 5]; // Tue, Fri

// Local-date ISO (YYYY-MM-DD) — NOT toISOString(), which converts to UTC and
// shifts the day back in timezones ahead of UTC (Israel is +2/+3), throwing the
// whole calendar off by one.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());

// Admin view: practice attendance over time. A month CALENDAR is the primary
// view — each practice day shows an attendance count you can scan, and tapping a
// day drills into the full roster grouped by דבוקה (incl. non-responders). A
// practice is keyed (plan-week Sunday, day-of-week); RSVPs are pre-workout so
// this shows both who WAS at past practices and who's coming to upcoming ones.
export default function PracticeAttendancePage() {
  const [view, setView] = useState<'calendar' | 'day'>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());

  return (
    <div className="max-w-4xl mx-auto" dir="rtl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Users className="h-6 w-6 text-primary-400" /> נוכחות באימון
        </h1>
        <p className="text-sm text-slate-400 mt-1">מי היה באיזה אימון — לפי חודש ולפי דבוקה</p>
      </div>

      {/* View switch */}
      <div className="flex items-center gap-1.5 mb-5 bg-slate-800 rounded-xl p-1 border border-slate-700 w-fit">
        <ViewTab active={view === 'calendar'} onClick={() => setView('calendar')} icon={CalendarRange} label="לוח שנה" />
        <ViewTab active={view === 'day'} onClick={() => setView('day')} icon={List} label="יום בודד" />
      </div>

      {view === 'calendar' ? (
        <CalendarView
          onPickDay={(d) => { setSelectedDate(d); setView('day'); }}
        />
      ) : (
        <DayView date={selectedDate} setDate={setSelectedDate} />
      )}
    </div>
  );
}

function ViewTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-bold transition-colors ${active ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

// ────────────────────────── Calendar (month grid) ──────────────────────────
function CalendarView({ onPickDay }: { onPickDay: (isoDate: string) => void }) {
  // Anchor = first of the visible month.
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [days, setDays] = useState<Record<string, DayCounts>>({});
  const [loading, setLoading] = useState(true);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const fetchMonth = useCallback(() => {
    setLoading(true);
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    fetch(`/api/attendance?calendar=1&from=${iso(first)}&to=${iso(last)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setDays(data?.days || {}))
      .catch(() => setDays({}))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { fetchMonth(); }, [fetchMonth]);

  // Build the grid: leading blanks for the first weekday, then each day.
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ iso: string; dom: number; dow: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let dom = 1; dom <= daysInMonth; dom++) {
    const d = new Date(year, month, dom);
    cells.push({ iso: iso(d), dom, dow: d.getDay() });
  }

  const today = todayIso();
  const monthTotal = Object.entries(days)
    .filter(([d]) => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
    .reduce((s, [, c]) => s + c.going, 0);

  const shiftMonth = (delta: number) => {
    const d = new Date(anchor); d.setMonth(d.getMonth() + delta); setAnchor(d);
  };

  // Heat color for a practice day by how many are coming.
  const heat = (going: number): { bg: string; ring: string } => {
    if (going >= 15) return { bg: 'rgba(34,197,94,.32)', ring: 'rgba(34,197,94,.7)' };
    if (going >= 8) return { bg: 'rgba(34,197,94,.20)', ring: 'rgba(34,197,94,.5)' };
    if (going >= 1) return { bg: 'rgba(234,179,8,.20)', ring: 'rgba(234,179,8,.5)' };
    return { bg: 'rgba(148,163,184,.10)', ring: 'rgba(148,163,184,.3)' };
  };

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{MONTHS_HE[month]} {year}</div>
          {!loading && <div className="text-[11px] text-slate-500 tabular-nums">{monthTotal} הגעות החודש</div>}
        </div>
        <button onClick={() => shiftMonth(-1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header (RTL: Sunday on the right) */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {DOW_SHORT.map((d, i) => (
          <div key={i} className={`text-center text-[11px] font-bold ${TEAM_DAYS.includes(i) ? 'text-primary-400' : 'text-slate-500'}`}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`b${i}`} />;
          const c = days[cell.iso];
          const isTeamDay = TEAM_DAYS.includes(cell.dow);
          const isToday = cell.iso === today;
          const hasData = !!c && c.total > 0;
          const clickable = isTeamDay || hasData;
          const h = c ? heat(c.going) : null;
          return (
            <button
              key={cell.iso}
              disabled={!clickable}
              onClick={() => clickable && onPickDay(cell.iso)}
              className={`aspect-square rounded-xl flex flex-col items-center justify-center relative transition-colors border ${
                clickable ? 'hover:border-primary-500/60 cursor-pointer' : 'cursor-default'
              } ${isToday ? 'border-primary-500' : 'border-transparent'}`}
              style={h ? { backgroundColor: h.bg, borderColor: isToday ? undefined : h.ring } : { backgroundColor: isTeamDay ? 'rgba(148,163,184,.07)' : 'transparent' }}
            >
              <span className={`text-sm font-semibold ${clickable ? 'text-white' : 'text-slate-600'}`}>{cell.dom}</span>
              {hasData ? (
                <span className="text-[11px] font-bold leading-none mt-0.5" style={{ color: '#22c55e' }}>
                  {c!.going}
                </span>
              ) : isTeamDay ? (
                <span className="w-1 h-1 rounded-full bg-primary-400/60 mt-1" />
              ) : null}
            </button>
          );
        })}
      </div>

      {loading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 text-primary-500 animate-spin" /></div>}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,.32)' }} /> 15+ מגיעים</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(34,197,94,.20)' }} /> 8+</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: 'rgba(234,179,8,.20)' }} /> 1+</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-primary-400/60" /> יום אימון</span>
        <span className="text-slate-600">· המספר = כמה הגיעו/מגיעים</span>
      </div>
    </div>
  );
}

// ────────────────────────── Day roster (single practice) ──────────────────────────
function DayView({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'going' | 'no-response' | 'not-going'>('all');

  useEffect(() => {
    setLoading(true);
    const d = new Date(date + 'T12:00:00');
    const weekStart = getPlanWeekStart(d);
    const day = d.getDay();
    fetch(`/api/attendance?weekStart=${weekStart}&day=${day}&roster=full`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setRoster(data?.roster || []))
      .catch(() => setRoster([]))
      .finally(() => setLoading(false));
  }, [date]);

  const dayIdx = new Date(date + 'T12:00:00').getDay();
  const isTeamDay = TEAM_DAYS.includes(dayIdx);

  const going = roster.filter((r) => r.attending === true);
  const notGoing = roster.filter((r) => r.attending === false);
  const noResponse = roster.filter((r) => !r.responded);

  const byGroup = useMemo(() => {
    const m: Record<string, RosterRow[]> = {};
    for (const r of going) { const g = r.groupLabel || '—'; (m[g] ||= []).push(r); }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b, 'he'));
  }, [going]);

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + delta); setDate(iso(d));
  };

  const filteredList =
    statusFilter === 'going' ? going
      : statusFilter === 'no-response' ? noResponse
        : statusFilter === 'not-going' ? notGoing
          : roster;

  return (
    <div>
      {/* Date picker */}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => shiftDay(-1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="relative flex-1">
          <CalendarDays className="absolute top-1/2 -translate-y-1/2 end-3 h-4 w-4 text-slate-500 pointer-events-none" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg ps-3 pe-9 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>
        <button onClick={() => shiftDay(1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        יום {DAY_NAMES[dayIdx]}
        {isTeamDay ? <span className="text-primary-400 font-semibold"> · אימון קבוצתי</span> : <span className="text-slate-600"> · לא יום אימון קבוצתי</span>}
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 text-primary-500 animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-4">
            <CountCard active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} value={roster.length} label="סה״כ" tone="slate" />
            <CountCard active={statusFilter === 'going'} onClick={() => setStatusFilter('going')} value={going.length} label="מגיעים" tone="green" />
            <CountCard active={statusFilter === 'no-response'} onClick={() => setStatusFilter('no-response')} value={noResponse.length} label="לא ענו" tone="slate2" />
            <CountCard active={statusFilter === 'not-going'} onClick={() => setStatusFilter('not-going')} value={notGoing.length} label="לא מגיעים" tone="red" />
          </div>
          <p className="text-xs text-slate-500 mb-4 tabular-nums">{roster.length - noResponse.length} מתוך {roster.length} הגיבו</p>

          {statusFilter === 'all' ? (
            <div className="space-y-4">
              {going.length === 0 && <p className="text-sm text-slate-500 text-center py-6">אף אחד עדיין לא אישר הגעה</p>}
              {byGroup.map(([group, members]) => {
                const rg = resolveGroup(group);
                return (
                  <div key={group} className="rounded-xl border border-slate-700 bg-slate-800/60 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/60">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: rg.hex }} />
                      <span className="text-sm font-bold text-white">{group}</span>
                      <span className="ms-auto text-xs font-bold text-green-400 tabular-nums">{members.length}</span>
                    </div>
                    <div className="p-3 flex flex-wrap gap-1.5">
                      {members.map((m) => <PersonChip key={m.athleteId} row={m} />)}
                    </div>
                  </div>
                );
              })}
              {noResponse.length > 0 && (
                <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700/60">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                    <span className="text-sm font-bold text-slate-300">לא ענו</span>
                    <span className="ms-auto text-xs font-bold text-slate-400 tabular-nums">{noResponse.length}</span>
                  </div>
                  <div className="p-3 flex flex-wrap gap-1.5">
                    {noResponse.map((m) => <PersonChip key={m.athleteId} row={m} muted />)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 divide-y divide-slate-700/50">
              {filteredList.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">אין רשומות</p>
              ) : (
                filteredList.map((m) => (
                  <div key={m.athleteId} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar row={m} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-white truncate" dir="auto">{m.name}</span>
                      {m.groupLabel && <span className="block text-xs text-slate-400">{m.groupLabel}</span>}
                    </span>
                    <StatusPill row={m} />
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CountCard({ value, label, tone, active, onClick }: { value: number; label: string; tone: string; active: boolean; onClick: () => void; }) {
  const toneCls: Record<string, string> = { green: 'text-green-400', red: 'text-red-400', slate: 'text-white', slate2: 'text-slate-300' };
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-3 text-center transition-colors ${active ? 'border-primary-500/60 bg-primary-600/15' : 'border-slate-700 bg-slate-800/60 hover:border-slate-600'}`}
    >
      <div className={`text-2xl font-bold tabular-nums ${toneCls[tone]}`}>{value}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
    </button>
  );
}

function Avatar({ row }: { row: RosterRow }) {
  return row.avatarUrl
    ? <img src={row.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
    : <span className="w-8 h-8 rounded-full bg-primary-600/25 flex items-center justify-center text-xs font-bold text-primary-200 shrink-0">{(row.name[0] || '?').toUpperCase()}</span>;
}

function PersonChip({ row, muted }: { row: RosterRow; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ps-1 pe-2.5 py-1 ${muted ? 'bg-slate-900/40' : 'bg-slate-900/60'}`}>
      <Avatar row={row} />
      <span className={`text-xs ${muted ? 'text-slate-400' : 'text-slate-200'}`} dir="auto">{row.name.split(' ')[0]}</span>
    </span>
  );
}

function StatusPill({ row }: { row: RosterRow }) {
  if (row.attending === true) return <span className="inline-flex items-center gap-1 text-xs font-bold text-green-400"><Check className="h-3.5 w-3.5" /> מגיע</span>;
  if (row.attending === false) return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-400"><X className="h-3.5 w-3.5" /> לא מגיע</span>;
  return <span className="text-xs font-semibold text-slate-500">לא ענה</span>;
}

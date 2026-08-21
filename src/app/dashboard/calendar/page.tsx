'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Route, Trophy, Calendar as CalendarIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { EVENT_KINDS, type EventKind } from '@/lib/events';
import { Button, EmptyState, Sheet, SkeletonCard, SegmentedControl } from '@/components/ui';

// Generic events/calendar browser (roadmap Phase 3 — #4 Calendar). A month
// grid with a colored dot per event kind present that day; tapping a day
// shows its events below. Staff (admin/coach/academy_coach) additionally get
// an "add event" form — the first UI this app has ever had for creating a
// non-race event (the old /api/races POST was orphaned and unauthenticated).

interface EventRow {
  id: string;
  kind: EventKind;
  name: string;
  description: string | null;
  date: string;
  end_date: string | null;
  start_time: string | null;
  location: string;
  distances: string[] | null;
  capacity: number | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  race_class: string | null;
}

// Local-date ISO (YYYY-MM-DD) — NOT toISOString(), which converts to UTC and
// shifts the day back in timezones ahead of UTC (Israel is +2/+3), throwing the
// whole calendar off by one. Same convention as practice-attendance/page.tsx.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());

const DOW_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// Per-kind color + Hebrew label. Picked to stay distinguishable at dot size
// against the dark slate cards: race keeps the app's own brand indigo (it's
// the pre-existing, highest-profile kind), the rest spread across hues that
// don't collide with the green/amber/red already used for attendance status.
const KIND_META: Record<EventKind, { label: string; dot: string; badge: string }> = {
  race: { label: 'מרוץ', dot: 'bg-primary-400', badge: 'bg-primary-600/15 text-primary-300' },
  camp: { label: 'מחנה אימונים', dot: 'bg-green-400', badge: 'bg-green-500/15 text-green-400' },
  lecture: { label: 'הרצאה', dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-400' },
  social: { label: 'אירוע חברתי', dot: 'bg-pink-400', badge: 'bg-pink-500/15 text-pink-400' },
  photo_shoot: { label: 'צילומים', dot: 'bg-cyan-400', badge: 'bg-cyan-500/15 text-cyan-400' },
  sponsor: { label: 'אירוע ספונסר', dot: 'bg-orange-400', badge: 'bg-orange-500/15 text-orange-400' },
  workout: { label: 'אימון מיוחד', dot: 'bg-slate-400', badge: 'bg-slate-500/15 text-slate-300' },
};

// Expand each event across every day it covers (multi-day camps use
// `end_date`; everything else is single-day) so the month grid can show a dot
// on every day the event is actually happening, not just its start date.
function buildEventsByDay(events: EventRow[]): Record<string, EventRow[]> {
  const map: Record<string, EventRow[]> = {};
  for (const event of events) {
    const start = new Date(event.date + 'T00:00:00');
    const end = event.end_date ? new Date(event.end_date + 'T00:00:00') : start;
    const spanDays = Math.max(0, Math.min(30, Math.round((end.getTime() - start.getTime()) / 86400000)));
    for (let i = 0; i <= spanDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = iso(d);
      (map[key] ||= []).push(event);
    }
  }
  return map;
}

type ViewMode = 'list' | 'map';

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [isStaff, setIsStaff] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  // Map view is a separate mode, not a month-scoped overlay — races are sparse
  // enough that "this month's races on a map" would mostly be empty; the map
  // shows every upcoming race regardless of which month the grid is on
  // (matches the retired /dashboard/races page's own framing).
  const [view, setView] = useState<ViewMode>('list');

  // Same coach-vs-athlete check as the main dashboard: a "view as" scenario
  // wins (so the super user can preview both sides), otherwise fall back to
  // whether a real coach account is signed in.
  useEffect(() => {
    const coachEmail = localStorage.getItem('coach_email');
    const viewMode = getViewMode();
    const previewRole = viewMode && viewMode !== MAINTENANCE_MODE ? viewMode : null;
    setIsStaff(previewRole ? STAFF_ROLES.includes(previewRole) : !!coachEmail);
  }, []);

  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  // Explicit `from`/`to` override the API's default "upcoming only" lower
  // bound, so past months are browsable too.
  const { data, mutate } = useApi<{ events?: EventRow[] }>(
    `/api/events?from=${iso(first)}&to=${iso(last)}`,
  );
  const events = data?.events;
  const loading = !data;

  // Map mode: every upcoming race, regardless of the month grid's anchor.
  const { data: raceData } = useApi<{ events?: EventRow[] }>(
    view === 'map' ? '/api/events?kind=race' : null,
  );
  const races = useMemo(
    () => (raceData?.events || []).filter((r) => r.lat != null && r.lng != null),
    [raceData],
  );

  const eventsByDay = useMemo(() => buildEventsByDay(events || []), [events]);

  const firstDow = first.getDay(); // 0=Sun
  const daysInMonth = last.getDate();
  const cells: Array<{ iso: string; dom: number } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let dom = 1; dom <= daysInMonth; dom++) {
    cells.push({ iso: iso(new Date(year, month, dom)), dom });
  }

  const today = todayIso();
  const shiftMonth = (delta: number) => {
    const d = new Date(anchor); d.setMonth(d.getMonth() + delta); setAnchor(d);
  };

  const selectedEvents = useMemo(
    () => [...(eventsByDay[selectedDate] || [])].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
    [eventsByDay, selectedDate],
  );
  const dateLabel = new Date(selectedDate + 'T00:00:00')
    .toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="max-w-4xl mx-auto pb-6" dir="rtl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary-400" /> יומן אירועים
          </h1>
          <p className="text-sm text-slate-400 mt-1">מרוצים, מחנות אימון, הרצאות ואירועים נוספים</p>
        </div>
        {isStaff && (
          <Button size="sm" onClick={() => setShowAddForm(true)} className="shrink-0">
            <Plus className="h-4 w-4" /> אירוע חדש
          </Button>
        )}
      </div>

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'list', label: 'לוח שנה', icon: CalendarIcon },
          { value: 'map', label: 'מרוצים במפה', icon: Trophy },
        ]}
        className="mb-4"
      />

      {view === 'map' ? (
        <RaceMapView races={races} />
      ) : (
        <>
      {/* Month header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => shiftMonth(1)}
          aria-label="החודש הבא"
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-[0.92] transition-all"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-lg font-bold text-white">{MONTHS_HE[month]} {year}</div>
        <button
          onClick={() => shiftMonth(-1)}
          aria-label="החודש הקודם"
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-[0.92] transition-all"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header (RTL: Sunday on the right) */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {DOW_SHORT.map((d, i) => (
          <div key={i} className="text-center text-[11px] font-bold text-slate-500">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`b${i}`} />;
          const dayEvents = eventsByDay[cell.iso] || [];
          const kinds = Array.from(new Set(dayEvents.map((e) => e.kind)));
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selectedDate;
          return (
            <button
              key={cell.iso}
              onClick={() => setSelectedDate(cell.iso)}
              className={cn(
                'aspect-square rounded-xl flex flex-col items-center justify-center gap-1 border transition-colors active:scale-[0.95]',
                isSelected ? 'bg-primary-600/15 border-primary-500' : isToday ? 'border-primary-500/60' : 'border-transparent hover:border-slate-600',
              )}
            >
              <span className={cn('text-sm font-semibold', isSelected || isToday ? 'text-white' : dayEvents.length ? 'text-slate-200' : 'text-slate-500')}>
                {cell.dom}
              </span>
              {kinds.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {kinds.slice(0, 3).map((k) => (
                    <span key={k} className={cn('w-1.5 h-1.5 rounded-full', KIND_META[k].dot)} />
                  ))}
                  {kinds.length > 3 && <span className="text-[9px] text-slate-400 leading-none">+{kinds.length - 3}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && <SkeletonCard className="mt-4" />}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px] text-slate-500">
        {EVENT_KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full', KIND_META[k].dot)} /> {KIND_META[k].label}
          </span>
        ))}
      </div>

      {/* Selected day */}
      <div className="mt-6">
        <h2 className="text-sm font-bold text-white mb-3">{dateLabel}</h2>
        {selectedEvents.length === 0 ? (
          <EmptyState icon={CalendarDays} title="אין אירועים ביום זה" className="py-8" />
        ) : (
          <div className="space-y-2">
            {selectedEvents.map((event) => (
              <Link
                key={event.id}
                href={`/dashboard/calendar/${event.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/50 p-3.5 hover:border-primary-500/50 hover:bg-slate-800/80 active:scale-[0.98] transition-all"
              >
                <span className={cn('shrink-0 w-2 h-2 rounded-full', KIND_META[event.kind].dot)} />
                <div className="flex-1 min-w-0">
                  <span className={cn('inline-block text-2xs font-bold px-1.5 py-0.5 rounded mb-1', KIND_META[event.kind].badge)}>
                    {KIND_META[event.kind].label}
                  </span>
                  <p className="text-sm font-bold text-white truncate">{event.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    {event.start_time && (
                      <span className="flex items-center gap-1 shrink-0"><Clock className="h-3 w-3" /> {event.start_time.slice(0, 5)}</span>
                    )}
                    <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" /> {event.location}</span>
                  </div>
                </div>
                <ChevronLeft className="h-4 w-4 text-slate-500 shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      <AddEventSheet open={showAddForm} onClose={() => setShowAddForm(false)} onCreated={() => mutate()} />
    </div>
  );
}

// ────────────────────────── Map mode: every upcoming race ──────────────────────────
// Ported from the retired /dashboard/races page (now DB-backed via /api/events
// instead of a hardcoded sample array), with the 14px markers bumped to a real
// touch target and tap-to-expand replacing hover-only affordances.
const RACE_CLASS_COLOR: Record<string, string> = {
  marathon: '#a855f7', half: '#3b82f6', ultra: '#ef4444', '10k': '#10b981', '5k': '#f59e0b', trail: '#22c55e',
};

function RaceMapView({ races }: { races: EventRow[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [selectedRace, setSelectedRace] = useState<string | null>(null);
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...races].sort((a, b) => a.date.localeCompare(b.date)),
    [races],
  );

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current || sorted.length === 0) return;

    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }

    const initMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current, {
        center: [31.5, 34.8],
        zoom: 7,
        zoomControl: false,
        attributionControl: false,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);
      setTimeout(() => map.invalidateSize(), 200);

      sorted.forEach((race) => {
        const color = RACE_CLASS_COLOR[race.race_class || ''] || '#6366f1';
        // 22px (was 14px in the old races page) — meets the .touch-target
        // convention used everywhere else in the app.
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        const marker = L.marker([race.lat, race.lng], { icon }).addTo(map);
        marker.bindTooltip(race.name, { permanent: false, direction: 'top', offset: [0, -14], className: 'race-tooltip' });
        marker.on('click', () => { setSelectedRace(race.id); setExpandedRace(race.id); });
      });

      mapInstanceRef.current = map;
    };

    if ((window as any).L) initMap();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.setAttribute('data-leaflet', '1');
        document.body.appendChild(script);
      }
      script.addEventListener('load', initMap);
    }

    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, [sorted]);

  useEffect(() => {
    if (!mapInstanceRef.current || !selectedRace) return;
    const race = sorted.find((r) => r.id === selectedRace);
    if (race && race.lat != null && race.lng != null) {
      mapInstanceRef.current.flyTo([race.lat, race.lng], 10, { duration: 0.8 });
    }
  }, [selectedRace, sorted]);

  const goalRace = sorted[0];
  const daysUntil = (dateStr: string) => {
    const raceDate = new Date(dateStr + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.ceil((raceDate.getTime() - now.getTime()) / 86400000);
  };

  if (sorted.length === 0) {
    return <EmptyState icon={Trophy} title="אין מרוצים קרובים" description="מרוצים חדשים יופיעו כאן כשיתווספו ליומן" className="py-12" />;
  }

  return (
    <div className="flex flex-col lg:flex-row -mx-4 sm:mx-0 rounded-none sm:rounded-2xl overflow-hidden border-y sm:border border-slate-700/60">
      <div className="lg:flex-1 h-[220px] sm:h-[320px] lg:h-[480px] relative" style={{ zIndex: 0 }}>
        <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />
        {goalRace && (
          <div className="absolute top-3 start-3 z-10 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl p-3.5 max-w-[260px]">
            <p className="text-3xs font-bold text-amber-400 uppercase tracking-wider mb-1">המרוץ הבא שלך</p>
            <p className="text-sm font-bold text-white truncate">{goalRace.name}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xl font-black text-white tabular-nums">{daysUntil(goalRace.date)}</span>
              <span className="text-xs text-slate-400">ימים</span>
            </div>
          </div>
        )}
      </div>

      <div className="lg:w-[360px] border-t lg:border-t-0 lg:border-s border-slate-700/60 overflow-y-auto max-h-[70vh]">
        <div className="p-3 space-y-2">
          {sorted.map((race) => {
            const isExpanded = expandedRace === race.id;
            const isSelected = selectedRace === race.id;
            const color = RACE_CLASS_COLOR[race.race_class || ''] || '#6366f1';
            const dateObj = new Date(race.date + 'T00:00:00');
            const dateLabel = dateObj.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
            return (
              <div key={race.id} className={cn('rounded-xl border transition-colors', isSelected ? 'border-primary-600/50 bg-primary-600/5' : 'border-slate-700/40 bg-slate-800/40')}>
                <button
                  type="button"
                  onClick={() => { setSelectedRace(race.id); setExpandedRace(isExpanded ? null : race.id); }}
                  className="w-full text-start p-3.5 min-h-[44px] active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-3xs text-slate-500">{dateLabel}</span>
                      </div>
                      <p className="text-sm font-bold text-white truncate" dir="auto">{race.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                        <span className="text-xs text-slate-400 truncate" dir="auto">{race.location}</span>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-lg font-black text-white tabular-nums leading-none">{daysUntil(race.date)}</p>
                      <p className="text-3xs text-slate-500 mt-0.5">ימים</p>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-2">
                      {race.distances && race.distances.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Route className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          <div className="flex flex-wrap gap-1">
                            {race.distances.map((d, i) => (
                              <span key={i} className="text-3xs font-medium text-white bg-slate-700/60 px-2 py-0.5 rounded">{d}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <Link
                        href={`/dashboard/calendar/${race.id}`}
                        className="inline-block text-xs text-primary-400 hover:text-primary-300 font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        לפרטים מלאים ←
                      </Link>
                      {race.website && (
                        <a
                          href={race.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="block text-xs text-primary-400 hover:text-primary-300 font-medium"
                        >
                          אתר המרוץ ←
                        </a>
                      )}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx global>{`
        .race-tooltip {
          background: #1e293b !important;
          border: 1px solid #334155 !important;
          border-radius: 8px !important;
          color: white !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 4px 10px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        }
        .race-tooltip::before { border-top-color: #334155 !important; }
      `}</style>
    </div>
  );
}

// ────────────────────────── Staff-only "add event" form ──────────────────────────
function AddEventSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<EventKind>('race');
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayIso());
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setKind('race'); setName(''); setDate(todayIso()); setLocation('');
    setDescription(''); setCapacity(''); setError('');
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date || !location.trim()) {
      setError('שם, תאריך ומיקום הם שדות חובה');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await authedFetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          date,
          location: location.trim(),
          description: description.trim() || undefined,
          capacity: capacity ? Number(capacity) : undefined,
        }),
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || 'שגיאה ביצירת האירוע');
      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה ביצירת האירוע');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }} title="אירוע חדש">
      <form onSubmit={handleSubmit} className="space-y-3.5 px-1 pb-2">
        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1.5">סוג אירוע</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          >
            {EVENT_KINDS.map((k) => (<option key={k} value={k}>{KIND_META[k].label}</option>))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1.5">שם האירוע</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="לדוגמה: הרצאת תזונה לרצים"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-1.5">תפוסה (אופציונלי)</label>
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="ללא הגבלה"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1.5">מיקום</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            placeholder="לדוגמה: מועדון הריצה, הרצליה"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 mb-1.5">תיאור (אופציונלי)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="פרטים נוספים על האירוע..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'שומר...' : 'צור אירוע'}
        </Button>
      </form>
    </Sheet>
  );
}

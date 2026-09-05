'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import {
  CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, Route, Trophy, Calendar as CalendarIcon,
  Tent, BookOpen, PartyPopper, Camera, Gift, Dumbbell, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_MAX_ZOOM_DARK,
  BASEMAP_URL_TEMPLATE_DARK,
} from '@/lib/basemap';
import { useApi } from '@/lib/api';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { getViewMode, MAINTENANCE_MODE, STAFF_ROLES } from '@/lib/impersonation';
import { EVENT_KINDS, type EventKind } from '@/lib/events';
import { Button, EmptyState, Sheet, SkeletonCard, SegmentedControl, InsetSection, InsetRow } from '@/components/ui';

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

// Weekday short labels and the month/year header are derived from the active
// locale (see dowShort/monthLabel below) rather than a hardcoded Hebrew table,
// so an English-locale athlete gets an English, LTR calendar instead of a
// forced-RTL Hebrew one.

// Per-kind color + icon glyph. Picked to stay distinguishable at dot size
// against the dark slate cards: race keeps the app's own brand indigo (it's
// the pre-existing, highest-profile kind), the rest spread across hues that
// don't collide with the green/amber/red already used for attendance status.
// Labels come from next-intl (`kinds.*`), not a hardcoded table.
const KIND_COLOR: Record<EventKind, string> = {
  race: 'bg-brand-600',
  camp: 'bg-accent-600',
  lecture: 'bg-band-3',
  social: 'bg-pink-400',
  photo_shoot: 'bg-band-2',
  sponsor: 'bg-band-3',
  workout: 'bg-ink-300',
};
const KIND_ICON: Record<EventKind, React.ComponentType<{ className?: string }>> = {
  race: Trophy,
  camp: Tent,
  lecture: BookOpen,
  social: PartyPopper,
  photo_shoot: Camera,
  sponsor: Gift,
  workout: Dumbbell,
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
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
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
    .toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const monthLabel = anchor.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' });

  // Weekday short labels (Sun..Sat), derived from the active locale instead of
  // a hardcoded Hebrew table — Jan 1 2023 is a Sunday, used purely as a known
  // anchor to walk through the week.
  const dowShort = useMemo(() => {
    const base = new Date(2023, 0, 1);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toLocaleDateString(dateLocale, { weekday: 'short' });
    });
  }, [dateLocale]);

  return (
    <div className="max-w-4xl mx-auto pb-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-brand-600" /> {t('title')}
          </h1>
          <p className="text-sm text-ink-400 mt-1">{t('subtitle')}</p>
        </div>
        {isStaff && (
          <Button size="sm" onClick={() => setShowAddForm(true)} className="shrink-0">
            <Plus className="h-4 w-4" /> {t('newEvent')}
          </Button>
        )}
      </div>

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'list', label: t('viewCalendar'), icon: CalendarIcon },
          { value: 'map', label: t('viewMap'), icon: Trophy },
        ]}
        className="mb-4"
      />

      {view === 'map' ? (
        <RaceMapView races={races} dateLocale={dateLocale} />
      ) : (
        <>
      {/* Month header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => shiftMonth(1)}
          aria-label={t('nextMonth')}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-card border border-page text-ink-500 hover:text-ink-900 hover:bg-page active:scale-[0.92] transition-all"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-lg font-bold text-ink-700">{monthLabel}</div>
        <button
          onClick={() => shiftMonth(-1)}
          aria-label={t('prevMonth')}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg bg-card border border-page text-ink-500 hover:text-ink-900 hover:bg-page active:scale-[0.92] transition-all"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header (locale-aware: RTL puts Sunday on the right, LTR on the left) */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {dowShort.map((d, i) => (
          <div key={i} className="text-center text-[11px] font-bold text-ink-400">{d}</div>
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
                isSelected ? 'bg-brand-600/15 border-brand-600' : isToday ? 'border-brand-600/60' : 'border-transparent hover:border-ink-300',
              )}
            >
              <span className={cn('text-sm font-semibold', isSelected || isToday ? 'text-ink-700' : dayEvents.length ? 'text-ink-700' : 'text-ink-400')}>
                {cell.dom}
              </span>
              {kinds.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {kinds.slice(0, 3).map((k) => (
                    <span key={k} className={cn('w-1.5 h-1.5 rounded-full', KIND_COLOR[k])} />
                  ))}
                  {kinds.length > 3 && <span className="text-[9px] text-ink-400 leading-none">+{kinds.length - 3}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && <SkeletonCard className="mt-4" />}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-4 text-[11px] text-ink-400">
        {EVENT_KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full', KIND_COLOR[k])} /> {t(`kinds.${k}`)}
          </span>
        ))}
      </div>

      {/* Selected day */}
      <div className="mt-6">
        <h2 className="text-sm font-bold text-ink-700 mb-3">{dateLabel}</h2>
        {selectedEvents.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('noEventsThisDay')} className="py-8" />
        ) : (
          <InsetSection>
            {selectedEvents.map((event) => (
              <InsetRow
                key={event.id}
                icon={KIND_ICON[event.kind]}
                iconBg={KIND_COLOR[event.kind]}
                label={event.name}
                sublabel={[event.start_time ? event.start_time.slice(0, 5) : null, event.location].filter(Boolean).join(' · ')}
                href={`/dashboard/calendar/${event.id}`}
              />
            ))}
          </InsetSection>
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

function RaceMapView({ races, dateLocale }: { races: EventRow[]; dateLocale: string }) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
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
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      // Was CARTO's `dark_all`, which now answers 200 with "API KEY REQUIRED"
      // stamped across every tile — this map had been quietly watermarked. Kept
      // dark to leave the page looking as intended; provider lives in lib/basemap.
      L.tileLayer(BASEMAP_URL_TEMPLATE_DARK, {
        // The dark canvas cache stops at 16 — three levels shallower than the
        // street plate the route maps use, hence its own constant.
        maxZoom: BASEMAP_MAX_ZOOM_DARK,
        attribution: BASEMAP_ATTRIBUTION,
      }).addTo(map);
      setTimeout(() => map.invalidateSize(), 200);

      sorted.forEach((race) => {
        const color = RACE_CLASS_COLOR[race.race_class || ''] || '#6366f1';
        // The tappable icon is a real 44x44 hit area (the app-wide touch-target
        // minimum) with a compact 20px dot centered inside it, so the visual
        // stays small while the tap target doesn't.
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;"><div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22],
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
    return <EmptyState icon={Trophy} title={t('noUpcomingRaces')} description={t('noUpcomingRacesHint')} className="py-12" />;
  }

  return (
    <div className="flex flex-col lg:flex-row -mx-4 sm:mx-0 rounded-none sm:rounded-2xl overflow-hidden border-y sm:border border-page/60">
      <div className="lg:flex-1 h-[220px] sm:h-[320px] lg:h-[480px] relative" style={{ zIndex: 0 }}>
        <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />
        {goalRace && (
          <div className="absolute top-3 start-3 z-10 bg-page/90 backdrop-blur border border-page rounded-xl p-3.5 max-w-[260px]">
            <p className="text-3xs font-bold text-band-3 uppercase tracking-wider mb-1">{t('nextRace')}</p>
            <p className="text-sm font-bold text-ink-700 truncate">{goalRace.name}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-xl font-black text-ink-700 tabular-nums">{daysUntil(goalRace.date)}</span>
              <span className="text-xs text-ink-400">{tc('days')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Race list — same grouped-card chrome (rounded-2xl bg-card/80
          border-page/50, divide-y dividers) as InsetSection/InsetRow, kept
          as a local list rather than the shared primitive because each row's
          tap-to-expand reveal (distances + links) has no InsetRow equivalent. */}
      <div className="lg:w-[360px] border-t lg:border-t-0 lg:border-s border-page/60 overflow-y-auto max-h-[70vh]">
        <div className="p-3">
          <div className="rounded-card bg-card/80 border border-page/50 overflow-hidden divide-y divide-page/50">
          {sorted.map((race) => {
            const isExpanded = expandedRace === race.id;
            const isSelected = selectedRace === race.id;
            const color = RACE_CLASS_COLOR[race.race_class || ''] || '#6366f1';
            const dateObj = new Date(race.date + 'T00:00:00');
            const dateLabel = dateObj.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });
            return (
              <div key={race.id} className={cn('transition-colors', isSelected && 'bg-brand-600/5')}>
                <button
                  type="button"
                  onClick={() => { setSelectedRace(race.id); setExpandedRace(isExpanded ? null : race.id); }}
                  className="w-full text-start px-4 py-3 min-h-[52px] active:scale-[0.98] transition-transform"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-3xs text-ink-400">{dateLabel}</span>
                      </div>
                      <p className="text-sm font-bold text-ink-700 truncate" dir="auto">{race.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <MapPin className="h-3 w-3 text-ink-400 shrink-0" />
                        <span className="text-xs text-ink-400 truncate" dir="auto">{race.location}</span>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-lg font-black text-ink-700 tabular-nums leading-none">{daysUntil(race.date)}</p>
                      <p className="text-3xs text-ink-400 mt-0.5">{tc('days')}</p>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-page/40 space-y-2">
                      {race.distances && race.distances.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Route className="h-3.5 w-3.5 text-ink-400 shrink-0" />
                          <div className="flex flex-wrap gap-1">
                            {race.distances.map((d, i) => (
                              <span key={i} className="text-3xs font-medium text-ink-700 bg-page/60 px-2 py-0.5 rounded">{d}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      <Link
                        href={`/dashboard/calendar/${race.id}`}
                        className="inline-block text-xs text-brand-600 hover:text-brand-700 font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('fullDetails')}
                      </Link>
                      {race.website && (
                        <a
                          href={race.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="block text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          {t('raceWebsite')}
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
      </div>

      <style jsx global>{`
        /* Stays a dark tooltip on purpose — it floats over a colourful map tile,
           where a white bubble would disappear into the roads. Retuned from navy
           to the light system's ink ramp (ink-900 on ink-700). */
        .race-tooltip {
          background: #1D1E26 !important;
          border: 1px solid #2D2E38 !important;
          border-radius: 8px !important;
          color: white !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 4px 10px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        }
        .race-tooltip::before { border-top-color: #2D2E38 !important; }
      `}</style>
    </div>
  );
}

// ────────────────────────── Staff-only "add event" form ──────────────────────────
function AddEventSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations('calendar');
  const [kind, setKind] = useState<EventKind>('race');
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
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

  const handleSubmit = async () => {
    if (!name.trim() || !date || !location.trim()) {
      setError(t('addEvent.requiredError'));
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
      if (!res.ok) throw new Error(responseData.error || t('addEvent.genericError'));
      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addEvent.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }} title={t('addEvent.title')}>
        <div className="space-y-3.5 px-1 pb-2">
          {/* iOS Settings-style form: a tap-to-open row for the kind picker
              (opens the nested Sheet below) plus one labeled row per field,
              grouped in the same InsetSection/InsetRow chrome used across the
              app — replacing the raw <select>/<input> HTML form. */}
          <InsetSection>
            <InsetRow
              label={t('addEvent.kind')}
              value={t(`kinds.${kind}`)}
              onClick={() => setKindPickerOpen(true)}
            />
            <InsetRow
              label={t('addEvent.name')}
              trailing={
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('addEvent.namePlaceholder')}
                  dir="auto"
                  className="w-36 sm:w-48 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.date')}
              trailing={
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-transparent text-sm text-ink-700 focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.capacity')}
              trailing={
                <input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder={t('addEvent.capacityPlaceholder')}
                  className="w-24 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.location')}
              trailing={
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t('addEvent.locationPlaceholder')}
                  dir="auto"
                  className="w-36 sm:w-48 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            <div className="px-4 py-3">
              <label className="block text-xs font-bold text-ink-400 mb-1.5">{t('addEvent.description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t('addEvent.descriptionPlaceholder')}
                dir="auto"
                className="w-full bg-transparent text-sm text-ink-700 placeholder-ink-400 focus:outline-none resize-none"
              />
            </div>
          </InsetSection>

          {error && <p className="text-sm text-accent-red">{error}</p>}

          <Button type="button" onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? t('addEvent.saving') : t('addEvent.create')}
          </Button>
        </div>
      </Sheet>

      {/* Kind picker — a nested option-picker Sheet listing the 7 kinds as
          InsetRow items, opened by tapping the "kind" row above. */}
      <Sheet open={kindPickerOpen} onOpenChange={setKindPickerOpen} title={t('addEvent.kind')}>
        <InsetSection>
          {EVENT_KINDS.map((k) => (
            <InsetRow
              key={k}
              icon={KIND_ICON[k]}
              iconBg={KIND_COLOR[k]}
              label={t(`kinds.${k}`)}
              onClick={() => { setKind(k); setKindPickerOpen(false); }}
              trailing={kind === k ? <Check className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
            />
          ))}
        </InsetSection>
      </Sheet>
    </>
  );
}

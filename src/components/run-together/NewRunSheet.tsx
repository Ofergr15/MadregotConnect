'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LocateFixed, Minus, Plus, X } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { cn } from '@/lib/utils';
import { loadLeaflet } from '@/lib/leaflet';
import { BASEMAP_ATTRIBUTION, BASEMAP_MAX_ZOOM, BASEMAP_URL_TEMPLATE } from '@/lib/basemap';
import { addDaysIso, dayHeading, KIND_LABEL, paceToSeconds, secondsToPace, type MeetupKind, type MeetupPerson, type RunMeetup } from '@/lib/runs/meetups';
import { RunCard, packHex } from './parts';

// "+ ריצה חדשה" (mockup screen 3): one screen, the card exactly as others will see it
// at the top, and every field a tap — the kind, the day, the time, a club spot or a
// pin, distance and pace from the runner's usual one, and who is told.

const KINDS: Array<{ k: MeetupKind; e: string }> = [{ k: 'easy', e: '🌿' }, { k: 'long', e: '🛣️' }, { k: 'quality', e: '⚡' }, { k: 'recovery', e: '🧘' }];
const DEFAULT_KM: Record<MeetupKind, number> = { easy: 10, long: 20, quality: 12, recovery: 6 };
const TIMES = ['05:00', '05:30', '06:00', '06:30', '19:00'];

export interface Spot { name: string; lat: number; lng: number }

export function NewRunSheet({ open, onClose, onPosted, spots, today, me, myPace }: {
  open: boolean; onClose: () => void; onPosted: (id: string) => void;
  spots: Spot[]; today: string; me: MeetupPerson | null; myPace: string | null;
}) {
  const [kind, setKind] = useState<MeetupKind>('easy');
  const [date, setDate] = useState(addDaysIso(today, 1));
  const [time, setTime] = useState('06:00');
  const [customTime, setCustomTime] = useState(false);
  const [place, setPlace] = useState<Spot | null>(spots[0] ?? null);
  const [placeName, setPlaceName] = useState(spots[0]?.name ?? '');
  const [km, setKm] = useState(DEFAULT_KM.easy);
  const [pace, setPace] = useState(myPace || '5:30');
  const [notes, setNotes] = useState('');
  const [audience, setAudience] = useState<'pack' | 'club'>('pack');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (open) { setError(null); setBusy(false); } }, [open]);
  useEffect(() => { if (!open) return; const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = prev; }; }, [open]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(today, i)), [today]);
  const stepPace = (d: number) => {
    const s = paceToSeconds(pace) ?? 330;
    setPace(secondsToPace(Math.min(12 * 60, Math.max(150, s + d))));
  };
  const pickKind = (k: MeetupKind) => { setKind(k); setKm(DEFAULT_KM[k]); };

  const preview: RunMeetup | null = me ? {
    id: 'preview', host: me, date, startTime: time, location: placeName || 'איפה?', lat: place?.lat ?? null, lng: place?.lng ?? null,
    kind, plannedPace: pace, distanceKm: km, notes: notes || null, audience, pack: me.pack, going: [me], isHost: true, joined: false, messageCount: 0,
  } : null;

  const publish = async () => {
    if (!placeName.trim()) { setError('איפה נפגשים? בחרו מקום או סמנו על המפה'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/runs/meetups', {
        method: 'POST', headers: await apiHeaders(true),
        body: JSON.stringify({ date, startTime: time, location: placeName.trim(), lat: place?.lat, lng: place?.lng, kind, distanceKm: km, plannedPace: pace, notes, audience }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.field === 'date' ? 'התאריך לא תקין' : data?.field === 'startTime' ? 'השעה לא תקינה' : data?.field === 'plannedPace' ? 'הקצב לא תקין' : 'לא הצלחנו לפרסם');
      onPosted(data.id);
    } catch (e) {
      setError((e as Error).message || 'לא הצלחנו לפרסם');
      setBusy(false);
    }
  };

  if (!mounted || !open) return null;
  const label = 'mb-2 mt-4 px-0.5 text-[12.5px] font-extrabold text-ink-400';
  return createPortal(
    <div className="fixed inset-0 z-[300]" dir="rtl" role="dialog" aria-modal="true" aria-label="ריצה חדשה">
      <div className="absolute inset-0 bg-ink-900/35" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),12px)] mx-auto flex max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-card shadow-2xl">
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <button type="button" onClick={onClose} aria-label="סגירה" className="flex h-11 w-11 items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-page text-ink-500"><X className="h-[18px] w-[18px]" /></span></button>
          <b className="text-[17px] font-black text-ink-900">ריצה חדשה</b>
          <button type="button" onClick={() => void publish()} disabled={busy} className="flex h-11 items-center"><span className="flex h-9 items-center rounded-full bg-brand-600 px-4 text-sm font-black text-white">{busy ? '…' : 'פרסום'}</span></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {preview && (
            <div className="rounded-[20px] bg-page p-2">
              <p className="mx-1.5 mb-1.5 text-[11px] font-extrabold text-ink-400">כך יראו את זה</p>
              <div className="pointer-events-none" aria-hidden><RunCard m={preview} myPace={myPace} dayLabel={dayHeading(date, today).title} /></div>
            </div>
          )}

          <p className={label}>איזו ריצה</p>
          <div className="grid grid-cols-4 gap-2">
            {KINDS.map(({ k, e }) => (
              <button key={k} type="button" onClick={() => pickKind(k)} aria-pressed={kind === k}
                className={cn('flex h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[13px] font-extrabold', kind === k ? 'bg-brand-600/10 text-brand-600 ring-2 ring-inset ring-brand-600' : 'bg-page text-ink-700')}>
                <span className="text-xl">{e}</span>{KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <p className={label}>מתי</p>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {days.map((d) => {
              const h = dayHeading(d, today);
              return (
                <button key={d} type="button" onClick={() => setDate(d)} aria-pressed={date === d}
                  className={cn('flex h-[58px] w-[54px] shrink-0 flex-col items-center justify-center rounded-2xl', date === d ? 'bg-ink-900 text-white' : 'bg-page text-ink-900')}>
                  <small className={cn('text-[11px] font-bold', date === d ? 'text-white/70' : 'text-ink-400')}>{h.title}</small>
                  <b className="text-lg font-black leading-tight">{Number(d.slice(8, 10))}</b>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TIMES.map((t) => (
              <button key={t} type="button" onClick={() => { setTime(t); setCustomTime(false); }} aria-pressed={!customTime && time === t}
                className={cn('h-11 rounded-xl px-3.5 text-sm font-extrabold', !customTime && time === t ? 'bg-brand-600 text-white' : 'bg-page text-ink-900')}><bdi>{t}</bdi></button>
            ))}
            {customTime
              ? <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="שעה" className="h-11 rounded-xl bg-brand-600/10 px-3 text-base font-extrabold text-brand-600 ring-2 ring-brand-600" />
              : <button type="button" onClick={() => setCustomTime(true)} className="h-11 rounded-xl bg-page px-3.5 text-sm font-extrabold text-ink-900">שעה אחרת…</button>}
          </div>

          <p className={label}>איפה נפגשים</p>
          <PointPicker point={place} color={packHex(me?.pack)} onPick={(p) => { setPlace(p); }} className="h-[150px] w-full overflow-hidden rounded-2xl" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {spots.map((s) => (
              <button key={s.name} type="button" onClick={() => { setPlace(s); setPlaceName(s.name); }} aria-pressed={placeName === s.name}
                className={cn('h-11 rounded-xl px-3 text-[13px] font-extrabold', placeName === s.name ? 'bg-brand-600/10 text-brand-600 ring-[1.5px] ring-inset ring-brand-600' : 'bg-page text-ink-900')}><bdi>{s.name}</bdi></button>
            ))}
            <LocateButton onLocate={(p) => { setPlace(p); setPlaceName(''); }} />
          </div>
          <input value={placeName} onChange={(e) => setPlaceName(e.target.value)} maxLength={80} placeholder="שם המקום — למשל ״הכניסה לפארק, ליד החניה״" aria-label="שם המקום"
            className="mt-2 h-12 w-full rounded-xl bg-page px-3.5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Stepper label="מרחק" value={`${km} ק״מ`} onMinus={() => setKm((k) => Math.max(1, k - 1))} onPlus={() => setKm((k) => Math.min(60, k + 1))} />
            <Stepper label="קצב" value={pace} hint={myPace ? 'הקצב הרגיל שלך' : undefined} onMinus={() => stepPace(-5)} onPlus={() => stepPace(5)} />
          </div>

          <p className={label}>משהו להוסיף? (לא חובה)</p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={280} placeholder="״קצב נוח, מים בחצי״" aria-label="הערה"
            className="w-full resize-none rounded-xl bg-page px-3.5 py-2.5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />

          <p className={label}>מי יקבל התראה</p>
          <div className="grid grid-cols-2 gap-2">
            {(['pack', 'club'] as const).map((a) => (
              <button key={a} type="button" onClick={() => setAudience(a)} aria-pressed={audience === a}
                className={cn('flex min-h-[56px] flex-col items-start justify-center rounded-2xl px-3.5 text-start', audience === a ? 'bg-card ring-2 ring-brand-600' : 'bg-page')}>
                <b className="text-[14px] font-black text-ink-900">{a === 'pack' ? (me?.pack ? `דבוקה ${me.pack}` : 'הדבוקה שלי') : 'כל המועדון'}</b>
                <small className="text-[12px] font-bold text-ink-400">{a === 'pack' ? 'מי שרץ בקצב שלך' : 'כולם יראו בלוח בכל מקרה'}</small>
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm font-bold text-accent-red" role="alert">{error}</p>}
          <button type="button" onClick={() => void publish()} disabled={busy}
            className="mt-4 h-[52px] w-full rounded-2xl bg-brand-600 text-base font-black text-white shadow-[0_10px_20px_-10px_rgba(21,37,255,0.7)] disabled:opacity-60">{busy ? 'מפרסם…' : 'פרסום'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stepper({ label, value, hint, onMinus, onPlus }: { label: string; value: string; hint?: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="rounded-2xl bg-page px-2.5 py-2">
      <small className="px-1 text-[11.5px] font-bold text-ink-400">{label}</small>
      <div className="mt-0.5 flex items-center justify-between">
        <button type="button" onClick={onPlus} aria-label={`${label} +`} className="flex h-11 w-11 items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-brand-600"><Plus className="h-4 w-4" strokeWidth={3} /></span></button>
        <b className="text-lg font-black text-ink-900"><bdi>{value}</bdi></b>
        <button type="button" onClick={onMinus} aria-label={`${label} −`} className="flex h-11 w-11 items-center justify-center"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-brand-600"><Minus className="h-4 w-4" strokeWidth={3} /></span></button>
      </div>
      {hint && <p className="px-1 text-[10.5px] font-extrabold text-brand-600">{hint}</p>}
    </div>
  );
}

function LocateButton({ onLocate }: { onLocate: (p: Spot) => void }) {
  const [busy, setBusy] = useState(false);
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return (
    <button type="button" disabled={busy} onClick={() => {
      setBusy(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => { setBusy(false); onLocate({ name: '', lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => setBusy(false), { enableHighAccuracy: true, timeout: 8000 },
      );
    }} className="flex h-11 items-center gap-1 rounded-xl bg-card px-3 text-[13px] font-extrabold text-brand-600 ring-1 ring-inset ring-ink-300/40">
      <LocateFixed className="h-4 w-4" />{busy ? 'מאתר…' : 'איפה שאני'}
    </button>
  );
}

/** A small map: tap to drop the meeting point; a chosen spot moves the pin there. */
function PointPicker({ point, color, onPick, className }: { point: Spot | null; color: string; onPick: (p: Spot) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const lib = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const pinHtml = `<i style="position:absolute;width:22px;height:22px;left:-11px;top:-26px;background:${color};border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 3px 8px rgba(0,0,0,.35)"></i>`;
  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      lib.current = L;
      const start: [number, number] = point ? [point.lat, point.lng] : [32.1, 34.79];
      map.current = L.map(el.current, { center: start, zoom: point ? 15 : 12, zoomControl: false, attributionControl: false });
      L.tileLayer(BASEMAP_URL_TEMPLATE, { maxZoom: BASEMAP_MAX_ZOOM, attribution: BASEMAP_ATTRIBUTION }).addTo(map.current);
      map.current.on('click', (e: { latlng: { lat: number; lng: number } }) => onPick({ name: '', lat: e.latlng.lat, lng: e.latlng.lng }));
      setTimeout(() => map.current?.invalidateSize(), 150);
      setReady(true);
    }).catch(() => {});
    return () => { dead = true; map.current?.remove(); map.current = null; marker.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const L = lib.current;
    if (!L || !map.current) return;
    if (!point) { marker.current?.remove(); marker.current = null; return; }
    const icon = L.divIcon({ className: 'rt-pin', html: pinHtml, iconSize: [0, 0], iconAnchor: [0, 0] });
    if (marker.current) marker.current.setLatLng([point.lat, point.lng]).setIcon(icon);
    else marker.current = L.marker([point.lat, point.lng], { icon }).addTo(map.current);
    map.current.setView([point.lat, point.lng], Math.max(map.current.getZoom(), 15), { animate: true });
  }, [point?.lat, point?.lng, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className={className} dir="ltr" />;
}

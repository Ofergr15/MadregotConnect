'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { YearStory } from '@/components/birthday/YearStory';
import type { BirthdayConfig, BirthdayStory, PhotoSlot } from '@/lib/birthday-year/server';
import { typeClock } from '@/lib/time-entry';

// What goes INSIDE one birthday story (moved from the old ימי הולדת page, 10-20): the name
// in Hebrew, a personal word (the thank-you slide shows only with one), the official time of
// the run of the year, and the photos per slide. "תצוגה" plays the real story.

const SLOTS: Array<[PhotoSlot, string]> = [
  ['intro', 'פתיחה'], ['thanks', 'תודה'], ['km', 'קילומטרים'], ['streak', 'רצף'],
  ['moment', 'ריצת השנה'], ['long', 'הכי ארוכה'], ['climb', 'טיפוס'], ['poster', 'הסיכום'],
];

const toClock = (s?: number | null) => (s ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : '');
const fromClock = (t: string) => {
  const p = t.trim().split(':').map(Number);
  if (!p.length || p.some((x) => !Number.isFinite(x))) return null;
  return p.reduce((a, x) => a * 60 + x, 0) || null;
};

export interface PrepRow { athleteId: string; name: string | null; birthday: string; config: BirthdayConfig }

/** The prep form for one person's birthday story. Saves to /api/admin/birthdays. */
export function BirthdayPrep({ row, onSaved }: { row: PrepRow; onSaved?: () => void }) {
  const [cfg, setCfg] = useState<BirthdayConfig>(row.config);
  const [time, setTime] = useState(toClock(row.config.momentSeconds));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<PhotoSlot | null>(null);
  const [preview, setPreview] = useState<BirthdayStory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const slotFor = useRef<PhotoSlot | null>(null);
  useEffect(() => { setCfg(row.config); setTime(toClock(row.config.momentSeconds)); }, [row.config]);

  const save = async (next: BirthdayConfig = cfg) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/admin/birthdays', {
        method: 'PUT', headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId: row.athleteId, birthday: row.birthday, ...next, momentSeconds: fromClock(time) }),
      });
      if (!res.ok) throw new Error();
      setSaved(true); setTimeout(() => setSaved(false), 1800);
      onSaved?.();
    } catch {
      setErr('השמירה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File) => {
    const slot = slotFor.current;
    if (!slot) return;
    setUploading(slot); setErr(null);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await fetch('/api/admin/birthdays/photo', { method: 'POST', headers: await bearerHeaders(false), body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || 'upload');
      const next = { ...cfg, photos: { ...(cfg.photos || {}), [slot]: json.url } };
      setCfg(next);
      await save(next);
    } catch (e) {
      setErr((e as Error).message === 'upload' ? 'ההעלאה נכשלה' : (e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const removePhoto = (slot: PhotoSlot) => {
    const photos = { ...(cfg.photos || {}) };
    delete photos[slot];
    const next = { ...cfg, photos };
    setCfg(next);
    void save(next);
  };

  const play = async () => {
    setErr(null);
    await save();
    const res = await fetch(`/api/birthday-year?athleteId=${encodeURIComponent(row.athleteId)}&preview=1`, { headers: await apiHeaders() });
    const json = await res.json().catch(() => ({}));
    if (json.story) setPreview(json.story); else setErr('אין נתונים לשנה הזו');
  };

  return (
    <div className="overflow-hidden rounded-[18px] bg-card">
        <div className="space-y-3 px-4 pb-4 pt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-ink-400">השם בסטורי (בעברית)</span>
            <input value={cfg.displayName ?? ''} onChange={(e) => setCfg({ ...cfg, displayName: e.target.value })} placeholder={(row.name || '').split(' ')[0]} dir="rtl"
              className="h-11 w-full rounded-xl bg-[#F0F0F4] px-3 text-[15px] text-ink-900 focus:outline-none" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-ink-400">מילה אישית מהמועדון (שקף ״תודה״ — בלי טקסט אין שקף). שורה חדשה = פסקה.</span>
            <textarea value={cfg.message ?? ''} onChange={(e) => setCfg({ ...cfg, message: e.target.value })} rows={4} maxLength={600} dir="rtl"
              className="w-full resize-none rounded-xl bg-[#F0F0F4] px-3 py-2.5 text-[15px] leading-relaxed text-ink-900 focus:outline-none" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink-400">שם הריצה של השנה</span>
              <input value={cfg.momentTitle ?? ''} onChange={(e) => setCfg({ ...cfg, momentTitle: e.target.value })} placeholder="מרתון ברלין" dir="rtl"
                className="h-11 w-full rounded-xl bg-[#F0F0F4] px-3 text-[15px] text-ink-900 focus:outline-none" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink-400">זמן רשמי (אם שונה מהשעון)</span>
              <input value={time} onChange={(e) => setTime(typeClock(e.target.value))} placeholder="2:31:48" dir="ltr" inputMode="numeric"
                className="h-11 w-full rounded-xl bg-[#F0F0F4] px-3 text-end text-[15px] text-ink-900 focus:outline-none" />
            </label>
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-bold text-ink-400">תמונות לפי שקף · בלי תמונה: תמונת מועדון, או רקע בלי תמונה</span>
            <div className="grid grid-cols-4 gap-2">
              {SLOTS.map(([slot, label]) => {
                const url = cfg.photos?.[slot];
                return (
                  <div key={slot} className="relative text-center">
                    <button type="button" onClick={() => { slotFor.current = slot; file.current?.click(); }}
                      className={cn('relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl', url ? '' : 'border-2 border-dashed border-ink-300 text-ink-400')}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : uploading === slot ? '…' : <ImagePlus className="h-5 w-5" />}
                    </button>
                    {url && (
                      <button type="button" onClick={() => removePhoto(slot)} aria-label={`הסרת התמונה של ${label}`}
                        className="absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white"><X className="h-3.5 w-3.5" /></button>
                    )}
                    <span className="mt-1 block truncate text-[11px] font-bold text-ink-500">{label}</span>
                  </div>
                );
              })}
            </div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
          </div>
          {err && <p className="text-[13px] font-bold text-accent-red-ink" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={busy} className="h-12 flex-1 rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white disabled:opacity-60">{saved ? 'נשמר ✓' : 'שמירת התוכן'}</button>
            <button type="button" onClick={() => void play()} className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#F0F0F4] text-[15px] font-extrabold text-ink-900"><Play className="h-4 w-4" />הסטורי המלא</button>
          </div>
        </div>
      {preview && <YearStory story={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

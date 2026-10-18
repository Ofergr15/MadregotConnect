'use client';

import { useState } from 'react';
import { Camera, FolderOpen, Plus } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet } from '@/components/ui';
import { cn, israelToday } from '@/lib/utils';
import { sessionDayLabel } from '@/lib/quality-session/photos';

// ═════════════════════════════════════════════════════════════════════════════
// Social (admin) — mockup ~/.cache/madregot/social-panel/mockup.html, without the
// "past workouts" tab (Ofer, 2026-10-18: "start without it"). This week's photo
// folders: the quality days the weekly plan picked, each with when its folder is
// made (20:00 the evening before) and its name; the folders already made; and a
// folder for any day, now.
// ═════════════════════════════════════════════════════════════════════════════

interface Week {
  configured: boolean;
  upcoming: Array<{ date: string; name: string; workout: string | null; createsAt: string }>;
  made: Array<{ date: string; name: string; link: string; manual: boolean; autoFeed: boolean; photos: number; inFeed: boolean }>;
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dow = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
const dayNum = (iso: string) => Number(iso.slice(8, 10));

function DayBox({ date }: { date: string }) {
  return (
    <div className="w-11 shrink-0 rounded-[10px] bg-page py-1 text-center">
      <b className="block text-[17px] leading-tight text-ink-900">{dayNum(date)}</b>
      <small className="text-[10px] font-bold text-ink-400">{DAYS[dow(date)]}</small>
    </div>
  );
}

export default function SocialPage() {
  const { data, error, mutate } = useApi<Week>('/api/social/folders');
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3 pb-6" dir="rtl">
      <h1 className="text-[28px] font-black text-ink-700">Social</h1>

      {error && <p className="rounded-card bg-card p-4 text-sm text-ink-500">אין גישה למסך הזה, או שהטעינה נכשלה.</p>}
      {data && !data.configured && (
        <p className="rounded-card bg-band-3/15 p-4 text-sm text-band-3-ink">הדרייב עוד לא מחובר לאפליקציה — אין איפה ליצור תיקיות.</p>
      )}

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!data?.configured}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-pill bg-ink-900 text-[15px] font-extrabold text-white disabled:opacity-40"
      >
        <Plus className="h-4 w-4" /> תיקייה חדשה עכשיו
      </button>

      <p className="px-1 text-2xs font-bold text-ink-400">אימוני איכות — מהתוכנית השבועית</p>
      <section className="rounded-card bg-card px-4">
        {!data ? (
          <p className="py-4 text-sm text-ink-400">טוען…</p>
        ) : data.upcoming.length === 0 ? (
          <p className="py-4 text-sm text-ink-400">אין אימון איכות בשבוע הקרוב. בוחרים ימים בתוכנית השבועית.</p>
        ) : data.upcoming.map((u) => (
          <div key={u.date} className="flex items-start gap-3 border-b border-page py-3 last:border-0">
            <DayBox date={u.date} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold text-ink-900">{u.name}</p>
              {u.workout && <p className="text-xs text-ink-400">{u.workout}</p>}
              <span className="mt-1.5 inline-flex rounded-md bg-band-3/15 px-2 py-0.5 text-2xs font-extrabold text-band-3-ink">
                ⏰ התיקייה תיווצר {DAYS[dow(u.createsAt)]} {sessionDayLabel(u.createsAt.slice(0, 10)).split(' ')[1]} ב־20:00
              </span>
            </div>
          </div>
        ))}
      </section>

      <p className="px-1 text-2xs font-bold text-ink-400">תיקיות שנוצרו</p>
      <section className="rounded-card bg-card px-4">
        {!data ? null : data.made.length === 0 ? (
          <p className="py-4 text-sm text-ink-400">עוד לא נוצרה תיקייה.</p>
        ) : data.made.map((m) => (
          <div key={m.date} className="flex items-start gap-3 border-b border-page py-3 last:border-0">
            <DayBox date={m.date} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold text-ink-900">{m.name}</p>
              <p className="text-xs text-ink-400">{m.manual ? 'נוצרה ידנית' : 'נוצרה אוטומטית ערב לפני'}{m.autoFeed ? '' : ' · לא עולה לפיד לבד'}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <a href={m.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-[#E8F0FE] px-3 text-xs font-extrabold text-[#1967d2]">
                  <FolderOpen className="h-3.5 w-3.5" /> פתיחה בדרייב
                </a>
                <span className={cn('inline-flex min-h-[44px] items-center gap-1 rounded-lg px-3 text-xs font-extrabold', m.inFeed ? 'bg-accent-600/15 text-accent-900' : 'bg-page text-ink-400')}>
                  <Camera className="h-3.5 w-3.5" /> {m.inFeed ? `${m.photos} תמונות · בפיד` : 'עוד בלי תמונות בפיד'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <NewFolderSheet open={open} onOpenChange={setOpen} onMade={() => { void mutate(); }} />
    </div>
  );
}

function NewFolderSheet({ open, onOpenChange, onMade }: { open: boolean; onOpenChange: (o: boolean) => void; onMade: () => void }) {
  const [date, setDate] = useState(israelToday());
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(true);
  const [autoFeed, setAutoFeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ link: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const placeholder = `אימון · ${sessionDayLabel(date)}`;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/social/folders', {
        method: 'POST',
        headers: { ...(await bearerHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, name: name.trim() || placeholder, notifyEditors: notify, autoFeed }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'failed');
      setMade({ link: out.folder.link });
      onMade();
    } catch {
      setErr('לא הצלחתי ליצור את התיקייה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setMade(null); setErr(null); } }} title="תיקייה חדשה לתמונות">
      <div className="space-y-3 px-4 pb-6" dir="rtl">
        <label className="block text-xs font-semibold text-ink-400">
          לאיזה יום
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </label>
        <label className="block text-xs font-semibold text-ink-400">
          שם התיקייה
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder}
            className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </label>
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink-700">
          <span>לשלוח את הקישור לעורכי האינסטגרם</span>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink-700">
          <span>תמונות שיעלו — לפיד לבד</span>
          <input type="checkbox" checked={autoFeed} onChange={(e) => setAutoFeed(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
        <button type="button" onClick={create} disabled={busy}
          className="min-h-[50px] w-full rounded-pill bg-brand-600 text-base font-extrabold text-white disabled:opacity-50">
          {busy ? 'יוצר…' : 'ליצור תיקייה'}
        </button>
        {made && (
          <p className="rounded-xl bg-accent-600/15 px-3 py-2.5 text-sm font-bold text-accent-900">
            ✓ נוצרה בדרייב · <a href={made.link} target="_blank" rel="noopener noreferrer" className="underline">פתיחה</a>
            {' · '}
            <button type="button" className="underline" onClick={() => navigator.clipboard?.writeText(made.link)}>העתקת קישור</button>
          </p>
        )}
        {err && <p className="text-center text-sm font-bold text-accent-red">{err}</p>}
      </div>
    </Sheet>
  );
}

'use client';

import { useState } from 'react';
import { FOLDER_KINDS, KIND_LABEL, SUGGESTED_TAGS, tagColor, type FolderKind } from '@/lib/photos/folder-kind';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet } from '@/components/ui';
import { cn, israelToday } from '@/lib/utils';
import { sessionDayLabel } from '@/lib/quality-session/photos';

// ═════════════════════════════════════════════════════════════════════════════
// The photo folders' sheets and their API, shared by "תוכן › תמונות" (Content v4).
// Moved from the Social screen (10-18..10-20), which now redirects there: the
// new-folder sheet (now or at a day and time), the proposal's edit sheet, and the
// kind/tags and "מתי ליצור" pickers inside both.
// ═════════════════════════════════════════════════════════════════════════════

export interface Week {
  configured: boolean;
  upcoming: Proposal[];
  made: Array<{ date: string; name: string; link: string; manual: boolean; autoFeed: boolean; photos: number; inFeed: boolean }>;
}

export interface Proposal {
  date: string; name: string; workout: string | null; kind: FolderKind; tags: string[];
  createsAt: string; enabled: boolean; source: 'plan' | 'race' | 'manual';
}

export async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const res = await fetch('/api/social/folders', {
    method,
    headers: { ...(await bearerHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'failed');
  return out;
}

export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dow = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const pad = (n: number) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${israelToday()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const shiftDay = (date: string, by: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10);
};
/** "שני 19.10 ב־20:00" */
export const whenLabel = (at: string) => `${DAYS[dow(at)]} ${sessionDayLabel(at.slice(0, 10)).split(' ')[1]} ב־${at.slice(11, 16)}`;
export const SOURCE_LABEL = { plan: 'מהתוכנית', race: 'מירוץ מהלוח', manual: 'מתוזמנת ידנית' } as const;

export function NewFolderSheet({ open, onOpenChange, onMade }: { open: boolean; onOpenChange: (o: boolean) => void; onMade: () => void }) {
  const [date, setDate] = useState(israelToday());
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(true);
  const [autoFeed, setAutoFeed] = useState(true);
  // What the photos screen files it under (lib/photos/folder-kind), and its special tags.
  const [kind, setKind] = useState<FolderKind>('quality');
  const [tags, setTags] = useState<string[]>([]);
  const [when, setWhen] = useState<'now' | 'at'>('now');
  const [at, setAt] = useState(`${shiftDay(israelToday(), 1)}T20:00`);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ link: string; at?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const placeholder = `אימון · ${sessionDayLabel(date)}`;

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const later = when === 'at' && at > nowLocal();
      const out = await send('POST', { date, name: name.trim() || placeholder, notifyEditors: notify, autoFeed, kind, tags, ...(later ? { createAt: at } : {}) });
      setMade(later ? { link: '', at } : { link: out.folder.link });
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
          לאיזה יום (של האימון)
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </label>
        <label className="block text-xs font-semibold text-ink-400">
          שם התיקייה
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder}
            className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </label>
        <KindTags kind={kind} setKind={setKind} tags={tags} setTags={setTags} />
        <WhenPicker date={date} mode={when} setMode={setWhen} at={at} setAt={setAt} />
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink-700">
          <span>לשלוח את הקישור לעורכי האינסטגרם</span>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
        <label className="flex min-h-[44px] items-center justify-between gap-3 text-sm text-ink-700">
          <span>להעלות לפיד אוטומטית את התמונות מהתיקייה</span>
          <input type="checkbox" checked={autoFeed} onChange={(e) => setAutoFeed(e.target.checked)} className="h-5 w-5 accent-brand-600" />
        </label>
        <button type="button" onClick={create} disabled={busy}
          className="min-h-[50px] w-full rounded-pill bg-brand-600 text-base font-extrabold text-white disabled:opacity-50">
          {busy ? 'יוצר…' : when === 'at' ? 'לתזמן תיקייה' : 'ליצור תיקייה'}
        </button>
        {made?.at && (
          <p className="rounded-xl bg-accent-600/15 px-3 py-2.5 text-sm font-bold text-accent-900">✓ מתוזמנת · תיווצר {whenLabel(made.at)}</p>
        )}
        {made && !made.at && (
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

/** "מה זה" and "תגיות מיוחדות" — the kind and tags the photos screen files a folder under. */
function KindTags({ kind, setKind, tags, setTags }: {
  kind: FolderKind; setKind: (k: FolderKind) => void; tags: string[]; setTags: (f: (x: string[]) => string[]) => void;
}) {
  const [newTag, setNewTag] = useState('');
  return (
    <>
        <div className="text-xs font-semibold text-ink-400">
        מה זה
        <div className="mt-1 flex flex-wrap gap-1.5">
          {FOLDER_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={cn('min-h-[38px] rounded-full px-3.5 text-[13.5px] font-bold', kind === k ? 'bg-ink-900 text-white' : 'bg-white text-ink-500')}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <div className="text-xs font-semibold text-ink-400">
        תגיות מיוחדות
        <div className="mt-1 flex flex-wrap gap-1.5">
          {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tg) => {
            const on = tags.includes(tg);
            return (
              <button key={tg} type="button" aria-pressed={on} onClick={() => setTags((x) => (on ? x.filter((y) => y !== tg) : [...x, tg]))}
                style={on ? { background: tagColor(tg), color: '#fff' } : { color: tagColor(tg) }}
                  className="min-h-[34px] rounded-full bg-white px-3 text-[13px] font-bold">#{tg}</button>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="תגית אחרת"
            className="min-h-[40px] flex-1 rounded-xl border-[1.5px] border-page bg-white px-3 text-[15px] text-ink-900" />
          <button type="button" disabled={!newTag.trim()} onClick={() => { setTags((x) => [...new Set([...x, newTag.trim()])]); setNewTag(''); }}
            className="min-h-[40px] rounded-xl bg-white px-3 text-[13px] font-bold text-brand-600 disabled:opacity-40">להוסיף</button>
        </div>
      </div>
    </>
  );
}

/**
 * "מתי ליצור": now, or a day and a time. The shortcuts: the evening before at 20:00
 * (the default the automation uses) and the morning of the session.
 */
function WhenPicker({ date, mode, setMode, at, setAt, withNow = true }: {
  date: string; mode: 'now' | 'at'; setMode: (m: 'now' | 'at') => void; at: string; setAt: (a: string) => void; withNow?: boolean;
}) {
  const eve = `${shiftDay(date, -1)}T20:00`;
  const morning = `${date}T06:00`;
  const chip = (on: boolean) => cn('min-h-[38px] rounded-full px-3.5 text-[13.5px] font-bold', on ? 'bg-ink-900 text-white' : 'bg-white text-ink-500');
  return (
    <div className="text-xs font-semibold text-ink-400">
      מתי ליצור
      <div className="mt-1 flex flex-wrap gap-1.5">
        {withNow && <button type="button" className={chip(mode === 'now')} aria-pressed={mode === 'now'} onClick={() => setMode('now')}>עכשיו</button>}
        <button type="button" className={chip(mode === 'at' && at === eve)} aria-pressed={mode === 'at' && at === eve} onClick={() => { setMode('at'); setAt(eve); }}>ערב לפני · 20:00</button>
        <button type="button" className={chip(mode === 'at' && at === morning)} aria-pressed={mode === 'at' && at === morning} onClick={() => { setMode('at'); setAt(morning); }}>בבוקר האימון</button>
        <button type="button" className={chip(mode === 'at' && at !== eve && at !== morning)} onClick={() => setMode('at')}>יום ושעה אחרים</button>
      </div>
      {mode === 'at' && (
        <div className="mt-1.5 flex gap-1.5">
          <input type="date" dir="ltr" aria-label="יום" value={at.slice(0, 10)} onChange={(e) => e.target.value && setAt(`${e.target.value}T${at.slice(11, 16)}`)}
            className="min-h-[44px] flex-1 rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
          <input type="time" dir="ltr" aria-label="שעה" value={at.slice(11, 16)} onChange={(e) => e.target.value && setAt(`${at.slice(0, 10)}T${e.target.value}`)}
            className="min-h-[44px] w-28 rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </div>
      )}
      {mode === 'at' && <p className="mt-1 text-2xs text-ink-400">⏰ תיווצר {whenLabel(at)}</p>}
    </div>
  );
}

export function EditProposalSheet({ p, onClose, onSaved }: { p: Proposal; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(p.name);
  const [kind, setKind] = useState<FolderKind>(p.kind);
  const [tags, setTags] = useState<string[]>(p.tags);
  const [mode, setMode] = useState<'now' | 'at'>('at');
  const [at, setAt] = useState(p.createsAt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      // "עכשיו" is the time already come: the next tick (five minutes) makes it.
      await send('PATCH', { date: p.date, name: name.trim() || p.name, kind, tags, createAt: mode === 'now' ? nowLocal() : at, skipped: false });
      onSaved();
    } catch {
      setErr('לא הצלחתי לשמור. נסו שוב.');
    } finally { setBusy(false); }
  };
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }} title={`עריכה · ${DAYS[dow(p.date)]} ${dayNum(p.date)}`}>
      <div className="space-y-3 px-4 pb-6" dir="rtl">
        {p.workout && <p className="text-xs text-ink-400">{SOURCE_LABEL[p.source]} · {p.workout}</p>}
        <label className="block text-xs font-semibold text-ink-400">
          שם התיקייה
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 block min-h-[44px] w-full rounded-xl border-[1.5px] border-page bg-white px-3 text-[16px] text-ink-900" />
        </label>
        <KindTags kind={kind} setKind={setKind} tags={tags} setTags={setTags} />
        <WhenPicker date={p.date} mode={mode} setMode={setMode} at={at} setAt={setAt} />
        <button type="button" onClick={save} disabled={busy}
          className="min-h-[50px] w-full rounded-pill bg-brand-600 text-base font-extrabold text-white disabled:opacity-50">
          {busy ? 'שומר…' : 'לשמור'}
        </button>
        {err && <p className="text-center text-sm font-bold text-accent-red">{err}</p>}
      </div>
    </Sheet>
  );
}

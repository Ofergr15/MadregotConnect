'use client';

import { useState } from 'react';
import { FOLDER_KINDS, KIND_LABEL, SUGGESTED_TAGS, tagColor, type FolderKind } from '@/lib/photos/folder-kind';
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
// folder for any day, now or at a chosen day and time. Since 10-20 (folders-plan
// mockup) "מוצע השבוע" also proposes the long runs and the calendar's races, each
// with its own edit sheet (name, kind, tags, when) and an on/off switch.
// ═════════════════════════════════════════════════════════════════════════════

interface Week {
  configured: boolean;
  upcoming: Proposal[];
  made: Array<{ date: string; name: string; link: string; manual: boolean; autoFeed: boolean; photos: number; inFeed: boolean }>;
}

interface Proposal {
  date: string; name: string; workout: string | null; kind: FolderKind; tags: string[];
  createsAt: string; enabled: boolean; source: 'plan' | 'race' | 'manual';
}

async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const res = await fetch('/api/social/folders', {
    method,
    headers: { ...(await bearerHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'failed');
  return out;
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const dow = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay();
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const pad = (n: number) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${israelToday()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const shiftDay = (date: string, by: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10);
};
/** "שני 19.10 ב־20:00" */
const whenLabel = (at: string) => `${DAYS[dow(at)]} ${sessionDayLabel(at.slice(0, 10)).split(' ')[1]} ב־${at.slice(11, 16)}`;
const SOURCE_LABEL = { plan: 'מהתוכנית', race: 'מירוץ מהלוח', manual: 'מתוזמנת ידנית' } as const;

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
  const [editing, setEditing] = useState<Proposal | null>(null);

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
        <Plus className="h-4 w-4" /> תיקייה חדשה
      </button>

      <p className="px-1 text-2xs font-bold text-ink-400">מוצע השבוע · מהתוכנית ומלוח המירוצים</p>
      <section className="rounded-card bg-card px-4">
        {!data ? (
          <p className="py-4 text-sm text-ink-400">טוען…</p>
        ) : data.upcoming.length === 0 ? (
          <p className="py-4 text-sm text-ink-400">אין אימון איכות, ארוכה או מירוץ בשבוע הקרוב. בוחרים ימים בתוכנית השבועית.</p>
        ) : data.upcoming.map((u) => (
          <ProposalRow key={u.date} p={u} onEdit={() => setEditing(u)} onChanged={() => { void mutate(); }} />
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
              <p className="text-xs text-ink-400">{m.manual ? 'נוצרה ידנית' : 'נוצרה אוטומטית ערב לפני'}{m.autoFeed ? '' : ' · התמונות לא עולות לפיד אוטומטית'}</p>
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
      {editing && <EditProposalSheet p={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
    </div>
  );
}

function NewFolderSheet({ open, onOpenChange, onMade }: { open: boolean; onOpenChange: (o: boolean) => void; onMade: () => void }) {
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

function ProposalRow({ p, onEdit, onChanged }: { p: Proposal; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      // A race switched on takes its proposal with it, so the tick needs nothing else.
      await send('PATCH', { date: p.date, skipped: p.enabled, ...(p.enabled ? {} : { name: p.name, kind: p.kind, tags: p.tags }) });
      onChanged();
    } finally { setBusy(false); }
  };
  return (
    <div className={cn('flex items-start gap-3 border-b border-page py-3 last:border-0', !p.enabled && 'opacity-55')}>
      <DayBox date={p.date} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-extrabold text-ink-900">{p.name}</p>
        <p className="text-xs text-ink-400">{[SOURCE_LABEL[p.source], p.workout !== p.name ? p.workout : null].filter(Boolean).join(' · ')}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full bg-ink-900/10 px-2 py-0.5 text-2xs font-bold text-ink-700">{KIND_LABEL[p.kind]}</span>
          {p.tags.map((t) => <span key={t} style={{ color: tagColor(t), background: `${tagColor(t)}22` }} className="rounded-full px-2 py-0.5 text-2xs font-bold">#{t}</span>)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex rounded-md bg-band-3/15 px-2 py-0.5 text-2xs font-extrabold text-band-3-ink">
            {p.enabled ? `⏰ תיווצר ${whenLabel(p.createsAt)}` : 'לא תיווצר תיקייה'}
          </span>
          <button type="button" onClick={onEdit} className="min-h-[36px] rounded-lg bg-white px-3 text-xs font-extrabold text-brand-600">✏️ עריכה</button>
        </div>
      </div>
      <button type="button" role="switch" aria-checked={p.enabled} aria-label="ליצור תיקייה" disabled={busy} onClick={toggle}
        className={cn('relative mt-1 h-[31px] w-[51px] shrink-0 rounded-full transition-colors', p.enabled ? 'bg-accent-600' : 'bg-ink-400/40')}>
        <span className={cn('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', p.enabled ? 'left-[22px]' : 'left-[2px]')} />
      </button>
    </div>
  );
}

function EditProposalSheet({ p, onClose, onSaved }: { p: Proposal; onClose: () => void; onSaved: () => void }) {
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useApi } from '@/lib/api';
import { FolderLinks } from '@/components/content/FolderLinks';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet } from '@/components/ui';
import { cn, israelToday } from '@/lib/utils';
import { tagColor } from '@/lib/photos/folder-kind';
import { photosWaiting, postsOf, weekFolders, type FolderProposal, type MadeFolder, type WeekFolder } from '@/lib/content/hub';
import { DateTile, Empty, Group, PlusButton, PublishedRow, SectionHead, Toggle, TypePage } from '@/components/content/hub-ui';
import { useHubContent, usePhotosStatus } from '@/components/content/use-hub';
import { EditProposalSheet, NewFolderSheet, SOURCE_LABEL, send, whenLabel, type Proposal, type Week } from '@/components/content/PhotoFolders';

// ═════════════════════════════════════════════════════════════════════════════
// תוכן › תמונות (mockup content-v4, 2) — everything the Social screen had, and
// only photos, in the hub's order: מחכה לך › תיקיות השבוע › פורסם › הגדרה.
// The week's folders are ONE list (Ofer 10-20): a folder already opened is shown
// as opened and cannot be changed — no switch, no edit, only Drive; a folder
// still to open keeps its switch and its "✏️ עריכה".
// ═════════════════════════════════════════════════════════════════════════════

export default function ContentPhotosPage() {
  const { data: week, error: weekError, mutate } = useApi<Week & { made: MadeFolder[] }>('/api/social/folders', {
    // A folder the tick opens shows up by itself, no refresh needed (Ofer 10-23).
    refreshInterval: 30_000,
  });
  const { data: st, mutate: reloadStatus } = usePhotosStatus();
  const { data: hub } = useHubContent();
  const [newOpen, setNewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('new') === '1') setNewOpen(true);
    if (q.get('publish') === '1') setPublishOpen(true);
  }, []);

  const status = st?.status ?? null;
  const waiting = photosWaiting(status);
  const rows = useMemo(() => weekFolders(week?.made ?? [], (week?.upcoming ?? []) as FolderProposal[], weekStartOf(israelToday())), [week]);
  const published = postsOf(hub?.recent ?? [], 'photos');
  const members = hub?.members ?? 0;

  return (
    <TypePage type="photos" action={week?.configured !== false ? <PlusButton label="תיקייה" onClick={() => setNewOpen(true)} /> : undefined}>
      {week && !week.configured && (
        <p className="mt-2 rounded-[14px] bg-[#fff1e6] px-3.5 py-3 text-13 text-[#a3410a]">הדרייב עוד לא מחובר לאפליקציה — אין איפה ליצור תיקיות.</p>
      )}

      {waiting && status && (
        <>
          <SectionHead>מחכה לך</SectionHead>
          <Group>
            <div className="px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1">
                  <b dir="auto" className="block truncate text-[15.5px] font-semibold text-ink-900">{status.name}</b>
                  <small className="block text-13 text-ink-400">{status.found} תמונות{status.published ? ` · ${status.published} כבר בפיד` : ''}{status.checkedAt ? ` · נבדק ${clock(status.checkedAt)}` : ''}</small>
                </span>
                <button type="button" onClick={() => setPublishOpen(true)} className="min-h-[36px] shrink-0 rounded-full px-[13px] text-[13px] font-bold text-white" style={{ background: 'var(--c)' }}>
                  {status.published ? 'להוסיף' : 'לפרסם'}
                </button>
              </div>
              <Strip previews={status.previews} more={status.found - Math.min(status.previews.length, 4)} />
            </div>
          </Group>
        </>
      )}

      <SectionHead>תיקיות השבוע</SectionHead>
      <Group>
        {weekError ? <Empty>התיקיות של השבוע פתוחות למנהלים בלבד.</Empty>
          : !week ? <Empty>טוען…</Empty>
          : rows.length === 0 ? <Empty>אין אימון איכות, ארוכה או מירוץ השבוע. ״＋ תיקייה״ למעלה — לכל יום.</Empty>
          : rows.map((r) => <WeekRow key={r.date} row={r} onEdit={setEditing} onChanged={() => void mutate()} />)}
      </Group>

      {published.length > 0 && (
        <>
          <SectionHead gray>פורסם · התוצאות של כל אחד</SectionHead>
          <Group>{published.slice(0, 8).map((p) => <PublishedRow key={p.id} post={p} members={members} />)}</Group>
        </>
      )}

      {status && (
        <>
          <SectionHead gray>הגדרה</SectionHead>
          <Group>
            <div className="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5">
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold text-ink-900">לפרסם לבד כשעולות תמונות</b>
                <small className="block text-13 text-ink-400">{status.auto ? 'דלוק: עולות לפיד עם פוש לכולם, בלי לאשר' : 'כבוי: העורכים מקבלים התראה ומאשרים'}</small>
              </span>
              <Toggle on={status.auto} label="לפרסם לבד" onChange={async () => {
                await fetch('/api/quality-session/photos/status', { method: 'PATCH', headers: await bearerHeaders(), body: JSON.stringify({ date: status.date, auto: !status.auto }) });
                await reloadStatus();
              }} />
            </div>
          </Group>
        </>
      )}

      <NewFolderSheet open={newOpen} onOpenChange={setNewOpen} onMade={() => { void mutate(); }} />
      {editing && <EditProposalSheet p={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void mutate(); }} />}
      {status && <PublishSheet open={publishOpen} onOpenChange={setPublishOpen} date={status.date} adding={status.published > 0} count={Math.min(status.found, 6)} onDone={() => { void reloadStatus(); }} />}
    </TypePage>
  );
}

function WeekRow({ row, onEdit, onChanged }: { row: WeekFolder; onEdit: (p: Proposal) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  if (row.state === 'opened') {
    const f = row.folder;
    const count = f.inFeed ? `${f.photos} בפיד` : f.found ? `${f.found} תמונות` : 'עוד ריקה';
    return (
      <div className="flex min-h-[66px] items-center gap-3 px-3.5 py-2.5">
        <DateTile date={f.date} />
        <span className="min-w-0 flex-1">
          <b dir="auto" className="block truncate text-[15.5px] font-semibold text-ink-700">{f.name}</b>
          <small className="block truncate text-13 text-ink-400">{f.createdAt ? `נפתחה ${openedLabel(f.createdAt)} · ` : ''}{count}</small>
        </span>
        <FolderLinks link={f.link} name={f.name} />
      </div>
    );
  }
  const p = row.proposal as Proposal;
  const toggle = async () => {
    setBusy(true);
    try {
      // A race switched on takes its proposal with it, so the tick needs nothing else.
      await send('PATCH', { date: p.date, skipped: p.enabled, ...(p.enabled ? {} : { name: p.name, kind: p.kind, tags: p.tags }) });
      onChanged();
    } finally { setBusy(false); }
  };
  return (
    <div className={cn('flex items-start gap-3 px-3.5 py-2.5', !p.enabled && 'opacity-60')}>
      <DateTile date={p.date} up />
      <span className="min-w-0 flex-1">
        <b dir="auto" className="block truncate text-[15.5px] font-semibold text-ink-900">{p.name}</b>
        <small className="block text-13 text-ink-400">
          {p.tags.map((t) => <span key={t} className="me-1 inline-block rounded-full px-[7px] text-[11px] font-extrabold" style={{ color: tagColor(t), background: `${tagColor(t)}1f` }}>#{t}</span>)}
          {p.enabled ? `תיפתח ${whenLabel(p.createsAt)}` : `${SOURCE_LABEL[p.source]} · כבוי`}
        </small>
        <button type="button" onClick={() => onEdit(p)} className="mt-0.5 inline-flex min-h-[32px] items-center text-12 font-bold text-[#007aff]">✏️ עריכה</button>
      </span>
      <span className="pt-1.5"><Toggle on={p.enabled} label="לפתוח תיקייה" disabled={busy} onChange={toggle} /></span>
    </div>
  );
}

function Strip({ previews, more }: { previews: string[]; more: number }) {
  const shown = previews.slice(0, 4);
  if (!shown.length) return null;
  return (
    <div className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
      {shown.map((u, i) => (
        <span key={u} className="relative aspect-square overflow-hidden rounded-[9px] bg-page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          {i === shown.length - 1 && more > 0 && (
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-[15px] font-extrabold text-white"><bdi dir="ltr">+{more}</bdi></span>
          )}
        </span>
      ))}
    </div>
  );
}

/** The staff card's choices (StaffSessionPhotos), as a sheet: how to tell, to whom, the circle too. */
function PublishSheet({ open, onOpenChange, date, adding, count, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; date: string; adding: boolean; count: number; onDone: () => void }) {
  const [notify, setNotify] = useState<'push' | 'inapp' | 'quiet'>('push');
  const [audience, setAudience] = useState<'all' | 'attendees'>('all');
  const [circle, setCircle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/quality-session/photos/approve', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ date, notify, audience, circle }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'failed');
      setMsg(adding ? '✓ נוספו לכרטיס' : out.told > 0 ? `✓ פורסם · נשלח ל־${out.told}` : '✓ פורסם');
      onDone();
    } catch { setMsg('לא הצליח. אפשר לנסות שוב.'); } finally { setBusy(false); }
  };
  const seg = <T extends string>(value: T, set: (v: T) => void, options: Array<[T, string]>) => (
    <div className="mt-1.5 flex rounded-[10px] bg-[#e9e9ee] p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => set(v)}
          className={cn('min-h-[36px] flex-1 rounded-[8px] text-[13.5px] font-semibold', value === v ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-ink-500')}>{l}</button>
      ))}
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setMsg(null); }} title={adding ? 'להוסיף לכרטיס' : 'לפרסם את התמונות'}>
      <div className="space-y-4 px-4 pb-6" dir="rtl">
        {!adding && (
          <>
            <div><b className="text-[14px] text-ink-900">להודיע</b>{seg(notify, setNotify, [['push', 'פוש לטלפון'], ['inapp', 'רק באפליקציה'], ['quiet', 'בשקט']])}</div>
            {notify !== 'quiet' && <div><b className="text-[14px] text-ink-900">למי</b>{seg(audience, setAudience, [['all', 'כולם'], ['attendees', 'מי שסימן שמגיע']])}</div>}
            <div className="flex items-center justify-between gap-3">
              <span><b className="block text-[14px] text-ink-900">גם בעיגול מדרגות</b><small className="text-12 text-ink-400">״התמונות עלו״, להיום</small></span>
              <Toggle on={circle} label="גם בעיגול מדרגות" onChange={() => setCircle((c) => !c)} />
            </div>
          </>
        )}
        <button type="button" disabled={busy} onClick={go} className="h-[50px] w-full rounded-full text-[16px] font-extrabold text-white disabled:opacity-50" style={{ background: '#f2690d' }}>
          {busy ? '…' : adding ? 'להוסיף לכרטיס' : `לפרסם ${count} תמונות`}
        </button>
        {msg && <p role="status" className="text-center text-13 font-bold text-ink-700">{msg}</p>}
      </div>
    </Sheet>
  );
}

function weekStartOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
function openedLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  return `${DOW[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${clock(iso)}`;
}
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
}

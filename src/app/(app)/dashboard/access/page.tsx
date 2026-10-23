'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { personMatches } from '@/lib/search/match';
import { Sheet } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { CONTENT_TYPES, TYPE_ORDER, type ContentType } from '@/lib/content/hub';
import type { RolePerson } from '@/lib/auth/roles';
import type { Grants, LogEntry } from '@/lib/access/grants';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול ← הרשאות — one place for who sees and publishes what (mockups/access-hub.html,
// Ofer 10-23: "one unified management area"; "much better" for the sentences). Stage 1:
// the people, each one's Content level per part, the Content tab written as sentences,
// and the log. Roles and switches are still edited on the roles screen (linked); the
// pages tab and the staff alerts move here next.
// ═════════════════════════════════════════════════════════════════════════════

type Tab = 'people' | 'content' | 'log';
type Lvl = 0 | 1 | 3;
const LEVEL_TEXT: Record<Lvl, string> = { 0: 'לא רואה', 1: 'רואה', 3: 'מפרסם' };
const ROLE_TEXT: Record<string, string> = { admin: 'מנהל', coach: 'מאמן', academy_coach: 'מאמן אקדמיה', academy_manager: 'מנהל אקדמיה' };
/** Grants travel with the super users: the roles list does not mark them, yet they see everything. */
type G = Grants & { __supers?: string[] };
const isStaff = (p: RolePerson, g?: G) => p.roles.length > 0 || !!g?.__supers?.includes(p.id);

/** The level a person has in a part: staff publish everything; the share switch publishes the share. */
function levelOf(p: RolePerson, grants: G, k: ContentType): { level: Lvl; from: 'role' | 'switch' | 'grant' | null } {
  if (isStaff(p, grants)) return { level: 3, from: 'role' };
  if (k === 'share' && p.storyEditor) return { level: 3, from: 'switch' };
  const g = (grants as Grants)[p.id]?.content?.[k];
  return g === 3 ? { level: 3, from: 'grant' } : g === 1 ? { level: 1, from: 'grant' } : { level: 0, from: null };
}
const dm = (iso: string) => { const d = new Date(iso); return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export default function AccessPage() {
  const { data: roles } = useApi<{ people: RolePerson[] }>('/api/admin/roles');
  const { data: acc, mutate } = useApi<{ grants: Grants; log: LogEntry[]; supers?: string[] }>('/api/admin/access');
  const [tab, setTab] = useState<Tab>('people');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<RolePerson | null>(null);
  const [adding, setAdding] = useState<{ kind: ContentType; level: Lvl } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const grants: G = useMemo(() => ({ ...(acc?.grants ?? {}), __supers: acc?.supers ?? [] }) as G, [acc]);
  const people = roles?.people ?? [];

  const set = async (athleteId: string, kind: ContentType, level: Lvl) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/access', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, kind, level }) });
      if (res.ok) await mutate();
    } finally { setBusy(false); }
  };

  const special = (p: RolePerson) => !isStaff(p, grants) && (p.storyEditor || p.coreRunner || p.clubManager || p.academy || !!(grants as Grants)[p.id]?.content);
  const shown = q.trim() ? people.filter((p) => personMatches(p.name, q)) : people;
  const staff = shown.filter((p) => isStaff(p, grants));
  const withMore = shown.filter(special);
  const rest = shown.filter((p) => !isStaff(p, grants) && !special(p));

  return (
    <div className="pb-10" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ ניהול</Link>
      <div className="flex items-center gap-3 pb-3">
        <span className="grid h-[46px] w-[46px] place-items-center rounded-[12px] bg-[#16A34A] text-white"><ShieldCheck className="h-6 w-6" /></span>
        <h1 className="text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">הרשאות</h1>
      </div>
      <div className="mb-3 flex gap-[3px] rounded-[10px] bg-[#e4e4ea] p-[3px]" role="tablist">
        {([['people', 'אנשים'], ['content', 'תוכן'], ['log', 'יומן']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('min-h-[34px] flex-1 rounded-[8px] text-[13.5px] font-bold', tab === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>{l}</button>
        ))}
      </div>

      {tab === 'people' && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש רץ" aria-label="חיפוש רץ" className="mb-2 min-h-[42px] w-full rounded-[11px] bg-[#e4e4ea] px-3 text-base" />
          {!roles && <div className="h-40 animate-pulse rounded-[16px] bg-card" />}
          {roles && (
            <>
              <Section title={`צוות · ${staff.length}`}>{staff.map((p) => <PersonRow key={p.id} p={p} grants={grants} onOpen={() => setOpen(p)} />)}</Section>
              <Section title={`עם הרשאה מיוחדת · ${withMore.length}`}>{withMore.map((p) => <PersonRow key={p.id} p={p} grants={grants} onOpen={() => setOpen(p)} />)}</Section>
              <div className="flex items-center justify-between px-1 pb-1.5 pt-4 text-13 font-bold text-ink-400">
                <span>כל השאר · {rest.length} רצים</span>
                {!q.trim() && <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[#1525FF]">{showAll ? 'הסתרה' : 'הצגה'}</button>}
              </div>
              {(showAll || q.trim()) && <div className="overflow-hidden rounded-[16px] bg-card">{rest.map((p) => <PersonRow key={p.id} p={p} grants={grants} onOpen={() => setOpen(p)} />)}</div>}
            </>
          )}
        </>
      )}

      {tab === 'content' && (
        <>
          <p className="mb-2.5 px-1 text-[12.5px] text-ink-500">כל חלק בתוכן — מי מפרסם, ומי רק רואה. מי שלא כתוב כאן לא רואה אותו בכלל.</p>
          {TYPE_ORDER.map((k) => {
            const m = CONTENT_TYPES[k];
            const pub = people.filter((p) => !isStaff(p, grants) && levelOf(p, grants, k).level === 3);
            const see = people.filter((p) => !isStaff(p, grants) && levelOf(p, grants, k).level === 1);
            return (
              <section key={k} className="mb-2.5 overflow-hidden rounded-[16px] bg-card">
                <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-3">
                  <span className="h-[26px] w-[26px] rounded-[8px]" style={{ background: m.color }} />
                  <b className="flex-1 text-[15.5px] text-ink-900">{m.label}</b>
                </div>
                <Line label="מפרסמים" tone="text-[#15803d]">
                  <Tag role>הצוות (מנהלים ומאמנים)</Tag>
                  {pub.map((p) => <Tag key={p.id} p={p} onClick={() => setOpen(p)} />)}
                  <AddTag onClick={() => setAdding({ kind: k, level: 3 })} />
                </Line>
                <Line label="רק רואים" tone="text-[#1D2A99]">
                  {see.map((p) => <Tag key={p.id} p={p} onClick={() => setOpen(p)} />)}
                  <AddTag onClick={() => setAdding({ kind: k, level: 1 })} />
                </Line>
                <p className="px-3 pb-3 text-[11.5px] text-ink-400">כל השאר — לא רואים</p>
              </section>
            );
          })}
        </>
      )}

      {tab === 'log' && (
        <div className="overflow-hidden rounded-[16px] bg-card">
          {(acc?.log ?? []).length === 0 && <p className="px-3.5 py-3.5 text-13 text-ink-400">עוד לא שונה כאן כלום.</p>}
          {(acc?.log ?? []).map((e, i) => (
            <div key={i} className="border-t-[0.5px] border-black/[0.08] px-3.5 py-2.5 first:border-t-0">
              <b dir="auto" className="block text-[14px] text-ink-900">{e.name ?? '—'} · {CONTENT_TYPES[e.kind as ContentType]?.label ?? e.kind}: {LEVEL_TEXT[e.from as Lvl] ?? e.from} ← {LEVEL_TEXT[e.to as Lvl] ?? e.to}</b>
              <small className="block text-[11.5px] text-ink-400">{e.byName ?? '—'} · {dm(e.at)}</small>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.name ?? ''}>
        {open && <PersonSheet p={people.find((x) => x.id === open.id) ?? open} grants={grants} busy={busy} onSet={(k, l) => set(open.id, k, l)} />}
      </Sheet>

      <Sheet open={!!adding} onOpenChange={(o) => !o && setAdding(null)} title={adding ? `${CONTENT_TYPES[adding.kind].label} · ${adding.level === 3 ? 'מפרסם' : 'רואה'}` : ''}>
        {adding && <PickPerson people={people.filter((p) => !isStaff(p, grants) && levelOf(p, grants, adding.kind).level !== adding.level)} onPick={async (p) => { await set(p.id, adding.kind, adding.level); setAdding(null); }} />}
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <p className="px-1 pb-1.5 pt-4 text-13 font-bold text-ink-400">{title}</p>
      <div className="overflow-hidden rounded-[16px] bg-card">{children}</div>
    </>
  );
}

function badgesOf(p: RolePerson, grants: G): Array<{ t: string; c: string }> {
  const out: Array<{ t: string; c: string }> = p.roles.map((r) => ({ t: ROLE_TEXT[r] ?? r, c: 'bg-[#EDE7FB] text-[#5B2DB8]' }));
  if (!p.roles.length && grants.__supers?.includes(p.id)) out.push({ t: 'מנהל-על', c: 'bg-[#EDE7FB] text-[#5B2DB8]' });
  if (p.storyEditor) out.push({ t: 'אינסטגרם', c: 'bg-[#FDE7F3] text-[#B0186F]' });
  if (p.coreRunner) out.push({ t: 'גרעין', c: 'bg-[#FFF4E5] text-[#8A4A0B]' });
  if (p.clubManager) out.push({ t: 'מנהל מדרגות', c: 'bg-[#EEF0FF] text-[#1D2A99]' });
  if (p.academy) out.push({ t: 'אקדמיה', c: 'bg-[#E6F4EC] text-[#0B6B35]' });
  if (!isStaff(p, grants) && (grants as Grants)[p.id]?.content) out.push({ t: '+ תוכן', c: 'bg-[#f0eafd] text-[#4a2a9e]' });
  return out;
}

function PersonRow({ p, grants, onOpen }: { p: RolePerson; grants: G; onOpen: () => void }) {
  const parts = !isStaff(p, grants) ? TYPE_ORDER.filter((k) => levelOf(p, grants, k).level >= 1).map((k) => CONTENT_TYPES[k].label) : [];
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 border-t-[0.5px] border-black/[0.08] px-3 py-2.5 text-start first:border-t-0 active:bg-page">
      <FeedAvatar name={p.name} url={p.avatarUrl} className="h-9 w-9 shrink-0 text-[12px]" />
      <span className="min-w-0 flex-1">
        <b dir="auto" className="block truncate text-[14.5px] text-ink-900">{p.name}</b>
        <small className="block truncate text-[11.5px] text-ink-400">{isStaff(p, grants) ? 'רואה ומפרסם בכל התוכן' : parts.length ? `תוכן: ${parts.join(', ')}` : 'רץ'}</small>
      </span>
      <span className="flex max-w-[140px] flex-wrap justify-end gap-1">
        {badgesOf(p, grants).map((b) => <span key={b.t} className={cn('inline-flex h-[21px] items-center rounded-[7px] px-[7px] text-[10.5px] font-extrabold', b.c)}>{b.t}</span>)}
      </span>
    </button>
  );
}

function PersonSheet({ p, grants, busy, onSet }: { p: RolePerson; grants: G; busy: boolean; onSet: (k: ContentType, l: Lvl) => void }) {
  return (
    <div className="space-y-1 px-4 pb-8" dir="rtl">
      <p className="px-1 pt-1 text-[12.5px] font-extrabold text-ink-500">1 · תפקיד ומתגים</p>
      <div className="flex items-center gap-2 rounded-[14px] bg-page px-3 py-2.5">
        <span className="flex flex-1 flex-wrap gap-1">
          {badgesOf(p, grants).filter((b) => b.t !== '+ תוכן').map((b) => <span key={b.t} className={cn('inline-flex h-[22px] items-center rounded-[7px] px-2 text-[11px] font-extrabold', b.c)}>{b.t}</span>)}
          {!badgesOf(p, grants).some((b) => b.t !== '+ תוכן') && <span className="text-13 font-semibold text-ink-700">רץ</span>}
        </span>
        <Link href={`/dashboard/roles?q=${encodeURIComponent(p.name)}`} className="text-13 font-bold text-[#1525FF]">לשנות ‹</Link>
      </div>
      <p className="px-1 pt-4 text-[12.5px] font-extrabold text-ink-500">2 · תוכן — מה הוא רואה ומה הוא מפרסם</p>
      <div className="overflow-hidden rounded-[14px] bg-page">
        {TYPE_ORDER.map((k) => {
          const { level, from } = levelOf(p, grants, k);
          const locked = from === 'role' || from === 'switch';
          return (
            <div key={k} className="flex items-center gap-2 border-t-[0.5px] border-black/[0.06] px-3 py-2 first:border-t-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CONTENT_TYPES[k].color }} />
              <b className="flex-1 text-[13.5px] text-ink-900">{CONTENT_TYPES[k].label}</b>
              {locked ? (
                <span className="rounded-full bg-[#E6F4EC] px-2 py-1 text-[11px] font-extrabold text-[#0B6B35]">מפרסם · {from === 'role' ? 'מהתפקיד' : 'מ״אינסטגרם״'}</span>
              ) : (
                <span className="flex gap-0.5 rounded-[9px] bg-white p-0.5">
                  {([0, 1, 3] as Lvl[]).map((l) => (
                    <button key={l} type="button" disabled={busy} aria-pressed={level === l} onClick={() => level !== l && onSet(k, l)}
                      className={cn('min-h-[30px] rounded-[7px] px-2 text-[11.5px] font-extrabold', level === l ? (l === 3 ? 'bg-[#DCFCE7] text-[#15803d]' : l === 1 ? 'bg-[#EEF0FF] text-[#1D2A99]' : 'bg-page text-ink-700') : 'text-ink-400')}>{LEVEL_TEXT[l]}</button>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 pt-2 text-[11.5px] leading-relaxed text-ink-400">רואה — רואה מה פורסם ומה מחכה, בלי לפרסם. מפרסם — מפרסם בעצמו. נכנס לתוקף תוך דקה.</p>
    </div>
  );
}

function Line({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5">
      <span className={cn('w-[68px] shrink-0 whitespace-nowrap pt-[5px] text-[12px] font-extrabold', tone)}>{label}</span>
      <span className="flex flex-1 flex-wrap gap-1">{children}</span>
    </div>
  );
}
function Tag({ p, role, children, onClick }: { p?: RolePerson; role?: boolean; children?: React.ReactNode; onClick?: () => void }) {
  if (role) return <span className="inline-flex h-[26px] items-center rounded-full bg-[#EEF0FF] px-2.5 text-[12px] font-bold text-[#1D2A99]">{children}</span>;
  return (
    <button type="button" onClick={onClick} className="inline-flex h-[26px] items-center gap-1 rounded-full bg-page pe-2.5 ps-1 text-[12px] font-bold text-ink-700">
      <FeedAvatar name={p!.name} url={p!.avatarUrl} className="h-[18px] w-[18px] text-[8px]" /><span dir="auto">{p!.name}</span>
    </button>
  );
}
function AddTag({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="הוספה" className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[#d1d5db] px-2 text-13 font-bold text-ink-400">+</button>;
}
function PickPerson({ people, onPick }: { people: RolePerson[]; onPick: (p: RolePerson) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => (q.trim() ? people.filter((p) => personMatches(p.name, q)) : people).slice(0, 40), [people, q]);
  return (
    <div className="px-4 pb-8" dir="rtl">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש רץ" aria-label="חיפוש רץ" className="mb-2 min-h-[44px] w-full rounded-[11px] bg-page px-3 text-base" />
      {list.map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p)} className="flex min-h-[48px] w-full items-center gap-2.5 px-1 text-start">
          <FeedAvatar name={p.name} url={p.avatarUrl} className="h-8 w-8 text-[11px]" /><span dir="auto" className="text-[15px] text-ink-900">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

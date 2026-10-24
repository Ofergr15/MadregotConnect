'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { CONTENT_TYPES, TYPE_ORDER, type ContentType } from '@/lib/content/hub';
import type { RolePerson } from '@/lib/auth/roles';
import type { Grants, LogEntry } from '@/lib/access/grants';
import { AlertsTab, PagesTab } from '@/components/access/RoleTabs';
import { DRAFTABLE, LEVEL_TEXT, PeopleTab, PersonPage, PickPerson, dm, isStaff, levelOf, logText, type G, type Lvl } from '@/components/access/PeopleTab';

// ═════════════════════════════════════════════════════════════════════════════
// ניהול ← הרשאות — one place for who sees and publishes what (mockups/access-hub.html,
// access-people.html; Ofer 10-23/24). אנשים: one sentence each or by group, and one
// page per person where everything changes (components/access/PeopleTab). תוכן: each
// part in sentences. עמודים, התראות: per role (components/access/RoleTabs). יומן: who
// changed what — Content levels, roles, switches, pages.
// ═════════════════════════════════════════════════════════════════════════════

type Tab = 'people' | 'content' | 'pages' | 'alerts' | 'log';

export default function AccessPage() {
  const { data: roles, mutate: reloadRoles } = useApi<{ people: RolePerson[] }>('/api/admin/roles');
  const { data: acc, mutate } = useApi<{ grants: Grants; log: LogEntry[]; supers?: string[] }>('/api/admin/access');
  const [tab, setTab] = useState<Tab>('people');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: ContentType; level: Lvl } | null>(null);
  const [busy, setBusy] = useState(false);
  const grants: G = useMemo(() => ({ ...(acc?.grants ?? {}), __supers: acc?.supers ?? [] }) as G, [acc]);
  const people = roles?.people ?? [];
  const setOpen = (p: RolePerson | null) => { setOpenId(p?.id ?? null); if (p) window.scrollTo({ top: 0 }); };

  const set = async (athleteId: string, kind: ContentType, level: Lvl) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/access', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ athleteId, kind, level }) });
      if (res.ok) await mutate();
    } finally { setBusy(false); }
  };
  const reload = () => { void reloadRoles(); void mutate(); };

  const open = openId ? people.find((p) => p.id === openId) : null;
  if (open) {
    return <PersonPage p={open} grants={grants} log={acc?.log ?? []} busy={busy} onBack={() => setOpen(null)} onChanged={reload} onSetLevel={(k, l) => void set(open.id, k, l)} />;
  }

  return (
    <div className="pb-10" dir="rtl">
      <Link href="/dashboard/coach-tools" className="inline-flex min-h-[44px] items-center text-[17px] text-[#007aff]">‹ ניהול</Link>
      <div className="flex items-center gap-3 pb-3">
        <span className="grid h-[46px] w-[46px] place-items-center rounded-[12px] bg-[#16A34A] text-white"><ShieldCheck className="h-6 w-6" /></span>
        <h1 className="text-[30px] font-extrabold tracking-[-0.4px] text-ink-900">הרשאות</h1>
      </div>
      <div className="mb-3 flex gap-[3px] rounded-[10px] bg-[#e4e4ea] p-[3px]" role="tablist">
        {([['people', 'אנשים'], ['content', 'תוכן'], ['pages', 'עמודים'], ['alerts', 'התראות'], ['log', 'יומן']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('min-h-[34px] flex-1 rounded-[8px] text-[13px] font-bold', tab === k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500')}>{l}</button>
        ))}
      </div>

      {tab === 'people' && (roles ? <PeopleTab people={people} grants={grants} onOpen={setOpen} onChanged={reload} /> : <div className="h-40 animate-pulse rounded-[16px] bg-card" />)}

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
                {DRAFTABLE.includes(k) && (
                  <Line label="באישור" tone="text-[#b45309]">
                    {people.filter((p) => !isStaff(p, grants) && levelOf(p, grants, k).level === 2).map((p) => <Tag key={p.id} p={p} onClick={() => setOpen(p)} />)}
                    <AddTag onClick={() => setAdding({ kind: k, level: 2 })} />
                  </Line>
                )}
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

      {tab === 'pages' && <PagesTab />}
      {tab === 'alerts' && <AlertsTab />}

      {tab === 'log' && (
        <div className="overflow-hidden rounded-[16px] bg-card">
          {(acc?.log ?? []).length === 0 && <p className="px-3.5 py-3.5 text-13 text-ink-400">עוד לא שונה כאן כלום.</p>}
          {(acc?.log ?? []).map((e, i) => (
            <button key={i} type="button" onClick={() => { const p = people.find((x) => x.id === e.athleteId); if (p) setOpen(p); }}
              className="block w-full border-t-[0.5px] border-black/[0.08] px-3.5 py-2.5 text-start first:border-t-0">
              <b dir="auto" className="block text-[14px] text-ink-900">{e.name ?? '—'} · {logText(e)}</b>
              <small className="block text-[11.5px] text-ink-400">{e.byName ?? '—'} · {dm(e.at)}</small>
            </button>
          ))}
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-[320] flex items-end bg-black/40" onClick={() => setAdding(null)} dir="rtl">
          <div className="max-h-[75vh] w-full overflow-y-auto rounded-t-[22px] bg-white px-4 pb-8 pt-3" onClick={(ev) => ev.stopPropagation()}>
            <p className="mb-2 text-center text-[16px] font-extrabold text-ink-900">{CONTENT_TYPES[adding.kind].label} · {LEVEL_TEXT[adding.level]}</p>
            <PickPerson people={people.filter((p) => !isStaff(p, grants) && levelOf(p, grants, adding.kind).level !== adding.level)} onPick={async (p) => { await set(p.id, adding.kind, adding.level); setAdding(null); }} />
          </div>
        </div>
      )}
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

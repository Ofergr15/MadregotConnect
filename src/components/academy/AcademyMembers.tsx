'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Check, ChevronLeft, Search, SlidersHorizontal, UserPlus, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useApi } from '@/lib/api';
import { ConfirmSheet, EmptyState, Sheet, SkeletonList, Spinner } from '@/components/ui';
import { israelToday } from '@/lib/utils';
import { sortBands } from '@/lib/academy/bands';
import {
  daysBetween, groupByCoach, rowLine,
  type AcademyPeopleResponse, type LeftMember, type PendingApplicant,
} from '@/lib/academy/manage';
import { AcceptSheet } from './AdmitSheets';
import {
  AddMemberSheet, BandSheet, ChangeCoachSheet, MemberAvatar, postBulk,
} from './ManageMembersSheets';
import type { AcademyMember, AcademyMembersResponse } from './types';

// The members tab, as the approved mockup (academy-manage-members.html) draws it.
//
// One list grouped by coach, because in a 1:1 academy "who is with whom" is the
// question every manager visit starts with; one row of filters instead of the
// four chip rails it replaced (status · coach · band · club group); and every
// roster action within two taps: add, move to a coach, change the band, take out,
// bring back, and settle an application.
//
// A coach sees the same list of their own trainees and nothing that changes the
// roster — the routes refuse them anyway, this keeps it out of their way.

type Filter = 'active' | 'nocoach' | 'pending' | 'left';

const MONTH_FMT = (locale: string) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });

function monthOf(date: string | null, locale: string): string | null {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : MONTH_FMT(locale).format(d);
}

/** '9.9' — a day and a month, the way the club writes dates. */
function dayMonth(date: string | null): string {
  if (!date) return '';
  const [, m, d] = date.slice(0, 10).split('-').map(Number);
  return m && d ? `${d}.${m}` : '';
}

export function AcademyMembers({
  data,
  isLoading,
  onSelectMember,
  isManager = false,
  onChanged,
  onOpenFunnel,
  myAthleteId = null,
}: {
  data: AcademyMembersResponse | undefined;
  isLoading: boolean;
  onSelectMember: (member: AcademyMember) => void;
  /** The academy manager: add, move, take out, bring back, settle applications. */
  isManager?: boolean;
  /** Revalidate the shared academy payload after a write. */
  onChanged?: () => void | Promise<void>;
  /** Open one card on the funnel tab. */
  onOpenFunnel?: (candidateId: string) => void;
  myAthleteId?: string | null;
}) {
  const locale = useLocale();
  const manager = isManager && data?.scope === 'academy';
  const { data: people, mutate: refreshPeople } = useApi<AcademyPeopleResponse>(manager ? '/api/academy/members/people' : null);

  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [bandId, setBandId] = useState<string | null>(null);
  const [bandFilterOpen, setBandFilterOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [coachSheet, setCoachSheet] = useState<AcademyMember[] | null>(null);
  const [bandSheet, setBandSheet] = useState<AcademyMember[] | null>(null);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const coaches = data?.coaches ?? [];
  const bands = useMemo(() => data?.bands ?? [], [data?.bands]);
  const approved = useMemo(() => members.filter((m) => m.approved), [members]);
  const unpaired = approved.filter((m) => !m.academyCoachId).length;
  const pending = people?.pending ?? [];
  const left = people?.left ?? [];
  const today = israelToday();

  const refreshAll = async () => {
    await Promise.all([onChanged?.(), manager ? refreshPeople() : undefined]);
  };
  const flash = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3200);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = approved;
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
    if (bandId) list = bandId === '__none__' ? list.filter((m) => !m.band) : list.filter((m) => m.band?.id === bandId);
    if (filter === 'nocoach') list = list.filter((m) => !m.academyCoachId);
    return list;
  }, [approved, query, bandId, filter]);
  const sections = useMemo(() => groupByCoach(visible), [visible]);
  const byId = useMemo(() => new Map(members.map((m) => [m.athleteId, m])), [members]);
  const selectedMembers = [...selected].map((id) => byId.get(id)).filter(Boolean) as AcademyMember[];

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); };

  const bandChoices = useMemo(() => {
    const out = sortBands(bands).filter((b) => (b.trainees ?? 0) > 0).map((b) => ({ id: b.id, name: b.name, count: b.trainees ?? 0 }));
    const none = approved.filter((m) => !m.band).length;
    if (none) out.push({ id: '__none__', name: 'בלי דבוקה', count: none });
    return out;
  }, [bands, approved]);
  const bandLabel = bandChoices.find((b) => b.id === bandId)?.name;

  if (isLoading && !data) return <SkeletonList count={8} />;

  const chips: Array<{ key: Filter; label: string; count: number; warn?: boolean }> = [
    { key: 'active', label: 'פעילים', count: approved.length },
    ...(manager ? [
      { key: 'nocoach' as Filter, label: 'בלי מאמן', count: unpaired, warn: unpaired > 0 },
      { key: 'pending' as Filter, label: 'ממתינים', count: pending.length },
      { key: 'left' as Filter, label: 'עזבו', count: left.length },
    ] : []),
  ];

  return (
    <div className={cn('space-y-2.5', selecting && 'pb-24')} dir="rtl">
      {/* Header: the count, and the one action that grows the list. */}
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        {selecting ? (
          <>
            <h2 className="text-[22px] font-black text-ink-700">{selected.size ? <>בחרת <bdi dir="ltr">{selected.size}</bdi></> : 'בחירה'}</h2>
            <button type="button" onClick={exitSelect} className="min-h-[44px] px-1 text-sm font-extrabold text-brand-600">ביטול</button>
          </>
        ) : (
          <>
            <h2 className="text-[22px] font-black text-ink-700">
              {manager ? 'מתאמנים' : 'המתאמנים שלי'} · <bdi dir="ltr">{approved.length}</bdi>
            </h2>
            {manager && (
              <button type="button" onClick={() => setAddOpen(true)}
                className="flex min-h-[40px] items-center gap-1 rounded-pill bg-brand-600 px-3.5 text-sm font-extrabold text-white active:scale-[0.98]">
                <span aria-hidden>+</span> הוספה
              </button>
            )}
          </>
        )}
      </div>

      {!selecting && (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי שם"
                className="w-full min-h-[44px] rounded-xl bg-ink-300/25 ps-9 pe-9 text-[16px] text-ink-700 placeholder:text-ink-500 focus:outline-none" />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="ניקוי"
                  className="absolute end-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-ink-400">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {bandChoices.length > 1 && (filter === 'active' || filter === 'nocoach') && (
              <button type="button" onClick={() => setBandFilterOpen(true)} aria-label="סינון לפי דבוקה"
                className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl',
                  bandId ? 'bg-brand-600 text-white' : 'bg-ink-300/25 text-ink-500')}>
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            )}
          </div>

          {(chips.length > 1 || bandId) && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 scrollbar-hide">
              {chips.length > 1 && chips.map((c) => (
                <button key={c.key} type="button" onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}
                  className={cn('shrink-0 min-h-[36px] rounded-pill px-3 text-[12.5px] font-bold transition-colors',
                    filter === c.key ? 'bg-ink-700 text-white'
                      : c.warn ? 'bg-band-3/15 text-band-3-ink' : 'bg-card text-ink-500')}>
                  {c.label}<span className="ms-1 tabular-nums opacity-60">{c.count}</span>
                </button>
              ))}
              {bandId && (
                <button type="button" onClick={() => setBandId(null)}
                  className="flex shrink-0 min-h-[36px] items-center gap-1 rounded-pill bg-brand-600/10 px-3 text-[12.5px] font-bold text-brand-600">
                  {bandLabel} <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </>
      )}

      {toast && (
        <p role="status" className={cn('rounded-xl px-3 py-2 text-sm', toast.ok ? 'bg-accent-600/10 text-accent-900' : 'bg-accent-red/10 text-accent-red-ink')}>
          {toast.text}
        </p>
      )}

      {filter === 'pending' ? (
        <PendingList
          items={pending}
          loading={!people}
          coaches={coaches}
          myAthleteId={myAthleteId}
          onOpenFunnel={onOpenFunnel}
          onChanged={refreshAll}
          today={today}
        />
      ) : filter === 'left' ? (
        <LeftList items={left} loading={!people} onChanged={refreshAll} flash={flash} />
      ) : approved.length === 0 ? (
        <div className="space-y-3">
          <EmptyState icon={Users} title={manager ? 'אין עדיין מתאמנים' : 'אין לך עדיין מתאמנים'} description={manager ? 'מוסיפים חבר מועדון, או שולחים טופס למישהו חדש.' : 'מנהל האקדמיה משבץ אצלך מתאמנים.'} />
          {manager && (
            <button type="button" onClick={() => setAddOpen(true)}
              className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-brand-600 text-sm font-bold text-white">
              <UserPlus className="h-4 w-4" /> הוספה לאקדמיה
            </button>
          )}
        </div>
      ) : sections.length === 0 ? (
        <p className="rounded-card bg-card py-6 text-center text-sm text-ink-400">אין התאמה</p>
      ) : (
        sections.map((s) => {
          const ids = s.members.map((m) => m.athleteId);
          const allOn = ids.every((id) => selected.has(id));
          const isUnpaired = s.coachId === null;
          return (
            <section key={s.coachId ?? 'none'}>
              {(manager || sections.length > 1) && (
                <div className="mb-1 mt-1.5 flex min-h-[32px] items-center justify-between px-1">
                  <span className={cn('text-xs font-extrabold', isUnpaired ? 'text-band-3-ink' : 'text-ink-500')} dir="auto">
                    {isUnpaired ? 'בלי מאמן' : s.coachName || 'מאמן'} · <bdi dir="ltr">{s.members.length}</bdi>
                  </span>
                  {manager && (selecting ? (
                    <button type="button" className="min-h-[32px] px-1 text-xs font-extrabold text-brand-600"
                      onClick={() => setSelected((prev) => {
                        const next = new Set(prev);
                        for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
                        return next;
                      })}>
                      {allOn ? 'לנקות' : 'הכל'}
                    </button>
                  ) : isUnpaired ? (
                    <button type="button" className="min-h-[32px] px-1 text-xs font-extrabold text-brand-600"
                      onClick={() => setCoachSheet(s.members)}>
                      לשבץ
                    </button>
                  ) : (
                    <button type="button" className="min-h-[32px] px-1 text-xs font-extrabold text-brand-600"
                      onClick={() => { setSelecting(true); setSelected(new Set()); }}>
                      בחירה
                    </button>
                  ))}
                </div>
              )}
              <div className={cn('overflow-hidden rounded-2xl bg-card divide-y divide-page', isUnpaired && manager && 'ring-1 ring-band-3/30')}>
                {s.members.map((m) => (
                  <MemberRow
                    key={m.athleteId}
                    member={m}
                    locale={locale}
                    today={today}
                    selecting={selecting}
                    checked={selected.has(m.athleteId)}
                    onTap={() => (selecting ? toggle(m.athleteId) : onSelectMember(m))}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {/* The selection's actions, above the tab bar. */}
      {selecting && (
        <div className="fixed inset-x-3 z-[60] mx-auto flex max-w-md items-center gap-1.5 rounded-[18px] bg-ink-900 px-3 py-2.5 text-white shadow-[0_8px_24px_rgba(0,0,0,.25)] bottom-[calc(env(safe-area-inset-bottom)+96px)]">
          <b className="flex-1 text-sm"><bdi dir="ltr">{selected.size}</bdi> מתאמנים</b>
          {(['coach', 'band', 'remove'] as const).map((a) => (
            <button key={a} type="button" disabled={!selected.size}
              onClick={() => {
                if (a === 'coach') setCoachSheet(selectedMembers);
                else if (a === 'band') setBandSheet(selectedMembers);
                else setRemoveIds([...selected]);
              }}
              className={cn('min-h-[44px] rounded-xl bg-white/15 px-2.5 text-[13px] font-extrabold disabled:opacity-40', a === 'remove' && 'text-[#FFB4AE]')}>
              {a === 'coach' ? 'להעביר למאמן' : a === 'band' ? 'דבוקה' : 'להוציא'}
            </button>
          ))}
        </div>
      )}

      {manager && (
        <>
          <ChangeCoachSheet
            open={!!coachSheet}
            onOpenChange={(o) => { if (!o) setCoachSheet(null); }}
            members={coachSheet ?? []}
            coaches={coaches}
            onDone={async () => { await refreshAll(); exitSelect(); }}
          />
          <BandSheet
            open={!!bandSheet}
            onOpenChange={(o) => { if (!o) setBandSheet(null); }}
            members={bandSheet ?? []}
            bands={bands}
            onDone={async () => { await refreshAll(); exitSelect(); }}
          />
          <ConfirmSheet
            open={!!removeIds}
            onOpenChange={(o) => { if (!o) setRemoveIds(null); }}
            title={removeIds && removeIds.length === 1
              ? `להוציא את ${byId.get(removeIds[0])?.name ?? ''} מהאקדמיה?`
              : `להוציא ${removeIds?.length ?? 0} מתאמנים מהאקדמיה?`}
            description="נשארים רצים במועדון. מי אימן אותם וכל ההיסטוריה נשמרים, ואפשר להחזיר מ״עזבו״."
            confirmLabel="להוציא מהאקדמיה"
            cancelLabel="ביטול"
            onConfirm={async () => {
              const ids = removeIds ?? [];
              const r = await postBulk({ athleteIds: ids, action: 'remove' });
              flash(r.ok, r.ok ? (ids.length === 1 ? 'הוצא מהאקדמיה' : `${ids.length} הוצאו מהאקדמיה`) : r.error || 'לא הצלחנו');
              await refreshAll();
              exitSelect();
            }}
          />
          <AddMemberSheet
            open={addOpen}
            onOpenChange={setAddOpen}
            addable={people?.addable}
            coaches={coaches}
            bands={bands}
            onDone={refreshAll}
            onOpenFunnel={onOpenFunnel ? (id) => { setAddOpen(false); onOpenFunnel(id); } : undefined}
          />
        </>
      )}

      <Sheet open={bandFilterOpen} onOpenChange={setBandFilterOpen} title="לפי דבוקה">
        <div className="overflow-hidden rounded-card bg-card divide-y divide-page" dir="rtl">
          {[{ id: null as string | null, name: 'כל הדבוקות', count: approved.length }, ...bandChoices].map((b) => (
            <button key={b.id ?? 'all'} type="button" onClick={() => { setBandId(b.id); setBandFilterOpen(false); }}
              className="flex w-full min-h-[52px] items-center gap-3 px-4 text-start active:bg-page/60">
              <span className="flex-1 text-[15px] font-semibold text-ink-700">{b.name}</span>
              <span className="text-sm tabular-nums text-ink-400">{b.count}</span>
              {bandId === b.id && <Check className="h-4 w-4 text-brand-600" />}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────

function MemberRow({
  member: m, locale, today, selecting, checked, onTap,
}: {
  member: AcademyMember;
  locale: string;
  today: string;
  selecting: boolean;
  checked: boolean;
  onTap: () => void;
}) {
  const line = rowLine(m, today);
  const since = monthOf(m.academyJoinedOn, locale);
  const attention = line.kind === 'inactive' || line.kind === 'no_watch' || line.kind === 'never_ran';
  const sub = (() => {
    switch (line.kind) {
      case 'inactive': return <>לא רץ <bdi dir="ltr">{line.days}</bdi> ימים</>;
      case 'no_watch': return <>בלי שעון מחובר</>;
      case 'never_ran': return <>עוד לא רץ באקדמיה</>;
      case 'new': return line.days === 0 ? <>הצטרף היום</> : <>הצטרף לפני <bdi dir="ltr">{line.days}</bdi> ימים</>;
      case 'week': return <>{since && <>מאז {since} · </>}<bdi dir="ltr">{line.done}/{line.planned}</bdi> השבוע</>;
      default: return since ? <>מאז {since}</> : <>בלי תוכנית השבוע</>;
    }
  })();

  return (
    <button type="button" onClick={onTap} aria-pressed={selecting ? checked : undefined}
      className="flex w-full min-h-[56px] items-center gap-2.5 px-3 text-start active:bg-page/60">
      {selecting && (
        <span aria-hidden className={cn('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2',
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-300')}>
          {checked && <Check className="h-3 w-3" strokeWidth={4} />}
        </span>
      )}
      <MemberAvatar name={m.name} url={m.avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold text-ink-700" dir="auto">{m.name}</span>
        <span className={cn('block truncate text-xs', attention ? 'font-semibold text-band-3-ink' : 'text-ink-400')}>{sub}</span>
      </span>
      {!m.academyCoachId ? (
        <span className="shrink-0 rounded-md bg-band-3/15 px-1.5 py-0.5 text-[11px] font-extrabold text-band-3-ink">בלי מאמן</span>
      ) : m.band ? (
        <span className="shrink-0 rounded-md bg-brand-600/10 px-1.5 py-0.5 text-[11px] font-extrabold text-brand-600">{m.band.name}</span>
      ) : (
        <span className="shrink-0 rounded-md bg-page px-1.5 py-0.5 text-[11px] font-extrabold text-ink-500">בלי דבוקה</span>
      )}
      {!selecting && <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />}
    </button>
  );
}

// ── Waiting for approval ────────────────────────────────────────────────────

function PendingList({
  items, loading, coaches, myAthleteId, onOpenFunnel, onChanged, today,
}: {
  items: PendingApplicant[];
  loading: boolean;
  coaches: AcademyMembersResponse['coaches'];
  myAthleteId: string | null;
  onOpenFunnel?: (candidateId: string) => void;
  onChanged: () => Promise<void>;
  today: string;
}) {
  const [accepting, setAccepting] = useState<PendingApplicant | null>(null);
  const [deleting, setDeleting] = useState<PendingApplicant | null>(null);
  const [confirmTwice, setConfirmTwice] = useState<PendingApplicant | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Least loaded first, so the accept sheet's default is the coach with room.
  const funnelCoaches = coaches
    .filter((c) => c.coachId)
    .sort((a, b) => a.trainees - b.trainees)
    .map((c) => ({ id: c.coachId as string, name: c.coachName || '' }));

  const remove = async (p: PendingApplicant) => {
    setBusy(p.key);
    setError(null);
    try {
      const res = await fetch('/api/academy/members/application', {
        method: 'DELETE',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: p.athleteId, candidateId: p.candidateId, confirm: 'delete' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(res.status === 409 ? `לא נמחק: ${json.error || 'זה חשבון של חבר מועדון'}` : json.error || 'המחיקה נכשלה');
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Spinner size={20} /></div>;
  if (!items.length) {
    return <p className="rounded-card bg-card px-4 py-6 text-center text-sm text-ink-400">אין בקשות שממתינות. כשמישהו ממלא את הטופס, הוא מופיע כאן.</p>;
  }

  return (
    <>
      <div className="mb-1 mt-1.5 px-1 text-xs font-extrabold text-ink-500">ממתינים לאישור · <bdi dir="ltr">{items.length}</bdi></div>
      <div className="overflow-hidden rounded-2xl bg-card divide-y divide-page">
        {items.map((p) => {
          const days = p.appliedAt ? daysBetween(p.appliedAt, today) : null;
          const when = days === null ? null : days === 0 ? 'היום' : days === 1 ? 'אתמול' : days === 2 ? 'לפני יומיים' : <>לפני <bdi dir="ltr">{days}</bdi> ימים</>;
          return (
            <div key={p.key}>
              <div className="flex min-h-[56px] items-center gap-2.5 px-3">
                <MemberAvatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold text-ink-700" dir="auto">{p.name}</span>
                  <span className="block truncate text-xs text-ink-400">
                    {when && <>מילא טופס {when} · </>}{p.clubMember ? 'חבר מועדון' : 'לא חבר מועדון'}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold',
                  p.clubMember ? 'bg-brand-600/10 text-brand-600' : 'bg-accent-600/15 text-accent-900')}>
                  {p.clubMember ? 'מהמועדון' : 'חדש'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 px-3 pb-3">
                {p.candidateId && p.athleteId && (
                  <button type="button" onClick={() => setAccepting(p)}
                    className="min-h-[40px] rounded-xl bg-accent-600/15 px-3.5 text-[12.5px] font-extrabold text-accent-900">לקבל</button>
                )}
                {p.candidateId && onOpenFunnel && (
                  <button type="button" onClick={() => onOpenFunnel(p.candidateId!)}
                    className="min-h-[40px] rounded-xl bg-page px-3.5 text-[12.5px] font-extrabold text-ink-500">למשפך</button>
                )}
                {p.deletable && !p.clubMember && (
                  <button type="button" onClick={() => setDeleting(p)} disabled={busy === p.key}
                    className="min-h-[40px] rounded-xl bg-accent-red/10 px-3.5 text-[12.5px] font-extrabold text-accent-red-ink disabled:opacity-50">
                    {busy === p.key ? 'מוחק…' : 'למחוק את הבקשה'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 rounded-xl bg-accent-red/10 px-3 py-2 text-sm text-accent-red-ink" dir="auto">{error}</p>}
      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-400">
        ״למחוק״ קיים רק למי שאינו חבר מועדון: מוחק את הבקשה ואת החשבון שנפתח לו בטופס. חבר מועדון רק ״מוציאים״, והוא נשאר במועדון.
      </p>

      {accepting && (
        <AcceptSheet
          open={!!accepting}
          onOpenChange={(o) => { if (!o) setAccepting(null); }}
          candidateId={accepting.candidateId!}
          candidateName={accepting.name}
          coaches={funnelCoaches}
          isManager
          myId={myAthleteId && funnelCoaches.some((c) => c.id === myAthleteId) ? myAthleteId : null}
          linked={!!accepting.athleteId}
          onDone={() => void onChanged()}
        />
      )}
      <ConfirmSheet
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`למחוק את הבקשה של ${deleting?.name ?? ''}?`}
        description="נמחקים הכרטיס במשפך והחשבון שהטופס פתח. זה לא מוציא אף אחד מהמועדון."
        confirmLabel="המשך"
        cancelLabel="ביטול"
        onConfirm={() => { const p = deleting; setDeleting(null); setTimeout(() => setConfirmTwice(p), 350); }}
      />
      <ConfirmSheet
        open={!!confirmTwice}
        onOpenChange={(o) => { if (!o) setConfirmTwice(null); }}
        title="בטוח? אי אפשר לבטל את זה"
        description={`הבקשה של ${confirmTwice?.name ?? ''} תימחק לגמרי, עם התשובות שלו בטופס.`}
        confirmLabel="למחוק לגמרי"
        cancelLabel="לא, להשאיר"
        onConfirm={() => { if (confirmTwice) void remove(confirmTwice); }}
      />
    </>
  );
}

// ── Left ────────────────────────────────────────────────────────────────────

function LeftList({
  items, loading, onChanged, flash,
}: {
  items: LeftMember[];
  loading: boolean;
  onChanged: () => Promise<void>;
  flash: (ok: boolean, text: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (loading) return <div className="flex justify-center py-8"><Spinner size={20} /></div>;
  if (!items.length) return <p className="rounded-card bg-card px-4 py-6 text-center text-sm text-ink-400">אף אחד לא עזב את האקדמיה.</p>;

  const restore = async (p: LeftMember) => {
    setBusy(p.athleteId);
    const r = await postBulk({ athleteIds: [p.athleteId], action: 'restore', notify: true });
    setBusy(null);
    flash(r.ok, r.ok ? `${p.name} חזר לאקדמיה${p.previousCoachName ? `, אצל ${p.previousCoachName}` : ''}` : r.error || 'לא הצלחנו להחזיר');
    await onChanged();
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-card divide-y divide-page">
      {items.map((p) => (
        <div key={p.athleteId} className="flex min-h-[56px] items-center gap-2.5 px-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-page text-xs font-extrabold text-ink-500">
            {p.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-ink-700" dir="auto">{p.name}</span>
            <span className="block truncate text-xs text-ink-400">
              {[
                p.leftOn ? <>עזב ב־<bdi dir="ltr">{dayMonth(p.leftOn)}</bdi></> : <>עזב</>,
                p.previousCoachName ? <>היה אצל {p.previousCoachName.split(' ')[0]}</> : null,
                p.monthsIn ? (p.monthsIn === 1 ? <>חודש</> : <><bdi dir="ltr">{p.monthsIn}</bdi> חודשים</>) : null,
              ].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && ' · '}{x}</span>)}
            </span>
          </span>
          <button type="button" onClick={() => void restore(p)} disabled={busy === p.athleteId}
            className="min-h-[44px] shrink-0 px-2 text-[13px] font-extrabold text-brand-600 disabled:opacity-50">
            {busy === p.athleteId ? <Spinner size={14} /> : 'להחזיר'}
          </button>
        </div>
      ))}
    </div>
  );
}

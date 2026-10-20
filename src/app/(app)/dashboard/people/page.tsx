'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, Smartphone, Watch, Footprints, Bell, CheckCircle2, CalendarDays, UserRound, Plus, Route, Layers, Wrench, PauseCircle, UserMinus, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { EmptyState, Sheet, Skeleton } from '@/components/ui';
import { teammateHref } from '@/lib/athletes/profile-link';
import { israelDateOf } from '@/lib/reports/last-7-days';
import { PackMoveToast, PackSwitchSheet, laneOf, usePackMove, type PackGroup } from '@/components/packs/PackSwitch';
import {
  faceSignals, isStaffPerson, isWaitingPerson, wallAreas, wallSections,
  type FaceSignals, type Person, type Signal,
} from '@/lib/admin/people';

// ═════════════════════════════════════════════════════════════════════════════
// אנשים — the wall of faces (2026-10-20; Ofer chose "קיר פנים" of three mockups,
// ~/.cache/madregot/mockups/people-tab-3.html).
//
// What the tab is for: who is in each area, and how each of them is doing, at a
// glance. A filter row by area (each pack, the academy, הגרעין, staff, waiting, no
// pack); in "all" a section per area. Each face carries three signals that need
// no tap — touched the app, watch connected, ran lately — grey when fine, red
// when not, faded when not relevant yet; a face that never opened the app is
// drawn faded. A tap opens the card, which spells the same three icons out in
// words (Ofer: "make it clear what the icon on the photo means"), then
// notifications, and the actions. Logic in lib/admin/people.ts (faceSignals,
// wallAreas, wallSections).
// ═════════════════════════════════════════════════════════════════════════════

interface PeopleResponse { today: string; people: Person[] }

// Green when fine, red when not (Ofer, 10-20: "connected and in the app — green, not grey").
const SIGNAL_CLS: Record<Signal, string> = { ok: 'text-accent-600', bad: 'text-accent-red', off: 'text-ink-200' };
/** A pack's colour for a face with no photo, the same ramp the packs use elsewhere. */
const PACK_BG = ['bg-[#F0643C]', 'bg-brand-600', 'bg-accent-900', 'bg-[#8a3ffc]'];

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
}
/** "Shay N." — the wall's label: a first name alone repeats (two Shays). */
function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(' ');
  return last ? `${first} ${last[0]}.` : first;
}
function shortDate(iso: string): string {
  const day = iso.length > 10 ? israelDateOf(iso) : iso;
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function PeopleWall() {
  const t = useTranslations('people');
  const { data, isLoading, mutate } = useApi<PeopleResponse>('/api/admin/people');
  const { data: groupsData } = useApi<{ groups?: PackGroup[] }>('/api/groups');
  const groups = useMemo(() => groupsData?.groups ?? [], [groupsData]);
  const [packForId, setPackForId] = useState<string | null>(null);
  const packMove = usePackMove(() => { void mutate(); });
  const [area, setArea] = useState('all');
  // ?q= (from ניהול's search) and ?invite=1 (from "מה חדש?"'s "+").
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [inviting, setInviting] = useState(() => params.get('invite') === '1');
  const { data: needs } = useApi<{ join: number; joinOldestDays: number }>('/api/admin/needs-you');
  const [openId, setOpenId] = useState<string | null>(null);

  const today = data?.today ?? '';
  const people = useMemo(() => data?.people ?? [], [data]);
  const areas = useMemo(() => wallAreas(
    groups.map((g) => ({ id: g.id, name: g.name })),
    (n, name) => (laneOf(name) ? t('packN', { n: laneOf(name) }) : t('packN', { n })),
    { academy: t('area_academy'), core: t('area_core'), staff: t('area_staff'), waiting: t('area_waiting'), noPack: t('area_noPack') },
  ), [groups, t]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
  }, [people, query]);
  const sections = useMemo(() => wallSections(shown, areas, area), [shown, areas, area]);
  const packIndex = (id?: string | null) => groups.findIndex((g) => g.id === id);
  const open = people.find((p) => p.id === openId) ?? null;
  const packFor = people.find((p) => p.id === packForId) ?? null;
  const shownGroupId = (p: Person) =>
    packMove.pending?.athleteId === p.id && packMove.pending.when === 'today' ? packMove.pending.toGroupId : p.groupId ?? null;

  return (
    <div className="pb-6">
      <div className="flex items-start justify-between px-1">
        <div>
          <h1 className="text-[30px] font-black tracking-tight text-ink-700">{t('title')}</h1>
          {data && <p className="text-sm text-ink-400">{t('wallCount', { n: people.length })}</p>}
        </div>
        <button type="button" onClick={() => setInviting(true)} className="mt-1.5 inline-flex min-h-[38px] items-center gap-1 rounded-full bg-brand-600 px-3.5 text-[14px] font-semibold text-white shadow-[0_4px_12px_rgba(21,37,255,0.3)]">
          <Plus className="h-4 w-4" strokeWidth={2.6} />{t('invite')}
        </button>
      </div>

      {/* What the old roster and the entry queue held, as two doors from here. */}
      <div className="mt-3 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <Link href="/dashboard/onboarding-funnel?stage=approved" className="flex min-h-[54px] items-center gap-3 px-3.5 active:bg-page/60">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-[#5856d6] text-white"><Route className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15.5px] font-medium text-ink-700">{t('rowApprove')}</span>
            <span className="block text-[12.5px] text-ink-400">{needs?.join ? t('rowApproveSub', { n: needs.join, d: needs.joinOldestDays }) : t('rowApproveNone')}</span></span>
          {!!needs?.join && <span className="rounded-full bg-accent-red px-2 text-[13px] font-bold leading-[20px] text-white tabular-nums">{needs.join}</span>}
          <ChevronLeft className="h-4 w-4 text-ink-300" />
        </Link>
        <Link href="/dashboard/groups" className="flex min-h-[54px] items-center gap-3 px-3.5 active:bg-page/60">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent-900 text-white"><Layers className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15.5px] font-medium text-ink-700">{t('rowPacks')}</span>
            <span className="block text-[12.5px] text-ink-400">{t('rowPacksSub', { n: groups.length })}</span></span>
          <ChevronLeft className="h-4 w-4 text-ink-300" />
        </Link>
      </div>

      <label className="relative mt-3 block">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="min-h-[44px] w-full rounded-xl bg-card ps-9 pe-4 py-2 text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </label>

      {/* The areas, in one row that scrolls sideways. */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[{ key: 'all', label: t('area_all'), n: people.length }, ...areas.map((a) => ({ key: a.key, label: a.label, n: people.filter(a.test).length }))]
          .filter((a) => a.n > 0)
          .map((a) => (
            <button
              key={a.key}
              type="button"
              aria-pressed={area === a.key}
              onClick={() => setArea(a.key)}
              className={cn('flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold', area === a.key ? 'bg-ink-700 text-white' : 'bg-card text-ink-700')}
            >
              {a.label}
              <span className={cn('tabular-nums text-xs', area === a.key ? 'text-white/60' : 'text-ink-400')}>{a.n}</span>
            </button>
          ))}
      </div>

      {/* What the three icons on each photo say. */}
      <div className="mt-2 flex items-center gap-4 px-1 text-xs text-ink-400">
        <span className="flex items-center gap-1"><Smartphone className="h-3.5 w-3.5" />{t('legendApp')}</span>
        <span className="flex items-center gap-1"><Watch className="h-3.5 w-3.5" />{t('legendWatch')}</span>
        <span className="flex items-center gap-1"><Footprints className="h-3.5 w-3.5" />{t('legendRun')}</span>
        <span className="ms-auto flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent-red" />{t('legendBad')}</span>
      </div>

      {isLoading && !data ? (
        <div className="mt-5 grid grid-cols-3 gap-3">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-[22px]" />)}</div>
      ) : sections.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        sections.map(({ area: a, people: list }) => (
          <section key={a.key} className="mt-5">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-[19px] font-extrabold text-ink-700">{a.label}</h2>
              <span className="text-sm text-ink-400">{list.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-x-2.5 gap-y-3.5">
              {list.map((p) => {
                const s = faceSignals(p, today);
                const i = packIndex(p.groupId);
                return (
                  <button key={p.id} type="button" onClick={() => setOpenId(p.id)} className="text-center active:opacity-80" aria-label={p.name}>
                    <span className={cn('relative grid aspect-square place-items-center overflow-hidden rounded-[22px] text-[22px] font-extrabold text-white', i >= 0 ? PACK_BG[i % PACK_BG.length] : 'bg-ink-300', s.faded && !p.avatarUrl && 'opacity-55')}>
                      {initials(p.name)}
                      {p.avatarUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.avatarUrl} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()}
                          className={cn('absolute inset-0 h-full w-full object-cover', s.faded && 'opacity-55 grayscale')} />
                      )}
                      <SignalBar s={s} />
                    </span>
                    <span className="mt-1.5 block truncate text-[13.5px] font-semibold text-ink-700" dir="auto">{shortName(p.name)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && (
          <FaceCard
            person={open}
            today={today}
            packLabel={(() => { const g = groups.find((x) => x.id === shownGroupId(open)); return g ? t('packN', { n: laneOf(g.name) || packIndex(g.id) + 1 }) : null; })()}
            onPack={() => { setOpenId(null); setPackForId(open.id); }}
            onDone={() => { void mutate(); }}
          />
        )}
      </Sheet>

      <Sheet open={inviting} onOpenChange={setInviting} title={t('inviteTitle')}>
        {inviting && <InviteForm groups={groups} onDone={() => { void mutate(); }} />}
      </Sheet>

      <PackSwitchSheet
        open={!!packFor}
        onOpenChange={(o) => { if (!o) setPackForId(null); }}
        person={packFor ? { id: packFor.id, name: packFor.name, groupId: shownGroupId(packFor), pendingGroupId: packFor.pendingGroupId, pendingFrom: packFor.pendingFrom } : null}
        groups={groups}
        onMove={packMove.move}
      />
      <PackMoveToast pending={packMove.pending} failed={packMove.failed} groups={groups} onUndo={packMove.undo} onDismiss={packMove.dismissFailed} />
    </div>
  );
}

/** The three signals, on a small frosted bar across the bottom of the photo. */
function SignalBar({ s }: { s: FaceSignals }) {
  return (
    <span className="absolute inset-x-1.5 bottom-1.5 flex justify-around rounded-xl bg-white/90 py-1 backdrop-blur" aria-hidden>
      <Smartphone className={cn('h-4 w-4', SIGNAL_CLS[s.app])} strokeWidth={2.2} />
      <Watch className={cn('h-4 w-4', SIGNAL_CLS[s.watch])} strokeWidth={2.2} />
      <Footprints className={cn('h-4 w-4', SIGNAL_CLS[s.run])} strokeWidth={2.2} />
    </span>
  );
}

function Line({ icon, tint, label, value, bad, ok }: { icon: React.ReactNode; tint: string; label: string; value: string; bad?: boolean; ok?: boolean }) {
  return (
    <div className="flex min-h-[50px] items-center gap-3 px-3.5">
      <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white', tint)}>{icon}</span>
      <span className="flex-1 text-[15.5px] text-ink-700">{label}</span>
      <span className={cn('text-end text-[15px]', bad ? 'font-semibold text-accent-red' : ok ? 'font-semibold text-accent-900' : 'text-ink-400')}>{value}</span>
    </div>
  );
}

/**
 * The card a face opens. The same three icons as the photo, in the same order,
 * each with what it means in words; then notifications and setup; then the actions.
 */
function FaceCard({ person: p, today, packLabel, onPack, onDone }: {
  person: Person; today: string; packLabel: string | null; onPack: () => void; onDone: () => void;
}) {
  const t = useTranslations('people');
  const s = faceSignals(p, today);
  const waiting = isWaitingPerson(p);
  const [sent, setSent] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');
  const ago = (n: number | null) => (n === null ? '—' : n <= 0 ? t('today') : n === 1 ? t('yesterday') : t('daysAgo', { n }));
  const roleName = p.role === 'coach' ? t('role_coach') : p.role === 'academy_coach' ? t('role_academy_coach') : p.role === 'admin' ? t('role_admin') : null;
  const tags = [packLabel, p.isAcademy ? t('area_academy') : null, p.isCore ? t('area_core') : null, isStaffPerson(p) ? (roleName ?? t('area_staff')) : null, waiting ? t('area_waiting') : null].filter(Boolean).join(' · ');
  const profile = teammateHref(p.id);

  const post = async (url: string, body: Record<string, string>) => {
    setSent('busy');
    try {
      const res = await fetch(url, { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify(body) });
      setSent(res.ok ? 'ok' : 'fail');
      if (res.ok) onDone();
    } catch { setSent('fail'); }
  };

  return (
    <div className="pb-4" dir="rtl">
      <div className="text-center">
        <span className="relative mx-auto grid h-[92px] w-[92px] place-items-center overflow-hidden rounded-full bg-ink-300 text-[28px] font-extrabold text-white">
          {initials(p.name)}
          {p.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatarUrl} alt="" onError={(e) => e.currentTarget.remove()} className="absolute inset-0 h-full w-full object-cover" />
          )}
        </span>
        <p className="mt-2.5 text-[24px] font-black text-ink-700" dir="auto">{p.name}</p>
        {tags && <p className="text-sm text-ink-400">{tags}</p>}
      </div>

      {/* The photo's three icons, spelled out — same icons, same order. */}
      <div className="mt-4 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <Line icon={<Smartphone className="h-4 w-4" />} tint="bg-brand-600" label={t('lineApp')}
          value={waiting ? t('area_waiting') : s.appDays === null ? t('neverOpened') : `${ago(s.appDays)}${p.openedAs === 'browser' ? ` · ${t('openedBrowser')}` : p.openedAs === 'app' ? ` · ${t('openedApp')}` : ''}`}
          bad={s.app === 'bad'} ok={s.app === 'ok'} />
        <Line icon={<Watch className="h-4 w-4" />} tint="bg-accent-900" label={t('lineWatch')}
          value={p.source === 'garmin' ? 'Garmin' : p.source === 'strava' ? 'Strava' : t('notConnected')} bad={s.watch === 'bad'} ok={s.watch === 'ok'} />
        <Line icon={<Footprints className="h-4 w-4" />} tint="bg-[#ff9500]" label={t('lineRun')} value={s.runDays === null ? t('noRuns') : ago(s.runDays)} bad={s.run === 'bad'} ok={s.run === 'ok'} />
        <Line icon={<Bell className="h-4 w-4" />} tint="bg-accent-red" label={t('notifications')}
          value={p.pushDevices === 0 ? t('pushOff') : p.pushDead ? t('pushDeadShort') : t('pushOn', { n: p.pushDevices })} bad={s.push === 'bad'} ok={s.push === 'ok'} />
      </div>
      <div className="mt-3 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <Line icon={<CheckCircle2 className="h-4 w-4" />} tint="bg-ink-400" label={t('setup')} value={p.setupDone ? t('setupDone') : t('setupNotDone')} bad={!p.setupDone && !waiting} ok={p.setupDone} />
        <Line icon={<CalendarDays className="h-4 w-4" />} tint="bg-ink-400" label={t('lineSince')} value={p.joinedAt ? shortDate(p.joinedAt) : '—'} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {profile && (
          <Link href={profile} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-2xl bg-card text-[13.5px] font-semibold text-brand-600">
            <UserRound className="h-4 w-4" />{t('actProfile')}
          </Link>
        )}
        <button type="button" onClick={onPack} className="min-h-[48px] rounded-2xl bg-card text-[13.5px] font-semibold text-brand-600">{t('actPack')}</button>
        {waiting ? (
          p.groupId ? (
            <button type="button" disabled={sent === 'busy' || sent === 'ok'} onClick={() => post('/api/admin/approve', { athleteId: p.id })}
              className="min-h-[48px] rounded-2xl bg-accent-900 text-[13.5px] font-semibold text-white disabled:opacity-60">
              {sent === 'ok' ? `✓ ${t('actApproved')}` : t('actApprove')}
            </button>
          ) : (
            <Link href="/dashboard/entry-queue?at=mine" className="flex min-h-[48px] items-center justify-center rounded-2xl bg-card text-[13.5px] font-semibold text-brand-600">{t('actApprove')}</Link>
          )
        ) : (
          <button type="button" disabled={sent === 'busy' || sent === 'ok'} onClick={() => post('/api/admin/entry-queue/nudge', { athleteId: p.id })}
            className="min-h-[48px] rounded-2xl bg-card text-[13.5px] font-semibold text-brand-600 disabled:opacity-60">
            {sent === 'ok' ? `✓ ${t('actSent')}` : t('actRemind')}
          </button>
        )}
      </div>
      {sent === 'fail' && <p className="mt-2 text-center text-xs font-semibold text-accent-red">{t('actFailed')}</p>}

      {/* Managing the account — what the old roster (ספורטאים) held (2026-10-20). */}
      {!waiting && <AccountSection person={p} onDone={onDone} />}
    </div>
  );
}

/**
 * The account actions that lived only in the old roster: which watch feeds the
 * data, maintenance access, pause, and leaving the club. Leaving is the soft
 * removal (/api/admin/entry-queue/remove) — reversible — never the roster's hard
 * delete. Each destructive step asks once more.
 */
function AccountSection({ person: p, onDone }: { person: Person; onDone: () => void }) {
  const t = useTranslations('people');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'pause' | 'remove' | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const call = async (key: string, url: string, method: string, body: Record<string, string>) => {
    setBusy(key);
    try {
      const res = await fetch(url, { method, headers: await bearerHeaders(), body: JSON.stringify(body) });
      if (res.ok) { setDone(key); onDone(); }
    } finally { setBusy(null); setConfirm(null); }
  };
  const paused = p.status === 'paused';
  const other = p.source === 'garmin' ? 'strava' : 'garmin';
  return (
    <div className="mt-5">
      <p className="px-1 pb-1.5 text-[13px] font-semibold text-ink-400">{t('accountHeader')}</p>
      <div className="divide-y divide-page overflow-hidden rounded-2xl bg-card">
        {p.source && (
          <button type="button" disabled={!!busy} onClick={() => call('source', '/api/admin/athlete-source', 'PATCH', { athleteId: p.id, dataSource: other })}
            className="flex min-h-[52px] w-full items-center gap-3 px-3.5 text-start active:bg-page/60 disabled:opacity-60">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent-900 text-white"><Watch className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[15.5px] text-ink-700">{t('accSource')}</span>
              <span className="block text-[12.5px] text-ink-400">{done === 'source' ? `✓ ${t('accSourceDone', { to: other === 'garmin' ? 'Garmin' : 'Strava' })}` : t('accSourceSub', { from: p.source === 'garmin' ? 'Garmin' : 'Strava', to: other === 'garmin' ? 'Garmin' : 'Strava' })}</span></span>
          </button>
        )}
        <Link href="/dashboard/athletes" className="flex min-h-[52px] items-center gap-3 px-3.5 active:bg-page/60">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-ink-400 text-white"><Wrench className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15.5px] text-ink-700">{t('accMaintenance')}</span><span className="block text-[12.5px] text-ink-400">{t('accMaintenanceSub')}</span></span>
          <ChevronLeft className="h-4 w-4 text-ink-300" />
        </Link>
      </div>
      <div className="mt-3 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <button type="button" disabled={!!busy}
          onClick={() => (paused ? call('pause', '/api/athletes', 'PUT', { id: p.id, status: 'active' }) : confirm === 'pause' ? call('pause', '/api/athletes', 'PUT', { id: p.id, status: 'paused' }) : setConfirm('pause'))}
          className="flex min-h-[52px] w-full items-center gap-3 px-3.5 text-start active:bg-page/60 disabled:opacity-60">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-[#ff9500] text-white"><PauseCircle className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15.5px] text-ink-700">{paused ? t('accResume') : confirm === 'pause' ? t('accPauseConfirm') : t('accPause')}</span>
            <span className="block text-[12.5px] text-ink-400">{done === 'pause' ? '✓' : paused ? t('accResumeSub') : t('accPauseSub')}</span></span>
        </button>
        <button type="button" disabled={!!busy}
          onClick={() => (confirm === 'remove' ? call('remove', '/api/admin/entry-queue/remove', 'POST', { athleteId: p.id, action: 'remove' }) : setConfirm('remove'))}
          className="flex min-h-[52px] w-full items-center gap-3 px-3.5 text-start active:bg-page/60 disabled:opacity-60">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent-red text-white"><UserMinus className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15.5px] font-medium text-accent-red">{done === 'remove' ? `✓ ${t('accRemoved')}` : confirm === 'remove' ? t('accRemoveConfirm') : t('accRemove')}</span>
            <span className="block text-[12.5px] text-ink-400">{t('accRemoveSub')}</span></span>
        </button>
      </div>
    </div>
  );
}

/** "+ הזמנה": a name, an address and a pack, and the personal-link mail goes out (POST /api/athletes). */
function InviteForm({ groups, onDone }: { groups: PackGroup[]; onDone: () => void }) {
  const t = useTranslations('people');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'linkOnly' | 'fail'>('idle');
  const [link, setLink] = useState<string | null>(null);
  const ok = name.trim().length > 1 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && !!groupId;
  const send = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/athletes', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ name: name.trim(), email: email.trim(), groupId, sendEmail: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setState('fail'); return; }
      setLink(body.inviteLink ?? null);
      setState(body.emailed ? 'sent' : 'linkOnly');
      onDone();
    } catch { setState('fail'); }
  };
  if (state === 'sent' || state === 'linkOnly') {
    return (
      <div className="pb-4 text-center" dir="rtl">
        <p className="text-[20px] font-black text-ink-700">{state === 'sent' ? t('inviteSent', { name: name.trim().split(' ')[0] }) : t('inviteLinkOnly')}</p>
        <p className="mt-1 text-sm text-ink-400">{state === 'sent' ? t('inviteSentSub', { email: email.trim() }) : t('inviteLinkOnlySub')}</p>
        {link && (
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(link); }} className="mt-4 min-h-[48px] w-full rounded-2xl bg-card text-[15px] font-semibold text-brand-600">{t('inviteCopy')}</button>
        )}
      </div>
    );
  }
  return (
    <div className="pb-4" dir="rtl">
      <p className="text-sm text-ink-400">{t('inviteSub')}</p>
      <div className="mt-3 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <label className="flex min-h-[50px] items-center gap-3 px-3.5"><span className="w-16 shrink-0 text-[15px] text-ink-700">{t('inviteName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Noa Levi" dir="auto" className="min-w-0 flex-1 bg-transparent text-[15px] focus:outline-none" /></label>
        <label className="flex min-h-[50px] items-center gap-3 px-3.5"><span className="w-16 shrink-0 text-[15px] text-ink-700">{t('inviteEmail')}</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" placeholder="noa@gmail.com" dir="ltr" className="min-w-0 flex-1 bg-transparent text-start text-[15px] focus:outline-none" /></label>
        <div className="flex min-h-[50px] items-center gap-3 px-3.5"><span className="w-16 shrink-0 text-[15px] text-ink-700">{t('invitePack')}</span>
          <span className="flex gap-1.5">{groups.map((g, i) => (
            <button key={g.id} type="button" onClick={() => setGroupId(g.id)} aria-pressed={groupId === g.id}
              className={cn('h-9 min-w-[40px] rounded-lg px-2 text-[14px] font-bold', groupId === g.id ? 'bg-brand-600 text-white' : 'bg-page text-ink-700')}>{laneOf(g.name) || i + 1}</button>
          ))}</span></div>
      </div>
      <button type="button" disabled={!ok || state === 'busy'} onClick={send} className="mt-4 min-h-[50px] w-full rounded-2xl bg-brand-600 text-[16px] font-semibold text-white disabled:opacity-50">
        {state === 'busy' ? '…' : t('inviteSend')}
      </button>
      {state === 'fail' && <p className="mt-2 text-center text-xs font-semibold text-accent-red">{t('actFailed')}</p>}
    </div>
  );
}

/** Suspense: the wall reads ?q= and ?invite= (useSearchParams). */
export default function PeoplePage() {
  return <Suspense><PeopleWall /></Suspense>;
}

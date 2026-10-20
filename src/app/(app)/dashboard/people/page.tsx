'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, Smartphone, Watch, Footprints, Bell, CheckCircle2, CalendarDays, UserRound } from 'lucide-react';
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

const SIGNAL_CLS: Record<Signal, string> = { ok: 'text-ink-400', bad: 'text-accent-red', off: 'text-ink-200' };
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

export default function PeoplePage() {
  const t = useTranslations('people');
  const { data, isLoading, mutate } = useApi<PeopleResponse>('/api/admin/people');
  const { data: groupsData } = useApi<{ groups?: PackGroup[] }>('/api/groups');
  const groups = useMemo(() => groupsData?.groups ?? [], [groupsData]);
  const [packForId, setPackForId] = useState<string | null>(null);
  const packMove = usePackMove(() => { void mutate(); });
  const [area, setArea] = useState('all');
  const [query, setQuery] = useState('');
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
      <div className="px-1">
        <h1 className="text-[30px] font-black tracking-tight text-ink-700">{t('title')}</h1>
        {data && <p className="text-sm text-ink-400">{t('wallCount', { n: people.length })}</p>}
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

function Line({ icon, tint, label, value, bad }: { icon: React.ReactNode; tint: string; label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex min-h-[50px] items-center gap-3 px-3.5">
      <span className={cn('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white', tint)}>{icon}</span>
      <span className="flex-1 text-[15.5px] text-ink-700">{label}</span>
      <span className={cn('text-end text-[15px]', bad ? 'font-semibold text-accent-red' : 'text-ink-400')}>{value}</span>
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
          bad={s.app === 'bad'} />
        <Line icon={<Watch className="h-4 w-4" />} tint="bg-accent-900" label={t('lineWatch')}
          value={p.source === 'garmin' ? 'Garmin' : p.source === 'strava' ? 'Strava' : t('notConnected')} bad={s.watch === 'bad'} />
        <Line icon={<Footprints className="h-4 w-4" />} tint="bg-[#ff9500]" label={t('lineRun')} value={s.runDays === null ? t('noRuns') : ago(s.runDays)} bad={s.run === 'bad'} />
        <Line icon={<Bell className="h-4 w-4" />} tint="bg-accent-red" label={t('notifications')}
          value={p.pushDevices === 0 ? t('pushOff') : p.pushDead ? t('pushDeadShort') : t('pushOn', { n: p.pushDevices })} bad={s.push === 'bad'} />
      </div>
      <div className="mt-3 divide-y divide-page overflow-hidden rounded-2xl bg-card">
        <Line icon={<CheckCircle2 className="h-4 w-4" />} tint="bg-ink-400" label={t('setup')} value={p.setupDone ? t('setupDone') : t('setupNotDone')} bad={!p.setupDone && !waiting} />
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
    </div>
  );
}

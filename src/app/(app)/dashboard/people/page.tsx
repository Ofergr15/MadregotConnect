'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search, ChevronLeft } from 'lucide-react';
import { cn, groupDisplayName } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { EmptyState, Sheet, Skeleton } from '@/components/ui';
import { teammateHref } from '@/lib/athletes/profile-link';
import { israelDateOf } from '@/lib/reports/last-7-days';
import { daysUntil } from '@/lib/admin/content';
import { PackChip, PackMoveToast, PackSwitchSheet, dayMonth, laneOf, usePackMove, type PackGroup } from '@/components/packs/PackSwitch';
import {
  PEOPLE_FILTERS,
  filterCounts,
  matchesFilter,
  personState,
  type PeopleFilter,
  type Person,
  type PersonState,
} from '@/lib/admin/people';

// ═════════════════════════════════════════════════════════════════════════════
// אנשים — the admin's list of members (#71, phase 2).
//
// One row per member with ONE state pill, and four filters that are the
// questions an admin opens this with: who is waiting on me, who never finished
// setup, who has no watch, who has gone quiet. Tapping a row opens the member
// card: account health and the admin's next step, not their training — that
// stays on their own profile, one tap further.
//
// The roster at /dashboard/athletes is unchanged and still where people are
// invited, moved, paused and deleted; the card links there rather than
// duplicating any of it.
// ═════════════════════════════════════════════════════════════════════════════

interface PeopleResponse {
  today: string;
  people: Person[];
}

const PILL: Record<PersonState, string> = {
  waiting: 'bg-accent-red/20 text-accent-red-ink',
  paused: 'bg-page text-ink-500',
  noWatch: 'bg-accent-red/20 text-accent-red-ink',
  setup: 'bg-band-3/15 text-band-3-ink',
  silent: 'bg-band-3/15 text-band-3-ink',
  active: 'bg-accent-600/15 text-accent-900',
};

/** A role's label; a role with no message falls back to its name instead of the raw key. */
function roleLabel(t: ReturnType<typeof useTranslations<'people'>>, role: string): string {
  const key = `role_${role}` as never;
  return t.has(key) ? t(key) : role.replace(/_/g, ' ');
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';
}

/** dd.MM.yy from an ISO date or timestamp, read on the Israel calendar. */
function shortDate(iso: string): string {
  const day = iso.length > 10 ? israelDateOf(iso) : iso;
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function OpenedAsMark({ as, t }: { as: 'app' | 'browser' | null; t: (k: string) => string }) {
  if (as === 'app') return <span className="shrink-0 rounded-md bg-accent-600/15 px-1.5 py-0.5 text-3xs font-bold text-accent-900">📱 {t('openedApp')}</span>;
  if (as === 'browser') return <span className="shrink-0 rounded-md bg-band-3/15 px-1.5 py-0.5 text-3xs font-bold text-band-3-ink">🌐 {t('openedBrowser')}</span>;
  return <span className="shrink-0 rounded-md bg-page px-1.5 py-0.5 text-3xs font-bold text-ink-400" aria-label={t('openedUnknown')}>—</span>;
}

export default function PeoplePage() {
  const t = useTranslations('people');
  const { data, isLoading, mutate } = useApi<PeopleResponse>('/api/admin/people');
  const { data: groupsData } = useApi<{ groups?: PackGroup[] }>('/api/groups');
  const groups = useMemo(() => groupsData?.groups ?? [], [groupsData]);
  // The pack sheet, opened from a row's tag or the card (mockup: pack-change/switch-mockup.html).
  const [packForId, setPackForId] = useState<string | null>(null);
  const packMove = usePackMove(() => { void mutate(); });
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const today = data?.today ?? '';
  const people = useMemo(() => data?.people ?? [], [data]);
  const counts = useMemo(() => filterCounts(people, today), [people, today]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter(p => matchesFilter(p, filter, today) && (!q || p.name.toLowerCase().includes(q)));
  }, [people, filter, query, today]);
  const open = people.find(p => p.id === openId) ?? null;
  const packFor = people.find(p => p.id === packForId) ?? null;
  /** The pack to draw: a move waiting behind Undo already shows as done. */
  const shownGroupId = (p: Person) =>
    packMove.pending?.athleteId === p.id && packMove.pending.when === 'today' ? packMove.pending.toGroupId : p.groupId ?? null;
  const groupName = (id: string | null) => groups.find(g => g.id === id)?.name ?? null;
  const openPack = (p: Person) => { setOpenId(null); setPackForId(p.id); };

  /** The row's second line: the one fact behind its pill. */
  const subline = (p: Person) => {
    const bits: string[] = [];
    if (p.role !== 'runner') bits.push(roleLabel(t, p.role));
    const state = personState(p, today);
    if (state === 'silent' || state === 'active') {
      if (!p.lastRunDay) bits.push(t('noRunLately'));
      else {
        const n = -daysUntil(p.lastRunDay, today);
        bits.push(n === 0 ? t('ranToday') : n === 1 ? t('ranYesterday') : t('ranDaysAgo', { n }));
      }
    } else if (p.source) bits.push(t(p.source));
    return bits.join(' · ');
  };

  return (
    <div className="space-y-3 pb-6">
      <h1 className="text-[28px] font-black text-ink-700">{t('title')}</h1>

      <label className="relative block">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full bg-card border border-page rounded-full ps-9 pe-4 py-2.5 min-h-[44px] text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {PEOPLE_FILTERS.map(f => {
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 min-h-[44px] text-xs font-semibold transition-colors',
                on ? 'bg-ink-700 border-ink-700 text-white' : 'bg-card border-page text-ink-500',
              )}
            >
              {t(`filter_${f}` as never)}
              {data && <span className={cn('tabular-nums', on ? 'text-white/70' : 'text-ink-400')}>{counts[f]}</span>}
            </button>
          );
        })}
      </div>

      {isLoading && !data ? (
        <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-card" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="overflow-hidden rounded-card bg-card divide-y divide-page">
          {shown.map(p => {
            const state = personState(p, today);
            return (
              <li key={p.id} className="flex items-center pe-2">
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 ps-4 pe-2 py-3 min-h-[60px] text-start active:bg-page/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-bold text-ink-700">{p.name}</span>
                      {/* Their phone stopped showing notifications (lib/push-health, #108). */}
                      {p.pushDead && <span className="shrink-0 rounded-md bg-band-3/15 px-1.5 py-0.5 text-3xs font-bold text-band-3-ink">🔕 {t('pushDeadShort')}</span>}
                      {/* How they open Madregot: the installed app or a browser tab. */}
                      <OpenedAsMark as={p.openedAs ?? null} t={t} />
                    </span>
                    <span className="block truncate text-xs text-ink-400">{subline(p)}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold', PILL[state])}>
                    {t(`state_${state}` as never)}
                  </span>
                </button>
                {/* The pack, one tap from the list — a sibling of the row button,
                    since a button can't hold another one. */}
                <PackChip
                  compact
                  name={groupName(shownGroupId(p)) ?? p.groupName}
                  label={t('changePack', { name: p.name })}
                  onClick={() => openPack(p)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* No sheet title: the card opens on the member's name, large, and a title bar
          would say it twice. */}
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && (
          <MemberCard
            person={open}
            today={today}
            packName={groupName(shownGroupId(open)) ?? open.groupName}
            pendingName={open.pendingGroupId ? groupName(open.pendingGroupId) : null}
            onPack={() => openPack(open)}
          />
        )}
      </Sheet>

      <PackSwitchSheet
        open={!!packFor}
        onOpenChange={(o) => { if (!o) setPackForId(null); }}
        person={packFor ? {
          id: packFor.id,
          name: packFor.name,
          groupId: shownGroupId(packFor),
          pendingGroupId: packFor.pendingGroupId,
          pendingFrom: packFor.pendingFrom,
        } : null}
        groups={groups}
        onMove={packMove.move}
      />
      <PackMoveToast
        pending={packMove.pending}
        failed={packMove.failed}
        groups={groups}
        onUndo={packMove.undo}
        onDismiss={packMove.dismissFailed}
      />
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-end font-semibold text-ink-700">{value}</span>
    </div>
  );
}

function ActionRow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex min-h-[48px] items-center justify-between py-2 text-[15px] font-semibold text-ink-700">
      {label}
      <ChevronLeft className="h-4 w-4 text-ink-400" />
    </Link>
  );
}

/**
 * The admin's lens on one member. The alert on top is the same state as the
 * row's pill, spelled out with what to do about it; "active" has no alert.
 */
function MemberCard({
  person: p, today, packName, pendingName, onPack,
}: {
  person: Person;
  today: string;
  packName: string | null;
  pendingName: string | null;
  onPack: () => void;
}) {
  const t = useTranslations('people');
  const state = personState(p, today);
  const ago = (iso: string | null) => {
    if (!iso) return t('never');
    const n = -daysUntil(iso.length > 10 ? israelDateOf(iso) : iso, today);
    return n <= 0 ? t('today') : n === 1 ? t('yesterday') : t('daysAgo', { n });
  };
  const silentDays = p.lastRunDay ? -daysUntil(p.lastRunDay, today) : null;

  const alert: { title: string; hint: string } | null =
    state === 'waiting' ? { title: t('alertWaiting'), hint: t('alertWaitingHint') }
    : state === 'noWatch' ? { title: t('alertNoWatch'), hint: t('alertNoWatchHint') }
    : state === 'setup' ? { title: t('alertSetup'), hint: t('alertSetupHint') }
    : state === 'silent' ? {
      title: silentDays == null ? t('alertSilentNever') : t('alertSilent', { n: silentDays }),
      hint: t('alertSilentHint'),
    }
    : null;

  const profile = teammateHref(p.id);

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-600 text-lg font-extrabold text-white">
          {initials(p.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-black text-ink-700">{p.name}</p>
          <p className="text-xs text-ink-400">
            {[p.joinedAt ? t('memberSince', { date: shortDate(p.joinedAt) }) : null, p.groupName ? groupDisplayName(p.groupName) : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {alert && (
        <div className={cn(
          'rounded-card border-2 bg-card p-3.5',
          state === 'waiting' || state === 'noWatch' ? 'border-accent-red/35' : 'border-band-3/40',
        )}>
          <p className={cn('text-[15px] font-bold', state === 'waiting' || state === 'noWatch' ? 'text-accent-red' : 'text-band-3-ink')}>
            {alert.title}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{alert.hint}</p>
        </div>
      )}

      <section>
        <p className="mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">{t('account')}</p>
        <div className="rounded-card bg-card px-4 divide-y divide-page">
          <KV
            label={t('status')}
            value={state === 'waiting' ? t('statusWaiting') : state === 'paused' ? t('statusPaused') : t('statusApproved')}
          />
          <KV label={t('role')} value={roleLabel(t, p.role)} />
          <KV
            label={t('group')}
            value={
              <span className="inline-flex flex-col items-end gap-0.5">
                <PackChip
                  name={packName}
                  label={packName && laneOf(packName) ? t('packN', { n: laneOf(packName) }) : packName ? groupDisplayName(packName) : t('noGroup')}
                  onClick={onPack}
                />
                {pendingName && p.pendingFrom && (
                  <span className="text-2xs font-medium text-band-3-ink">
                    {t('packPending', { n: laneOf(pendingName) || '–', date: dayMonth(p.pendingFrom) })}
                  </span>
                )}
              </span>
            }
          />
          <KV label={t('source')} value={p.source ? t(p.source) : t('notConnected')} />
          <KV
            label={t('openedAs')}
            value={p.openedAs
              ? `${p.openedAs === 'app' ? `📱 ${t('openedApp')}` : `🌐 ${t('openedBrowser')}`}${p.openedAt ? ` · ${ago(p.openedAt)}` : ''}`
              : t('openedUnknown')}
          />
          <KV
            label={t('notifications')}
            value={p.pushDevices === 0
              ? t('noDevices')
              : [p.pushDead ? `🔕 ${t('pushDeadShort')}` : null, t('devices', { n: p.pushDevices }), p.lastPushAt ? t('deliveredOn', { date: ago(p.lastPushAt).toLowerCase() }) : null]
                .filter(Boolean).join(' · ')}
          />
          <KV label={t('setup')} value={p.setupDone ? t('setupDone') : t('setupNotDone')} />
          <KV label={t('lastRun')} value={p.lastRunDay ? ago(p.lastRunDay) : t('noRunLately')} />
          <KV label={t('lastSeen')} value={ago(p.lastSeenAt)} />
        </div>
        {p.openedAs === 'browser' && (
          <p className="mt-3 rounded-2xl bg-band-3/15 px-3 py-2.5 text-xs text-band-3-ink">{t('openedBrowserHint')}</p>
        )}
      </section>

      <section>
        <p className="mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-400">{t('actions')}</p>
        <div className="rounded-card bg-card px-4 divide-y divide-page">
          {profile && <ActionRow href={profile} label={t('openProfile')} />}
          {state === 'waiting' && <ActionRow href="/dashboard/entry-queue" label={t('openQueue')} />}
          <ActionRow href="/dashboard/athletes" label={t('manageRoster')} />
        </div>
      </section>
    </div>
  );
}

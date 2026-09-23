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

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';
}

/** dd.MM.yy from an ISO date or timestamp, read on the Israel calendar. */
function shortDate(iso: string): string {
  const day = iso.length > 10 ? israelDateOf(iso) : iso;
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

export default function PeoplePage() {
  const t = useTranslations('people');
  const { data, isLoading } = useApi<PeopleResponse>('/api/admin/people');
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

  /** The row's second line: the one fact behind its pill. */
  const subline = (p: Person) => {
    const bits: string[] = [];
    if (p.role !== 'runner') bits.push(t(`role_${p.role}` as never));
    if (p.groupName) bits.push(groupDisplayName(p.groupName));
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
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(p.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 min-h-[60px] text-start active:bg-page/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-extrabold text-white">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink-700">{p.name}</span>
                    <span className="block truncate text-xs text-ink-400">{subline(p)}</span>
                  </span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold', PILL[state])}>
                    {t(`state_${state}` as never)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* No sheet title: the card opens on the member's name, large, and a title bar
          would say it twice. */}
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && <MemberCard person={open} today={today} />}
      </Sheet>
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
function MemberCard({ person: p, today }: { person: Person; today: string }) {
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
          <KV label={t('role')} value={t(`role_${p.role}` as never)} />
          <KV label={t('group')} value={p.groupName ? groupDisplayName(p.groupName) : t('noGroup')} />
          <KV label={t('source')} value={p.source ? t(p.source) : t('notConnected')} />
          <KV
            label={t('notifications')}
            value={p.pushDevices === 0
              ? t('noDevices')
              : [t('devices', { n: p.pushDevices }), p.lastPushAt ? t('deliveredOn', { date: ago(p.lastPushAt).toLowerCase() }) : null]
                .filter(Boolean).join(' · ')}
          />
          <KV label={t('setup')} value={p.setupDone ? t('setupDone') : t('setupNotDone')} />
          <KV label={t('lastRun')} value={p.lastRunDay ? ago(p.lastRunDay) : t('noRunLately')} />
          <KV label={t('lastSeen')} value={ago(p.lastSeenAt)} />
        </div>
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

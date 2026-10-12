'use client';

import { use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, Users } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, resolveGroup } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { Spinner } from '@/components/ui';
import { setFeedScope } from '@/lib/feed/scope-store';
import { boardWindow, packWeek, type BoardEntry } from '@/lib/packs/pack-week';

// ═════════════════════════════════════════════════════════════════════════════
// A PACK'S HOME — /dashboard/packs/1..3 (feed redesign 2026-10-12, step 3). The
// way Strava gives every club a page: a cover in the pack's colour, its week in
// numbers, a board that always shows your own row, who is in it, and the way into
// the pack's own feed. Reached from the feed's pack strip.
// ═════════════════════════════════════════════════════════════════════════════

interface Roster { id: string; name: string; athletes?: Array<{ id: string; name: string | null; status: string | null; avatar_url?: string | null }> }

export default function PackPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = use(params);
  const index = Math.max(0, Math.min(2, (parseInt(n, 10) || 1) - 1));
  const t = useTranslations('pack');
  const tf = useTranslations('feed');
  const router = useRouter();
  const me = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;

  const { data: groupsData } = useApi<{ groups?: Roster[] }>('/api/groups');
  const { data: lb } = useApi<{ groupLeaderboards?: Record<string, BoardEntry[]>; leaderboard?: BoardEntry[] }>('/api/groups/leaderboard');

  const group = useMemo(() => (groupsData?.groups || []).find((g) => resolveGroup(g.name).index === index) ?? null, [groupsData, index]);
  const resolved = resolveGroup(group?.name);
  const hex = resolved.hex;
  const members = (group?.athletes || []).filter((a) => a.status === 'active' && a.name);
  const goal = group?.name.split(' - ')[1] || '';
  const week = useMemo(
    () => packWeek(lb?.groupLeaderboards?.[group?.id || ''] ?? [], members.map((m) => m.id), me),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lb, group?.id, members.length, me],
  );
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name || '';
  const avatarOf = (id: string) => members.find((m) => m.id === id)?.avatar_url || null;

  if (!groupsData) return <div className="mt-20 flex justify-center"><Spinner size={28} /></div>;
  if (!group) return <p className="mt-16 text-center text-sm text-ink-400">{t('notFound')}</p>;

  const openFeed = () => { setFeedScope({ squad: group.id }); router.push('/feed'); };

  return (
    <div className="mx-auto max-w-xl pb-10" dir="rtl">
      <div className="relative -mx-4 -mt-2 overflow-hidden px-5 pb-6 pt-5 text-white sm:mx-0 sm:rounded-[28px]" style={{ background: `radial-gradient(120% 90% at 85% 0%, ${hex}ee 0%, ${hex} 45%, #0B0C10 140%)` }}>
        <button type="button" onClick={() => router.back()} aria-label={t('back')} className="mb-6 flex h-9 w-9 items-center justify-center rounded-full bg-black/20 backdrop-blur">
          <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
        </button>
        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white text-[30px] font-black shadow-lg" style={{ color: hex }}>{index + 1}</div>
        <h1 className="mt-3 text-[30px] font-black tracking-tight">{tf('filterSquadN', { n: index + 1 })}</h1>
        <p className="mt-0.5 text-sm text-white/90">{t('membersCount', { count: members.length })}{goal ? ` · ${goal}` : ''}</p>
      </div>

      <div className="mt-3 rounded-[24px] bg-card p-4">
        <h2 className="mb-2 flex items-center justify-between text-[15px] font-extrabold text-ink-900">{t('thisWeek')}</h2>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t('kmTogether')} value={String(week.km)} />
          <Stat label={t('runs')} value={String(week.runs)} />
          <Stat label={t('ran')} value={`${week.ran}/${week.members}`} />
        </div>
      </div>

      <div className="mt-3 rounded-[24px] bg-card p-4">
        <h2 className="mb-1 flex items-center justify-between text-[15px] font-extrabold text-ink-900">
          {t('board')}<span className="text-xs font-semibold text-ink-400">{t('kmThisWeek')}</span>
        </h2>
        {boardWindow(week.board, me, 3).map((row, i) => row === 'gap' ? (
          <div key={`gap${i}`} className="py-1 text-center text-ink-300">⋯</div>
        ) : (
          <div key={row.id} className={cn('flex items-center gap-3 rounded-xl px-2 py-2', row.id === me && 'bg-page')} style={row.id === me ? { background: `${hex}14` } : undefined}>
            <span className="w-5 text-center text-sm font-extrabold text-ink-400 tabular-nums">{row.rank}</span>
            <FeedAvatar name={nameOf(row.id) || row.name} url={avatarOf(row.id)} className="h-8 w-8" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={row.id === me ? { color: hex } : undefined}>{row.id === me ? t('you') : (nameOf(row.id) || row.name)}</span>
            <span className="text-sm font-extrabold text-ink-900 tabular-nums">{row.distanceKm.toFixed(1)}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-[24px] bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-ink-900"><Users className="h-4 w-4" style={{ color: hex }} />{t('members')}</h2>
        <div className="grid grid-cols-5 gap-3">
          {members.map((m) => (
            <div key={m.id} className="flex flex-col items-center gap-1">
              <FeedAvatar name={m.name || ''} url={m.avatar_url || null} className="h-12 w-12" />
              <span className="w-full truncate text-center text-2xs text-ink-500" dir="auto">{(m.name || '').split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={openFeed}
        className="mt-4 flex h-14 w-full items-center justify-center rounded-2xl text-base font-extrabold text-white"
        style={{ background: hex }}
      >
        {t('openFeed')}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-page px-2 py-3 text-center">
      <b className="block font-[ui-rounded,system-ui] text-[24px] font-bold leading-none text-ink-900 tabular-nums"><bdi dir="ltr">{value}</bdi></b>
      <span className="mt-1 block text-xs text-ink-400">{label}</span>
    </div>
  );
}

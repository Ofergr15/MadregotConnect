'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useApi } from '@/lib/api';
import { resolveGroup } from '@/lib/utils';
import { packWeek, type BoardEntry } from '@/lib/packs/pack-week';

// The feed filtered to one pack opens with that pack's week in one line — faces,
// kilometres together, your place — and the way to its page (feed redesign
// 2026-10-12). Same two reads the Header and the pack page already make.

interface Roster { id: string; name: string; athletes?: Array<{ id: string; name: string | null; status: string | null; avatar_url?: string | null }> }

export function PackStrip({ groupId }: { groupId: string }) {
  const t = useTranslations('pack');
  const { data: groupsData } = useApi<{ groups?: Roster[] }>('/api/groups');
  const { data: lb } = useApi<{ groupLeaderboards?: Record<string, BoardEntry[]> }>('/api/groups/leaderboard');
  const group = (groupsData?.groups || []).find((g) => g.id === groupId);
  const me = typeof window !== 'undefined' ? localStorage.getItem('athlete_id') : null;
  const members = useMemo(() => (group?.athletes || []).filter((a) => a.status === 'active' && a.name), [group]);
  const week = useMemo(() => packWeek(lb?.groupLeaderboards?.[groupId] ?? [], members.map((m) => m.id), me), [lb, groupId, members, me]);
  if (!group || !lb) return <div className="mb-3 h-[68px]" aria-hidden />;
  const r = resolveGroup(group.name);
  if (r.index < 0) return null;
  const faces = members.filter((m) => m.avatar_url).slice(0, 3);

  return (
    <Link
      href={`/dashboard/packs/${r.index + 1}`}
      className="mb-3 flex items-center gap-3 rounded-[22px] px-3.5 py-3 text-white shadow-[0_10px_24px_-12px_rgba(0,0,0,0.45)] active:opacity-90"
      style={{ background: `linear-gradient(120deg, ${r.hex} 0%, ${r.hex}dd 60%, #0B0C10 160%)` }}
      dir="rtl"
    >
      <span className="flex">
        {faces.map((f, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={f.id} src={f.avatar_url!} alt="" className={`h-7 w-7 rounded-full border-2 border-white/90 object-cover ${i ? '-ms-2' : ''}`} />
        ))}
        {members.length > faces.length && <span className="-ms-2 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white/90 bg-white/25 px-1 text-3xs font-bold"><bdi dir="ltr">+{members.length - faces.length}</bdi></span>}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px]">{t('stripKm', { km: week.km })}</b>
        <span className="block text-xs text-white/90">{week.myRank ? t('stripRank', { rank: week.myRank }) : t('stripRan', { ran: week.ran, members: week.members })}</span>
      </span>
      <span className="flex h-8 shrink-0 items-center gap-1 rounded-pill bg-white/20 px-3 text-xs font-bold">{t('stripOpen')}<ChevronLeft className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" /></span>
    </Link>
  );
}

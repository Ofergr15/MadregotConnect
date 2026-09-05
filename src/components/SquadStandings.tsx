'use client';

import { Swords } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';

interface Squad {
  groupId: string;
  name: string;
  color: string;
  members: number;
  volumeKmPerMember: number;
  attendancePerMember: number;
  consistencyPct: number;
  score: number;
  rank: number;
}

// דבוקה squad rivalry — this-month standings, ranked by a blended per-member
// score (volume + attendance + consistency). Team-wide, shown to all roles.
// Hidden until there are ≥2 squads with data. Squad colors from resolveGroup.
//
// Same emoji as WeeklyLeaderboardCard, for the same reason — see the note there.
const MEDALS = ['🥇', '🥈', '🥉'];

export function SquadStandings() {
  const t = useTranslations('squads');
  const { data } = useApi<{ squads: Squad[] }>('/api/groups/standings');

  if (!data) return <SkeletonList count={3} />; // true first load → shaped skeleton

  const squads = data.squads ?? [];

  // Only worth showing when at least 2 squads have some activity.
  const active = squads.filter((s) => s.volumeKmPerMember > 0 || s.attendancePerMember > 0);
  if (active.length < 2) return null; // loaded but <2 active squads → hide entirely


  return (
    <div className="rounded-2xl bg-card border border-page p-4 sm:p-5" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Swords className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-semibold text-ink-700 uppercase tracking-wider">{t('title')}</h2>
        <span className="ms-auto text-2xs text-ink-400">{t('thisMonth')}</span>
      </div>

      <div className="space-y-2">
        {squads.map((s) => (
          <div
            key={s.groupId}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ backgroundColor: `${s.color}12`, border: `1px solid ${s.color}30` }}
          >
            {/* Emoji medals, not a tinted <Medal/>. The palette has no medal
                colours — band-1/2/3 are the three squad colours — so the old
                mapping gave 1st and 3rd the SAME orange and 2nd plain grey. */}
            <div className="shrink-0 w-6 flex justify-center text-base leading-none">
              {s.rank <= 3
                ? <span aria-hidden="true">{MEDALS[s.rank - 1]}</span>
                : <span className="text-sm font-bold text-ink-400 tabular-nums">{s.rank}</span>}
            </div>
            {/* Two lines, not one. The member count used to sit inline and was
                `shrink-0` like every one of the three stat columns beside it,
                which left the squad name as the only flexible thing in the row —
                so it absorbed the whole squeeze and a real name truncated to
                "…p 1". Dropping the count underneath gives the name the full
                inline width at any screen size. */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-bold text-ink-700 truncate" dir="auto">{s.name}</span>
              </div>
              <p className="mt-0.5 text-2xs text-ink-400 tabular-nums">{s.members} {t('members')}</p>
            </div>
            {/* per-member stats */}
            <div className="flex items-center gap-3 shrink-0 text-center">
              <div className="w-12">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.volumeKmPerMember}</div>
                <div className="text-[9px] text-ink-400 leading-none">{t('kmAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.attendancePerMember}</div>
                <div className="text-[9px] text-ink-400 leading-none">{t('attendAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.consistencyPct}%</div>
                <div className="text-[9px] text-ink-400 leading-none">{t('ranThisWeek')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-2xs text-ink-400">{t('footnote')}</p>
    </div>
  );
}

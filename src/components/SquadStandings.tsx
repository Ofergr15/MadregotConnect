'use client';

import { Swords, Medal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';

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
export function SquadStandings() {
  const t = useTranslations('squads');
  const { data } = useApi<{ squads: Squad[] }>('/api/groups/standings');

  const squads = data?.squads ?? [];

  // Only worth showing when at least 2 squads have some activity.
  const active = squads.filter((s) => s.volumeKmPerMember > 0 || s.attendancePerMember > 0);
  if (!data || active.length < 2) return null;

  const medalColor = (rank: number) =>
    rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-slate-300' : rank === 3 ? 'text-orange-400' : 'text-slate-500';

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4 sm:p-5" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Swords className="h-4 w-4 text-primary-400" />
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">{t('title')}</h2>
        <span className="ms-auto text-2xs text-slate-500">{t('thisMonth')}</span>
      </div>

      <div className="space-y-2">
        {squads.map((s) => (
          <div
            key={s.groupId}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{ backgroundColor: `${s.color}12`, border: `1px solid ${s.color}30` }}
          >
            <div className="shrink-0 w-6 flex justify-center">
              {s.rank <= 3
                ? <Medal className={`h-5 w-5 ${medalColor(s.rank)}`} />
                : <span className="text-sm font-bold text-slate-500">{s.rank}</span>}
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-sm font-bold text-white truncate">{s.name}</span>
              <span className="text-2xs text-slate-500 shrink-0">· {s.members} {t('members')}</span>
            </div>
            {/* per-member stats */}
            <div className="flex items-center gap-3 shrink-0 text-center">
              <div className="w-12">
                <div className="text-sm font-black text-white tabular-nums">{s.volumeKmPerMember}</div>
                <div className="text-[9px] text-slate-500 leading-none">{t('kmAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-white tabular-nums">{s.attendancePerMember}</div>
                <div className="text-[9px] text-slate-500 leading-none">{t('attendAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-white tabular-nums">{s.consistencyPct}%</div>
                <div className="text-[9px] text-slate-500 leading-none">{t('ranThisWeek')}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-2xs text-slate-500">{t('footnote')}</p>
    </div>
  );
}

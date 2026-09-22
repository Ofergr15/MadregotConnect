'use client';

import { useState } from 'react';
import { ChevronDown, Swords } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AthleteLink } from '@/components/AthleteLink';
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

// דבוקה squad rivalry — THIS WEEK's standings (Monday→now), ranked by a blended
// per-member score (volume + attendance + consistency). Team-wide, all roles.
//
// The window used to be the calendar month, and the card said so in one small
// corner label that nobody read — reported as "the kilometres in the contest
// between the groups don't reset from week to week". The window moved to weekly
// (see the route); this label moved with it and is the only thing on the card
// that names it, so it must never be left describing the old one.
// Hidden until there are ≥2 squads with data. Squad colors from resolveGroup.
//
// Same emoji as WeeklyLeaderboardCard, for the same reason — see the note there.
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * The roster behind each row, from /api/groups.
 *
 * A SECOND fetch rather than names added to /api/groups/standings, which returns
 * squad-level aggregates only and says so — and because /api/groups is already
 * the club roster, is already member-gated, and is already loaded on the feed
 * (the squad filter chips read it), so through SWR's cache this costs nothing
 * here and adds no endpoint and no exposure.
 */
interface GroupRoster {
  id: string;
  athletes?: { id: string; name: string | null; status: string | null }[];
}

export function SquadStandings() {
  const t = useTranslations('squads');
  const { data } = useApi<{ squads: Squad[] }>('/api/groups/standings');
  const { data: groupsData } = useApi<{ groups?: GroupRoster[] }>('/api/groups');
  // One squad open at a time: the card sits in a feed, and three rosters expanded
  // at once pushes the feed itself off the screen.
  const [openId, setOpenId] = useState<string | null>(null);

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
        <span className="ms-auto text-2xs text-ink-400">{t('thisWeek')}</span>
      </div>

      <div className="space-y-2">
        {squads.map((s) => {
          const open = openId === s.groupId;
          // Only active members: the standings divide by the active count, so a
          // roster that also listed inactive rows would contradict "3 members"
          // right above it.
          const roster = (groupsData?.groups || [])
            .find((g) => g.id === s.groupId)
            ?.athletes?.filter((a) => a.status === 'active' && a.name)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '')) ?? [];

          return (
          <div
            key={s.groupId}
            className="rounded-xl overflow-hidden"
            style={{ backgroundColor: `${s.color}12`, border: `1px solid ${s.color}30` }}
          >
          {/* A <button> around the row, with the roster as its SIBLING below —
              the names inside are <a>s, and an anchor nested in a button is
              neither valid nor reliably tappable. */}
          <button
            type="button"
            onClick={() => setOpenId(open ? null : s.groupId)}
            aria-expanded={open}
            className="w-full flex items-center gap-3 p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-inset"
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
              {/* The chevron rides on the SECOND line. On the first it would take
                  the ~24px that the squad name needs at 375px, and truncating a
                  real squad name to "…p 1" is a bug this row has already had. */}
              <p className="mt-0.5 flex items-center gap-1 text-2xs text-ink-400 tabular-nums">
                {s.members} {t('members')}
                <ChevronDown
                  className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
                  aria-hidden="true"
                />
              </p>
            </div>
            {/* per-member stats */}
            <div className="flex items-center gap-3 shrink-0 text-center">
              <div className="w-12">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.volumeKmPerMember}</div>
                <div className="text-3xs text-ink-400 leading-none">{t('kmAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.attendancePerMember}</div>
                <div className="text-3xs text-ink-400 leading-none">{t('attendAvg')}</div>
              </div>
              <div className="w-10">
                <div className="text-sm font-black text-ink-700 tabular-nums">{s.consistencyPct}%</div>
                <div className="text-3xs text-ink-400 leading-none">{t('ranThisWeek')}</div>
              </div>
            </div>
          </button>

          {open && (
            <div className="px-3 pb-3 -mt-0.5">
              {roster.length === 0 ? (
                // The count comes from the standings and the names from the group
                // list, so a roster still in flight (or an athlete with no group
                // row) must say something rather than collapse to a blank strip.
                <p className="text-2xs text-ink-400">{t('rosterLoading')}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {roster.map((a) => (
                    <li key={a.id}>
                      <AthleteLink
                        athleteId={a.id}
                        name={a.name}
                        className="block px-2.5 py-1 rounded-lg bg-card/70 text-xs font-medium text-ink-700"
                      >
                        <span dir="auto">{a.name}</span>
                      </AthleteLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          </div>
          );
        })}
      </div>
      <p className="mt-3 text-2xs text-ink-400">{t('footnote')}</p>
    </div>
  );
}

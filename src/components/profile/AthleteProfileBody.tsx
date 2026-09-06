'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { ChevronLeft, Users } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, getPlanWeekStart, israelDateAnchor } from '@/lib/utils';
import { formatPace, formatDuration } from '@/components/activity/format';
import { formatTime } from '@/lib/academy/benchmark';
import { SegmentedControl } from '@/components/ui';
import { weekTargetRange, type WeekPlanTotals } from '@/lib/plans/week-target';
import { WeekTargetBar } from '@/components/profile/WeekTargetBar';

// ═════════════════════════════════════════════════════════════════════════════
// The body of an athlete's profile — the SAME component whether you are looking
// at your own profile or a teammate's.
//
// That is the whole point of it. Before this there were two profiles: the owner's
// hub at /dashboard/profile (weekly km, the plan, the drill-downs) and a thin
// peer page at /dashboard/teammate/[id] that showed a name, a group and two
// follower counts and nothing else — no runs, no band, no kilometres. Tapping a
// name in the feed or the leaderboard led to a dead end.
//
// So the parts that are genuinely the same for both viewers live here, and the
// two routes keep only their own hero: the owner's greeting + photo picker, or
// the peer's back-nav + follow button. Everything below the hero is this file,
// which means the two views cannot drift and a fix lands on both at once.
//
// Layout is the segmented-tabs option (סקירה / ריצות / ק״מ) — the third of three
// mockups, chosen because the km table is a wide, dense thing that wants the
// full screen rather than a squeezed column inside a scroll.
//
// ── DATA ─────────────────────────────────────────────────────────────────────
// Reads GET /api/athletes/[id]/stats, which exists precisely because
// /api/athletes/summary, /volume-history and /prs are all owner-or-staff gated
// and 403 for a member looking at a teammate. Three keys total, and every one is
// shared with what the surrounding page already asks for, so SWR dedupes them:
// the peer route's own /public and /connections calls, and ProfileOverview's
// /api/plans/week.
// ═════════════════════════════════════════════════════════════════════════════

type ProfileSection = 'overview' | 'runs' | 'km';

interface KmWeek {
  weekStart: string;
  km: number;
  runs: number;
  paceSecPerKm: number | null;
  deltaPct: number | null;
  isCurrent: boolean;
}

interface RecentRun {
  id: string | null;
  name: string | null;
  startTime: string;
  km: number;
  durationSec: number;
  paceSecPerKm: number | null;
}

interface Pr {
  key: string;
  label: string;
  seconds: number | null;
  date: string | null;
  activityName: string | null;
  /** Measured inside a longer run rather than being the whole run. */
  fromSegment?: boolean;
  /** How long that run was, in metres. */
  sourceMeters?: number | null;
}

interface StatsData {
  totalKm: number;
  totalRuns: number;
  totalHours: number;
  currentWeekStart: string;
  thisWeek: { km: number; runs: number };
  /** This week so far vs the same slice of last week. Null when last week had no runs. */
  weekTrendPct: number | null;
  weeks: KmWeek[];
  recentRuns: RecentRun[];
  prs: Pr[];
}

interface AcademyBand {
  number: number | null;
  name: string | null;
  goal: string | null;
}

interface PublicProfile {
  name: string;
  groupName: string | null;
  isAcademy: boolean;
  academyBand: AcademyBand | null;
  coachName: string | null;
}

interface Connections {
  followerCount: number;
  followingCount: number;
}

export function AthleteProfileBody({
  athleteId,
  viewerId,
  variant,
  onFollowersClick,
  onFollowingClick,
}: {
  athleteId: string;
  /** The viewer's own athlete id — only used to key the connections request the
   *  same way the surrounding page does, so the two share one response. */
  viewerId?: string;
  variant: 'owner' | 'peer';
  onFollowersClick?: () => void;
  onFollowingClick?: () => void;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  // `followers` / `following` already exist under `teammate` in both locales —
  // reused rather than duplicated under `profile`, so the same two words can't
  // end up translated two ways.
  const tt = useTranslations('teammate');
  const locale = useLocale();
  const owner = variant === 'owner';

  const [section, setSection] = useState<ProfileSection>('overview');

  const { data: stats } = useApi<StatsData>(athleteId ? `/api/athletes/${athleteId}/stats` : null);
  const { data: profile } = useApi<PublicProfile>(athleteId ? `/api/athletes/${athleteId}/public` : null);
  const { data: connections } = useApi<Connections>(
    athleteId
      ? `/api/athletes/${athleteId}/connections${viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : ''}`
      : null,
  );

  // The club trains to ONE weekly programme (weekly_plans is keyed on a single
  // coach), so the goal is the same number for every athlete and this needs no
  // per-athlete lookup — the peer view and the owner's own view agree by
  // construction rather than by coincidence. Same band ProfileOverview draws,
  // through the same helper, so the two surfaces cannot disagree about it.
  const { data: weekPlan } = useApi<WeekPlanTotals>(
    `/api/plans/week?weekStart=${getPlanWeekStart(israelDateAnchor())}`,
  );
  const weekTarget = weekTargetRange(weekPlan);

  const weeks = stats?.weeks || [];
  const runs = stats?.recentRuns || [];
  const achievedPrs = (stats?.prs || []).filter((p) => p.seconds != null);

  // "Ahead of last week?" — this week so far against the same slice of last
  // week. Rendered next to whichever heading is actually on screen: the owner's
  // page already carries a week-km headline of its own (ProfileOverview, right
  // above this) so repeating it here would print the same two numbers twice on
  // one screen; there the badge rides on the chart instead.
  const trendBadge =
    stats?.weekTrendPct != null && stats.weekTrendPct !== 0 ? (
      // dir="ltr" because a signed number is not RTL text: inside the Hebrew
      // page bidi moves the sign to the far end and "−56%" renders as "56%−",
      // which reads as a typo.
      <span
        dir="ltr"
        className={cn(
          'rounded-md px-1.5 py-0.5 text-3xs font-bold tabular-nums',
          stats.weekTrendPct > 0 ? 'bg-accent-600/10 text-accent-900' : 'bg-band-3/10 text-band-3-ink',
        )}
      >
        {stats.weekTrendPct > 0 ? '+' : ''}
        {stats.weekTrendPct}%
      </span>
    ) : null;

  return (
    <div className="space-y-5">
      {/* ═══ THE TRIO — followers, following, all-time kilometres ═══ */}
      <div className="rounded-card bg-card px-4 py-3">
        <div className="grid grid-cols-3 [&>*+*]:border-s [&>*+*]:border-ink-300">
          <TrioCell
            value={connections?.followerCount ?? 0}
            label={tt('followers')}
            onClick={onFollowersClick}
          />
          <TrioCell
            value={connections?.followingCount ?? 0}
            label={tt('following')}
            onClick={onFollowingClick}
          />
          <TrioCell value={stats?.totalKm ?? 0} label={t('totalKm')} />
        </div>
      </div>

      {/* ═══ THE BAND (דבוקה) ═══
          Two different things share that word in Hebrew: the pace group everyone
          is in, and the academy's goal band. The pace group is the chip; the
          academy band and the personal coach only exist for an academy trainee,
          and this card renders nothing at all otherwise — for a regular member
          its only remaining content would be the pace group, which the page
          header already shows, so it would be a card with one repeated fact in
          it. (Ofer's call, and the API agrees: /public nulls both fields off the
          academy.) */}
      {profile?.isAcademy && (
        <section className="rounded-card bg-card p-4">
          <h2 className="text-xl font-bold text-ink-700">{owner ? t('myBand') : t('band')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.groupName && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-band-1/15 px-3 py-1 text-2xs font-bold text-brand-600">
                <Users className="h-3.5 w-3.5" />
                {profile.groupName}
              </span>
            )}
            {profile.academyBand && (
              <span className="inline-flex items-center rounded-pill bg-band-2/15 px-3 py-1 text-2xs font-bold text-band-2-ink">
                {t('academyBandChip', {
                  band: [profile.academyBand.name, profile.academyBand.goal].filter(Boolean).join(' · '),
                })}
              </span>
            )}
          </div>
          {profile.coachName && (
            <div className="mt-3 flex items-center gap-2 border-t border-page pt-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink-700" dir="auto">{profile.coachName}</p>
                <p className="text-xs font-light text-ink-400">{owner ? t('myCoach') : t('coach')}</p>
              </div>
              {owner && (
                <Link
                  href="/dashboard/academy"
                  className="shrink-0 rounded-pill border border-ink-300 px-3 py-1 text-2xs font-bold text-ink-500"
                >
                  {t('bandPaces')}
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {/* ═══ SECTION SWITCH ═══ */}
      <SegmentedControl<ProfileSection>
        value={section}
        onChange={setSection}
        options={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'runs', label: t('tabRuns') },
          { value: 'km', label: t('tabKm') },
        ]}
      />

      {section === 'overview' && (
        <>
          {/* ═══ THIS WEEK against the plan's own target ═══
              Peer view only. The owner's page renders this exact headline and
              bar a few rows above (ProfileOverview), and two identical
              "25.6/146.3" on one scroll is noise, not emphasis. */}
          {!owner &&
            (weekTarget ? (
              <WeekTargetBar
                title={t('weekKm')}
                doneKm={stats?.thisWeek.km ?? 0}
                target={weekTarget}
                badge={trendBadge}
              />
            ) : (
              // No plan for this week, so there is no band to measure against —
              // but the kilometres themselves are still the answer to "how is
              // their week going", so they stay, just without a bar.
              <div className="mb-2 flex items-end justify-between gap-2">
                <h2 className="text-xl font-bold text-ink-700">{t('weekKm')}</h2>
                <div className="flex shrink-0 items-baseline gap-2">
                  {trendBadge}
                  <p className="text-2xl font-bold text-brand-600 tabular-nums">{stats?.thisWeek.km ?? 0}</p>
                </div>
              </div>
            ))}

          <TenWeekChart
            weeks={weeks}
            title={t('lastTenWeeks')}
            emptyLabel={t('noKmHistory')}
            unit={tc('km')}
            badge={owner ? trendBadge : null}
          />

          {/* ═══ PERSONAL RECORDS ═══ */}
          {achievedPrs.length > 0 && (
            <section className="rounded-card bg-card p-4">
              <h2 className="text-xl font-bold text-ink-700">{t('personalRecords')}</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {achievedPrs.map((p) => (
                  <div key={p.key} className="rounded-tile bg-page px-3 py-2">
                    <p className="text-xs font-light text-ink-400">{prShortLabel(p)}</p>
                    {/* tabular-nums + dir="ltr": a time is not RTL text, and bidi
                        moves the colon in "1:45:20" when it sits in Hebrew flow. */}
                    <p dir="ltr" className="text-xl font-bold tabular-nums text-ink-700">
                      {formatTime(p.seconds as number)}
                    </p>
                    {/* Where it came from. A 5K best pulled out of a 31 km long
                        run is a number the reader will not recognise from any
                        run they remember doing, and the first question is always
                        "when, and out of what?". */}
                    {p.date && (
                      <p className="mt-0.5 text-3xs font-light text-ink-400">
                        <bdi dir="ltr">{new Date(p.date).toLocaleDateString('he-IL')}</bdi>
                        {p.fromSegment && p.sourceMeters ? (
                          <>
                            {' · '}
                            {t('prInsideRun', { km: Math.round(p.sourceMeters / 100) / 10 })}
                          </>
                        ) : null}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {section === 'runs' && (
        <section className="rounded-card bg-card p-4">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-bold text-ink-700">{t('recentRuns')}</h2>
            {owner && (
              <Link href="/dashboard/activities" className="inline-flex items-center gap-1 text-sm font-bold text-brand-600">
                {t('allRuns')}
                <ChevronLeft className="h-4 w-4" />
              </Link>
            )}
          </div>
          {runs.length === 0 ? (
            <p className="mt-3 text-sm font-light text-ink-400">{t('noRunsYet')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-page">
              {runs.map((r, i) => (
                <li key={r.id ?? `${r.startTime}-${i}`} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-700" dir="auto">
                      {r.name || t('tabRuns')}
                    </p>
                    <p className="text-xs font-light text-ink-400">
                      {new Date(r.startTime).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                      {r.paceSecPerKm != null && (
                        <>
                          {' · '}
                          <bdi dir="ltr" className="tabular-nums">{formatPace(r.paceSecPerKm)}</bdi>
                        </>
                      )}
                      {' · '}
                      <bdi dir="ltr" className="tabular-nums">{formatDuration(r.durationSec)}</bdi>
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-brand-600">
                    {r.km} <span className="text-xs font-light text-ink-400">{tc('km')}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === 'km' && (
        <section className="rounded-card bg-card p-4">
          <h2 className="text-xl font-bold text-ink-700">{t('lastTenWeeks')}</h2>
          {weeks.length === 0 ? (
            <p className="mt-3 text-sm font-light text-ink-400">{t('noKmHistory')}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-start text-xs font-light text-ink-400">
                  <th className="py-2 text-start font-light">{t('kmColWeek')}</th>
                  <th className="py-2 text-end font-light">{t('kmColKm')}</th>
                  <th className="py-2 text-end font-light">{t('kmColRuns')}</th>
                  <th className="py-2 text-end font-light">{t('kmColPace')}</th>
                  <th className="py-2 text-end font-light">{t('kmColChange')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-page">
                {/* Newest week first: the table is read for "how am I doing now",
                    and the chart above already tells the left-to-right story. */}
                {weeks.slice().reverse().map((w) => (
                  <tr key={w.weekStart} className={cn('tabular-nums', w.isCurrent && 'font-bold')}>
                    <td className="whitespace-nowrap py-2 text-start">
                      {/* A date is not RTL text. Without the bdi, he-IL bidi
                          flips the day and month around the separator. */}
                      <bdi dir="ltr">
                        {new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString(locale, {
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'UTC',
                        })}
                      </bdi>
                      {w.isCurrent && (
                        <span className="ms-1.5 rounded-pill bg-band-1/15 px-1.5 py-0.5 text-4xs font-bold text-brand-600">
                          {t('currentWeek')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-end text-ink-700">{w.km}</td>
                    <td className="py-2 text-end text-ink-500">{w.runs}</td>
                    <td className="py-2 text-end text-ink-500">
                      {w.paceSecPerKm != null ? <bdi dir="ltr">{formatPace(w.paceSecPerKm)}</bdi> : '—'}
                    </td>
                    <td className="py-2 text-end">
                      {w.deltaPct == null ? (
                        <span className="text-ink-300">—</span>
                      ) : (
                        // "+7%" renders as "7%+" in Hebrew flow without this.
                        <bdi
                          dir="ltr"
                          className={w.deltaPct >= 0 ? 'text-accent-900' : 'text-band-3-ink'}
                        >
                          {w.deltaPct > 0 ? '+' : ''}{w.deltaPct}%
                        </bdi>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function TrioCell({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-2xl font-bold tabular-nums text-ink-700">{value}</span>
      <span className="block text-xs font-light text-ink-400">{label}</span>
    </>
  );
  // A cell with nothing behind it stays a plain div rather than a disabled
  // button — a tappable-looking number that does nothing is worse than a static
  // one, and the peer view genuinely has nowhere for these to go yet.
  return onClick ? (
    <button type="button" onClick={onClick} className="px-2 text-center active:opacity-70">
      {body}
    </button>
  ) : (
    <div className="px-2 text-center">{body}</div>
  );
}

/**
 * Ten weekly totals as bars.
 *
 * `dir="ltr"` on the row, deliberately, even in Hebrew: the data is oldest-first
 * and the page's RTL flow laid the oldest week on the RIGHT — time running
 * backwards. A time axis reads left-to-right in a Hebrew chart the same as
 * anywhere else, and nothing inside needs mirroring (the labels are dates and
 * the values are numbers). Same reasoning, and the same fix, as WeeklyVolumeCard.
 */
function TenWeekChart({
  weeks,
  title,
  emptyLabel,
  unit,
  badge,
}: {
  weeks: KmWeek[];
  title: string;
  emptyLabel: string;
  unit: string;
  badge?: React.ReactNode;
}) {
  // The window is generated, so there are always ten rows — an athlete with no
  // history has ten ZEROES, and ten flat bars under a "last 10 weeks" heading
  // reads as a broken chart rather than as "you haven't run yet".
  if (weeks.length === 0 || weeks.every((w) => w.runs === 0)) {
    return (
      <section className="rounded-card bg-card p-4">
        <h2 className="text-xl font-bold text-ink-700">{title}</h2>
        <p className="mt-3 text-sm font-light text-ink-400">{emptyLabel}</p>
      </section>
    );
  }

  const peak = Math.max(...weeks.map((w) => w.km), 1);
  const ran = weeks.filter((w) => w.runs > 0);
  const avg = ran.length ? Math.round((ran.reduce((s, w) => s + w.km, 0) / ran.length) * 10) / 10 : 0;

  return (
    <section className="rounded-card bg-card p-4">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-ink-700">{title}</h2>
          {badge}
        </div>
        <p className="text-xs font-light text-ink-400 tabular-nums">
          <bdi dir="ltr">{avg}</bdi> {unit}
        </p>
      </div>
      {/* Columns are flex-1 rather than fixed: ten fixed columns plus gaps come
          to more than a 320pt screen can give. */}
      <div dir="ltr" className="mt-3 flex h-[104px] items-end justify-center gap-1">
        {weeks.map((w) => (
          <div key={w.weekStart} className="flex h-full min-w-0 flex-1 flex-col items-end justify-end">
            <span
              className={cn(
                'mb-1 w-full text-center text-4xs font-bold tabular-nums',
                w.isCurrent ? 'text-brand-600' : 'text-ink-400',
              )}
            >
              {w.km}
            </span>
            <div
              className={cn('w-full rounded-t-[3px]', w.isCurrent ? 'bg-brand-600' : 'bg-ink-300')}
              // Floor of 3px so a zero week is a visible baseline tick rather
              // than a gap that reads as missing data.
              style={{ height: `${Math.max(3, Math.round((w.km / peak) * 68))}px` }}
            />
            <span className="mt-1 w-full text-center text-4xs font-light tabular-nums text-ink-400">
              {w.weekStart.slice(8, 10)}/{w.weekStart.slice(5, 7)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The badge over a PR time. `PR_BUCKETS` labels the long two "Half Marathon" and
 * "Marathon", which is three words of English in a Hebrew column two digits
 * wide — the existing PR card already shortens them to HM/FM for the same
 * reason.
 */
function prShortLabel(pr: Pr): string {
  if (pr.key === 'hm') return 'HM';
  if (pr.key === 'fm') return 'FM';
  return pr.label;
}

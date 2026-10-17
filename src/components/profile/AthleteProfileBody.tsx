'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { ChevronLeft, Users } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn, getPlanWeekStart, israelDateAnchor, israelToday } from '@/lib/utils';
import { formatPace } from '@/components/activity/format';
import { formatTime } from '@/lib/academy/benchmark';
import { SegmentedControl } from '@/components/ui';
import { weekTargetRange, type WeekPlanTotals } from '@/lib/plans/week-target';
import { WeekTargetBar } from '@/components/profile/WeekTargetBar';
import { Last7DaysCard } from '@/components/profile/Last7DaysCard';
import type { Last7Report } from '@/lib/reports/last-7-days';
import { PrEditSheet } from '@/components/profile/PrEditSheet';
import { RunsBrowser } from '@/components/profile/RunsBrowser';
import { ProfileActivityFeed } from '@/components/profile/ProfileActivityFeed';
import { ProfileCounts } from '@/components/profile/ProfileCounts';
import { useIsSuperUser } from '@/lib/impersonation';
import { PrRecordList, type PrBreak } from '@/components/profile/PrRecordList';
import { PR_RETURN_KEY } from '@/components/profile/pr-format';
import { profileClubRanks, type ClubRecordBucket } from '@/lib/prs/club-records';
import { PaceAtHrCard } from '@/components/profile/PaceAtHrCard';

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

type ProfileSection = 'overview' | 'activity' | 'prs';

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
  meters?: number;
  seconds: number | null;
  date: string | null;
  activityName: string | null;
  /** The run it was set on — the row opens it. */
  activityId?: string | null;
  /** Measured inside a longer run rather than being the whole run. */
  fromSegment?: boolean;
  /** How long that run was, in metres. */
  sourceMeters?: number | null;
  /** 'manual' when the athlete stated this time by hand — see lib/prs/overrides.ts. */
  source?: 'auto' | 'manual';
  /** Where a stated time came from, in the athlete's words. */
  note?: string | null;
}

interface StatsData {
  totalKm: number;
  totalRuns: number;
  totalHours: number;
  yearKm: number;
  yearRuns: number;
  /** This calendar month so far (#103). */
  monthKm: number;
  monthDay: number;
  currentWeekStart: string;
  thisWeek: { km: number; runs: number };
  /** This week so far vs the same slice of last week. Null when last week had no runs. */
  weekTrendPct: number | null;
  weeks: KmWeek[];
  /** The rolling seven days — same payload the Saturday 18:00 push is built from. */
  last7: Last7Report;
  recentRuns: RecentRun[];
  prs: Pr[];
  /** Each record's breaks, oldest first (lib/prs/record-history.ts). */
  prHistory?: Record<string, PrBreak[]>;
  /** Israel's calendar year, and the best per bucket inside it. */
  prYear?: string;
  prYearBests?: Record<string, number | null>;
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
  // The club records board owns its own copy, and the link into it should read the
  // same here as it does there.
  const tRecords = useTranslations('records');
  const locale = useLocale();
  const owner = variant === 'owner';

  const [section, setSection] = useState<ProfileSection>('overview');
  const [editingPrs, setEditingPrs] = useState(false);
  // Back from a record's screen lands on the PRs tab it was opened from — the
  // section is component state, so the link left a one-shot note (pr-format.ts).
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PR_RETURN_KEY) === athleteId) {
        sessionStorage.removeItem(PR_RETURN_KEY);
        setSection('prs');
      }
    } catch {
      /* no storage: Overview, as before */
    }
  }, [athleteId]);

  const { data: stats, mutate: refreshStats } = useApi<StatsData>(
    athleteId ? `/api/athletes/${athleteId}/stats` : null,
  );
  const { data: profile } = useApi<PublicProfile>(athleteId ? `/api/athletes/${athleteId}/public` : null);

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
  const superUser = useIsSuperUser();
  const achievedPrs = (stats?.prs || []).filter((p) => p.seconds != null);
  // The club rank beside each record — fetched only on your own profile and only
  // once the PRs tab is open; on a teammate's it is never shown (profileClubRanks).
  // The board is a snapshot served from one row, so this is a cheap read.
  const { data: board } = useApi<{ buckets?: ClubRecordBucket[] }>(
    owner && section === 'prs' ? '/api/club/records' : null,
  );
  const ranks = profileClubRanks(board?.buckets, athleteId, owner);

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
      {/* ═══ THE COUNT ROW — runs + km this year, followers, following ═══
          Peer view only: on your own profile the same row sits inside the
          header card (ProfileOverview), right above this. */}
      {!owner && (
        <div className="rounded-[20px] bg-card px-3 py-2.5">
          <ProfileCounts
            athleteId={athleteId}
            viewerId={viewerId}
            onFollowersClick={onFollowersClick}
            onFollowingClick={onFollowingClick}
          />
        </div>
      )}

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
      {/* p-0.5: 48px instead of 52. The segments keep their 44px — the tap
          floor the UI audit holds every segmented control to. */}
      <SegmentedControl<ProfileSection>
        className="p-0.5"
        value={section}
        onChange={setSection}
        options={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'activity', label: t('tabActivity') },
          { value: 'prs', label: t('tabPrs') },
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

          {/* ═══ THE LAST SEVEN DAYS ═══
              Above the ten-week chart on purpose: this is the card the Saturday
              18:00 notification links to, so it has to be the first thing in view
              when that push opens the page. */}
          {stats?.last7 && <Last7DaysCard report={stats.last7} athleteName={profile?.name} />}

          <TenWeekChart
            weeks={weeks}
            title={t('lastTenWeeks')}
            emptyLabel={t('noKmHistory')}
            unit={tc('km')}
            currentTrendPct={stats?.weekTrendPct ?? null}
            month={stats ? { km: stats.monthKm, day: stats.monthDay } : null}
          />
          {/* All-time totals — the trio's third cell before the count row went
              to this year's numbers. */}
          {stats && stats.totalRuns > 0 && (
            <p className="-mt-3 px-1 text-xs font-light text-ink-400">
              {t('allTime', { km: stats.totalKm.toLocaleString('en-US'), runs: stats.totalRuns })}
            </p>
          )}
          {/* Pace at the same heart rate (#105) — the owner and staff only. */}
          <PaceAtHrCard athleteId={athleteId ?? null} owner={owner} />

          {/* The super user tries the two Strava-like views; it moved here when
              the runs tab became the Activity feed. */}
          {superUser && athleteId && <RunsBrowser athleteId={athleteId} weeks={weeks} />}
        </>
      )}

      {/* ═══ ACTIVITY — the feed, filtered to this athlete (#113) ═══ */}
      {section === 'activity' && athleteId && <ProfileActivityFeed athleteId={athleteId} />}

      {section === 'prs' && (
        <>
          {/* ═══ PERSONAL RECORDS ═══ */}
          {/* The owner sees this section even with nothing in it: the records are
              all derived, so an athlete whose races predate the club had no PRs
              AND no way to say so — which is the report (affd459d, a798197f). */}
          {(achievedPrs.length > 0 || (owner && (stats?.prs || []).length > 0)) && (
            <section className="rounded-card bg-card p-4">
              <div className="flex items-end justify-between gap-3">
                <h2 className="text-xl font-bold text-ink-700">{t('personalRecords')}</h2>
                {/* 36×20px measured — under WCAG 2.5.8's 24px floor. The padding
                    buys 52×47 out of the card's own p-4 and the space over the
                    tiles below; the negative margins put the word back exactly
                    where it was. The only other thing in this row is the heading,
                    so the halo has no control to steal from. */}
                {owner && (
                  <button
                    type="button"
                    onClick={() => setEditingPrs(true)}
                    className="-mx-2 -my-3.5 px-2 py-3.5 text-sm font-bold text-brand-600"
                  >
                    {tc('edit')}
                  </button>
                )}
              </div>
              {achievedPrs.length === 0 && (
                <p className="mt-2 text-sm font-light text-ink-400">{t('noPrsYet')}</p>
              )}
              {achievedPrs.length > 0 && (
                <PrRecordList
                  athleteId={athleteId}
                  prs={stats?.prs || []}
                  history={stats?.prHistory}
                  year={stats?.prYear}
                  yearBests={stats?.prYearBests}
                  ranks={ranks}
                  today={israelToday()}
                />
              )}
              {/* Into the club board. The records page has a nav entry, but that
                  entry needs a role_tab_permissions row for every non-admin role,
                  and this is the screen someone is already looking at records on —
                  so the door that matters is here and works for every member on
                  day one (the API is requireMember, same gate as this page's own
                  stats). Reports a798197f and f6c7b8dc both asked for the table. */}
              {/* 187×20px measured. The 44 comes out of space that already
                  existed: the old `mt-3` is now 14px of top padding minus 2px of
                  margin, so the text sits exactly where it did, and `-mb-3.5`
                  pulls the bottom half back into the card's p-4. Not `-my-3.5`,
                  which loses to `mt-*` in Tailwind's own property order and would
                  shift the row down.
                  The record tiles above are plain divs — no tap to steal. */}
              <Link
                href="/dashboard/records"
                className="inline-flex items-center gap-1 py-3.5 -mt-0.5 -mb-3.5 text-sm font-bold text-brand-600"
              >
                {tRecords('clubBoard')}
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <p className="mt-2.5 text-2xs leading-relaxed text-ink-400">{t('prOutdoorOnly')}</p>
            </section>
          )}
        </>
      )}


      {/* Owner only, and mounted once for the whole body rather than per tile:
          the sheet edits buckets that have no tile. */}
      {owner && (
        <PrEditSheet
          open={editingPrs}
          onOpenChange={setEditingPrs}
          athleteId={athleteId}
          prs={stats?.prs || []}
          onSaved={() => refreshStats()}
        />
      )}
    </div>
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
  currentTrendPct,
  month,
}: {
  weeks: KmWeek[];
  title: string;
  emptyLabel: string;
  unit: string;
  /** This week so far against the same slice of last week (stats.weekTrendPct). */
  currentTrendPct: number | null;
  /** This calendar month so far, for the second tile (#103). Null while loading. */
  month: { km: number; day: number } | null;
}) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const [picked, setPicked] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  // The window is generated, so there are always ten rows — an athlete with no
  // history has ten ZEROES, and a flat line under a "last 10 weeks" heading
  // reads as a broken chart rather than as "you haven't run yet".
  if (weeks.length === 0 || weeks.every((w) => w.runs === 0)) {
    return (
      <section className="rounded-card bg-card p-4">
        <h2 className="text-xl font-bold text-ink-700">{title}</h2>
        <p className="mt-3 text-sm font-light text-ink-400">{emptyLabel}</p>
      </section>
    );
  }

  // Strava's weekly chart (Ofer, 2026-10-16): one line, a dot per week, and the
  // picked week's numbers at the top instead of a number over every bar. It
  // replaced the bar chart AND the separate table card under the same title;
  // the table is one tap away inside this card. Pace is deliberately not in
  // the header (his call) — it stays a table column.
  const last = weeks.length - 1;
  const sel = picked ?? weeks.findIndex((w) => w.isCurrent);
  const i = sel >= 0 ? sel : last;
  const w = weeks[i];
  // The current week is still running, so its change is like-for-like (this
  // week so far against the same days last week); a finished week's is the
  // whole-week delta the table has always shown.
  const delta = w.isCurrent ? currentTrendPct : w.deltaPct;
  // #103: last finished week and this month, as two fixed tiles — the line
  // above follows whatever week is picked, these never move. "Last week" is
  // read off the same rows, so it is cut by the owner's week preference too.
  const cur = weeks.findIndex((x) => x.isCurrent);
  const prev = cur > 0 ? weeks[cur - 1] : null;
  const prevPrev = cur > 1 ? weeks[cur - 2] : null;
  const prevDiff = prev && prevPrev ? Math.round((prev.km - prevPrev.km) * 10) / 10 : null;
  const ran = weeks.filter((x) => x.runs > 0 && !x.isCurrent);
  const avg = ran.length ? Math.round((ran.reduce((s, x) => s + x.km, 0) / ran.length) * 10) / 10 : 0;

  // Geometry. Time runs left to right even in Hebrew — the row is dir="ltr",
  // same rule as the bars this replaced.
  const L = 40, R = 304, T = 14, B = 140, H = 170;
  const top = Math.max(50, Math.ceil(Math.max(...weeks.map((x) => x.km)) / 50) * 50);
  const x = (k: number) => L + ((R - L) * k) / Math.max(1, last);
  const y = (v: number) => B - ((B - T) * v) / top;
  const pts = weeks.map((x2, k) => [x(k), y(x2.km)] as const);
  const done = weeks[last].isCurrent ? pts.slice(0, -1) : pts;
  const line = (ps: readonly (readonly [number, number])[]) => 'M' + ps.map((p) => p.join(',')).join('L');
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const dateLabel = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <section className="rounded-card bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-ink-700">{title}</h2>
        <p className="shrink-0 text-xs font-light text-ink-400">
          {t('chartAvg', { avg: avg.toString(), unit })}
        </p>
      </div>

      <span className="mt-2.5 inline-block rounded-pill bg-band-1/15 px-2.5 py-0.5 text-xs font-bold text-brand-600">
        {w.isCurrent ? t('chartThisWeek') : t('chartWeekOf', { date: dateLabel(w.weekStart) })}
      </span>
      <div className="mt-2 grid grid-cols-3">
        <div>
          <p className="text-xs font-light text-ink-400">{t('kmColKm')}</p>
          <p className="text-[21px] font-extrabold tabular-nums text-ink-700">{w.km}</p>
        </div>
        <div>
          <p className="text-xs font-light text-ink-400">{t('kmColRuns')}</p>
          <p className="text-[21px] font-extrabold tabular-nums text-ink-700">{w.runs}</p>
        </div>
        <div>
          {/* The current week's number is like-for-like, so it says so — the
              table's whole-week column reads differently for the same row. */}
          <p className="text-xs font-light text-ink-400">{w.isCurrent ? t('chartVsSameDays') : t('chartVsLast')}</p>
          <p className="text-[21px] font-extrabold tabular-nums">
            {delta == null ? (
              <span className="text-ink-400">—</span>
            ) : (
              // "+7%" renders as "7%+" in Hebrew flow without the bdi.
              <bdi dir="ltr" className={delta > 0 ? 'text-accent-900' : delta < 0 ? 'text-band-3-ink' : 'text-ink-700'}>
                {delta > 0 ? '+' : ''}{delta}%
              </bdi>
            )}
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 320 ${H}`}
        // SVG coordinates are absolute, so the time axis already runs left to
        // right; `direction` keeps any text inside it LTR in a Hebrew page.
        style={{ direction: 'ltr' }}
        className="mt-1 block w-full"
        role="img"
        aria-label={title}
      >
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke="rgba(60,60,67,.12)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#7C7D87">{v}</text>
          </g>
        ))}
        {done.length > 1 && (
          <path
            d={`${line(done)}L${done[done.length - 1][0]},${B}L${done[0][0]},${B}Z`}
            className="fill-brand-600/[0.08]"
          />
        )}
        {done.length > 1 && (
          <path d={line(done)} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* The week in progress: dashed, because its number will still grow. */}
        {weeks[last].isCurrent && last > 0 && (
          <path d={line([pts[last - 1], pts[last]])} fill="none" className="stroke-brand-600" strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
        )}
        <line x1={pts[i][0]} x2={pts[i][0]} y1={T - 4} y2={B} className="stroke-brand-600" strokeWidth={1} opacity={0.35} />
        {weeks.map((wk, k) =>
          k % 3 === 0 || k === last ? (
            <text key={wk.weekStart} x={x(k)} y={B + 18} textAnchor="middle" fontSize={10} fill="#7C7D87">{dm(wk.weekStart)}</text>
          ) : null,
        )}
        {pts.map(([cx, cy], k) => (
          <circle
            key={weeks[k].weekStart}
            cx={cx}
            cy={cy}
            r={k === i ? 6 : 4}
            className={k === i ? 'fill-brand-600 stroke-white' : 'fill-white stroke-brand-600'}
            strokeWidth={k === i ? 2.5 : 2}
          />
        ))}
        {/* Hit targets: a full-height column per week, wider than the dot. */}
        {weeks.map((wk, k) => (
          <rect
            key={`hit-${wk.weekStart}`}
            x={x(k) - 14}
            y={0}
            width={28}
            height={H}
            fill="transparent"
            className="cursor-pointer outline-none"
            role="button"
            tabIndex={0}
            aria-label={`${dateLabel(wk.weekStart)}: ${wk.km} ${unit}`}
            aria-pressed={k === i}
            onClick={() => setPicked(k)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(k); } }}
          />
        ))}
      </svg>

      {(prev || month) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {prev && (
            <div className="rounded-[14px] bg-page px-3 py-2">
              <p className="text-xs font-light text-ink-400">{t('tileLastWeek')}</p>
              <p className="text-[19px] font-extrabold tabular-nums text-ink-700">
                {prev.km} <span className="text-xs font-semibold text-ink-400">{unit}</span>
              </p>
              {prevDiff != null && prevDiff !== 0 && (
                <p className={cn('text-2xs font-bold', prevDiff > 0 ? 'text-accent-900' : 'text-band-3-ink')}>
                  {prevDiff > 0 ? '▲' : '▼'} {t('tileVsWeekBefore', { km: Math.abs(prevDiff).toString() })}
                </p>
              )}
            </div>
          )}
          {month && (
            <div className="rounded-[14px] bg-page px-3 py-2">
              <p className="text-xs font-light text-ink-400">{t('tileThisMonth')}</p>
              <p className="text-[19px] font-extrabold tabular-nums text-ink-700">
                {month.km} <span className="text-xs font-semibold text-ink-400">{unit}</span>
              </p>
              <p className="text-2xs font-bold text-ink-400">{t('tileMonthDays', { days: month.day })}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-1 flex justify-center">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className="min-h-[36px] rounded-pill bg-page px-3 text-xs font-bold text-ink-500 active:opacity-70"
        >
          {showTable ? t('chartHideTable') : t('chartShowTable')}
        </button>
      </div>

      {showTable && (
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
            {/* Newest week first: the table is read for "how am I doing now". */}
            {weeks.map((row, k) => ({ row, k })).reverse().map(({ row, k }) => (
              <tr key={row.weekStart} className={cn('tabular-nums', k === i && 'font-bold')}>
                <td className="whitespace-nowrap py-2 text-start">
                  {/* A date is not RTL text: without the bdi, he-IL bidi flips
                      the day and month around the separator. */}
                  <bdi dir="ltr">{dateLabel(row.weekStart)}</bdi>
                  {row.isCurrent && (
                    <span className="ms-1.5 rounded-pill bg-band-1/15 px-1.5 py-0.5 text-3xs font-bold text-brand-600">
                      {t('currentWeek')}
                    </span>
                  )}
                </td>
                <td className="py-2 text-end text-ink-700">{row.km}</td>
                <td className="py-2 text-end text-ink-500">{row.runs}</td>
                <td className="py-2 text-end text-ink-500">
                  {row.paceSecPerKm != null ? <bdi dir="ltr">{formatPace(row.paceSecPerKm)}</bdi> : '—'}
                </td>
                <td className="py-2 text-end">
                  {row.deltaPct == null ? (
                    <span className="text-ink-400">—</span>
                  ) : (
                    <bdi dir="ltr" className={row.deltaPct >= 0 ? 'text-accent-900' : 'text-band-3-ink'}>
                      {row.deltaPct > 0 ? '+' : ''}{row.deltaPct}%
                    </bdi>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

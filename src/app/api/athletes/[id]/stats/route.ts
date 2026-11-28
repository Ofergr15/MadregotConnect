import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller, mayActFor } from '@/lib/auth/self-or-staff';
import { MASKED_STATS, parseHiddenStats, type MaskedStat } from '@/lib/activities/hidden-stats';
import { hiddenFromCaller } from '@/lib/athletes/test-accounts';
import { computeDistanceBests, filterQualifyingRuns, type RunActivityRow } from '@/lib/prs/pr-buckets';
import { applyPrLaps, loadPrLaps } from '@/lib/prs/attach-laps';
import { applyPrOverrides } from '@/lib/prs/overrides';
import { readPrOverrides } from '@/lib/prs/overrides-store';
import { readPrExclusions, excludedRunsByBucket } from '@/lib/prs/exclusions-store';
import { computeRecordHistory, yearBests } from '@/lib/prs/record-history';
import { athleteHidesPace, maskRecordTime } from '@/lib/records/pace-privacy';
import { fetchAllRows } from '@/lib/supabase/paginate';
import {
  buildAllTimeTotals,
  buildYearTotals,
  buildMonthTotals,
  buildKmTable,
  buildRecentRuns,
  computeLikeForLikeTrend,
  pickWeek,
} from '@/lib/athletes/profile-stats';
import { activityWeekOfPlanWeek, israelDateAnchor, israelToday, planWeekStartOf, weekStartOn } from '@/lib/utils';
import { planBreakdownFor } from '@/lib/week-story/server';
import { weekTargetRange } from '@/lib/plans/week-target';
import { readWeekStartDay } from '@/lib/athletes/week-pref';
import { buildLast7Report, withWellness } from '@/lib/reports/last-7-days';
import { buildPlanWeek, israelWallNow } from '@/lib/athletes/plan-week';
import { readWellnessNights } from '@/lib/wellness/read';
import { readProfileRollups } from '@/lib/athletes/stat-rollups';

export const dynamic = 'force-dynamic';

// GET /api/athletes/[id]/stats?weeks=10&runs=5
//
// Everything the unified athlete profile needs about someone's training, in ONE
// request: all-time totals, the weekly km table, this week's km, the recent-runs
// list and the distance PRs.
//
// ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
// /api/athletes/summary, /volume-history and /prs already produce these numbers,
// but all three are `mayActFor`-gated — own athlete, staff or super-user — so a
// normal club member gets 403 on every one of them when looking at a teammate.
// The profile is one page with two viewers (you, and anyone else in the club),
// and it cannot have half its cards blank for the second one.
//
// The gate here is `requireMember`: logged in AND belongs to this club. That is
// the same gate the shared weekly program and the leaderboards use, and it is
// the right level for this content — a leaderboard already tells every member
// how far each teammate ran this week. Nothing owner-only is exposed: no email,
// no auth-provider state, no onboarding status. Compare /public, which is
// careful about exactly that.
//
// Three round trips per page (this, /public, /connections) rather than the six
// the owner's screens currently make, which is deliberate — per-page API
// fan-out is a live performance problem in this app.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 10, 1), 52);
    const runLimit = Math.min(Math.max(Number(searchParams.get('runs')) || 5, 1), 30);


    // ONE read. Everything below is derived from the same set of activities, so
    // the totals, the weekly table, the trend badge and the PR grid cannot
    // disagree with each other — and there is no second table whose week anchor
    // could drift from this one's (see buildKmTable for the snapshots that did).
    //
    // Paged, because "one read" used to mean one REQUEST and PostgREST caps a
    // request at 1000 rows without complaining. That silently made this the
    // athlete's most recent thousand activities: the PR grid missed older bests
    // and `buildAllTimeTotals` was not all-time at all — on the club's heaviest
    // athlete it reported 8,749 km of a real 33,062. See lib/supabase/paginate.ts.
    //
    // Newest-first is load-bearing here (`buildRecentRuns` slices the head of this
    // array), so the sort stays and `id` is appended only as a unique tiebreak to
    // make the page boundaries deterministic.
    //
    // Every read below needs only the athlete id, so they all go out at once: they
    // used to run one after another, six function↔DB round trips (~225 ms each to
    // Tokyo) before the profile had a number to show (lab 2026-10-17: 1.45 s → one
    // round). The pending check is in the same round and is decided before
    // anything is returned; the extra reads for an athlete the caller may not see
    // are discarded unread.
    // `?as=member` (settings rev 3, "how members see me"): the owner previews the page as a
    // teammate gets it — no owner-only reads — so the preview is the server's projection.
    const self = caller.athleteId === id && new URL(request.url).searchParams.get('as') !== 'member';
    const reads = Promise.all([
      hiddenFromCaller(supabase, caller, id),
      fetchAllRows<RunActivityRow>((from, to) =>
      supabase
        .from('athlete_activities')
        // elevation_gain and calories ride along for the seven-day report's optional
        // metrics; nothing else on this payload reads them, and they cost no request.
        .select('id, activity_name, activity_type, start_time, distance, duration, elevation_gain, calories')
        .eq('athlete_id', id)
        .order('start_time', { ascending: false })
        .order('id')
        .range(from, to),
      ),
      readWeekStartDay(supabase, id),
      loadPrLaps(supabase, id),
      readPrOverrides(supabase, id),
      readPrExclusions(supabase, id),
      self ? readWellnessNights(supabase, id) : Promise.resolve(null),
      // Precomputed totals (PROFILE_STAT_ROLLUPS, default off → null, no query). Null also when
      // stale or missing, and the totals below fold from `acts` as before.
      readProfileRollups(supabase, id, israelToday()),
    ]);
    // A runner the club hasn't approved yet: their PRs and runs are theirs and
    // staff's to see, nobody else's (#77).
    const [pending, acts, ownStartDay, prLaps, prOverrides, prExclusions, wellness, rollups] = await reads;
    // `?week=plan` (the academy's screens, 2026-10-19): the plan's Sunday→Saturday week, so
    // the ten weeks agree with the week card above them (buildPlanWeek). The runner's own
    // profile leaves it off and keeps their own week setting.
    const startDay: typeof ownStartDay = new URL(request.url).searchParams.get('week') === 'plan' ? (0 as typeof ownStartDay) : ownStartDay;
    if (pending) return NextResponse.json({ error: 'Athlete not found' }, { status: 404 });

    // Israel's calendar day, not the server's UTC one: between midnight and
    // 03:00 Israel time a raw `new Date()` still reads as yesterday, which on a
    // Sunday puts "this week" a whole week behind.
    const anchor = israelDateAnchor();
    // THIS athlete's week, not the viewer's — see readWeekStartDay. Everything
    // weekly on the payload is cut with it so the chart, the "this week" tile and
    // the trend badge on one profile can't be measuring three different windows.
    const currentWeekStart = weekStartOn(anchor, startDay);

    // b23 profile "plan line": what the plan asks of THIS clock week. The plan week is
    // Sunday-anchored (planWeekStartOf), the km beside it is the Monday activity week
    // inside it (activityWeekOfPlanWeek) — CLAUDE.md "two anchors". Prescribed sessions,
    // short end (weekTargetRange.min); null with no plan, never 0.
    const planWeekStart = planWeekStartOf();
    const planBreakdown = await planBreakdownFor(supabase as never, id, planWeekStart).catch(() => null);
    const planTarget = planBreakdown ? weekTargetRange({ ...planBreakdown, hasPlan: true }) : null;

    const weekTable = buildKmTable(acts, { limit: weeks, currentWeekStart, startDay });
    const planWeekRaw = buildPlanWeek(acts, israelWallNow());

    // Laps are pulled separately and only for the runs long enough to hold a PR
    // segment — see attach-laps.ts for why they don't ride along with the select
    // above, which everything else on this payload is built from.
    const prRuns = applyPrLaps(filterQualifyingRuns(acts), prLaps);
    // Anything this athlete has corrected by hand. Read here as well as in
    // /api/athletes/prs because both routes render the same tiles on the same
    // screen, and a correction visible on one but not the other would be a worse
    // bug than the wrong number it fixed. Absent table (104 not pasted yet) reads
    // as "no corrections" — see overrides-store.ts.
    // And the runs they took out of their records (migration 146): out of the record,
    // its history, this year's best — the same run everywhere, or it reappears.
    const prs = applyPrOverrides(computeDistanceBests(prRuns, { excluded: prExclusions }), prOverrides);
    // Each record's history, off the same runs and the same per-run arithmetic, so
    // its last break IS the record above. A bucket the athlete took down (hidden)
    // keeps no history either: hiding a record that the timeline still drew would
    // not have hidden it. See lib/prs/record-history.ts.
    const prYear = israelToday().slice(0, 4);

    // Pace / calories the runner hid in the share sheet (feed_items.payload.hiddenFields)
    // are withheld from anyone who is not the runner and not staff — and from the owner's
    // own `?as=member` preview (lib/activities/hidden-stats.ts). One batched read over the
    // runs this payload exposes per-run: the recent-runs list and the seven-day window.
    // A failed read hides every masked stat on all of them: "could not tell" never publishes.
    const asMember = searchParams.get('as') === 'member';
    const masked = asMember || !mayActFor(caller, id);
    const recentRaw = buildRecentRuns(acts, runLimit);
    const last7Raw = buildLast7Report(acts, israelToday());
    const hiddenById = new Map<string, Set<MaskedStat>>();
    if (masked) {
      // Every run whose time reaches this payload in any form: the recent list, the seven
      // days, the weekly table's window (its pace column) and the plan week's day runs —
      // a run hidden on one card must not have its pace derivable from another (Q24-2).
      const tableFrom = weekTable[0]?.weekStart ?? '';
      const ids = [...new Set([
        ...recentRaw.map((r) => r.id),
        ...last7Raw.days.flatMap((d) => d.activities.map((a) => a.id)),
        ...acts.filter((a) => a.start_time.slice(0, 10) >= tableFrom).map((a) => a.id),
        ...[...planWeekRaw.dayRuns, ...planWeekRaw.lastDayRuns].flat().map((r) => r.id),
      ].filter((x): x is string => !!x))];
      if (ids.length) {
        const all = () => { for (const i of ids) hiddenById.set(i, new Set(MASKED_STATS)); };
        try {
          // Chunked: the window can hold a few hundred ids and `.in()` rides the URL.
          for (let i = 0; i < ids.length; i += 150) {
            const { data, error } = await supabase.from('feed_items').select('activity_id, payload').in('activity_id', ids.slice(i, i + 150));
            if (error) { all(); break; }
            for (const f of (data || []) as Array<{ activity_id: string; payload?: { hiddenFields?: unknown } | null }>) {
              const h = parseHiddenStats(f.payload?.hiddenFields);
              if (h.size) hiddenById.set(f.activity_id, h);
            }
          }
        } catch { all(); }
      }
    }
    const isHidden = (rid: string | null | undefined, k: MaskedStat) => !!rid && !!hiddenById.get(rid)?.has(k);
    // Hidden pace (#77 rule, Q24-2): the pace must not be derivable either, so the run's
    // time goes too (km ÷ time IS the pace), and it drops out of every pace aggregate.
    // Its km stays in every km total.
    const paceHidden = (rid: string | null | undefined) => masked && isHidden(rid, 'pace');
    const anyPaceHidden = masked && acts.some((a) => paceHidden(a.id));
    const recentRuns = recentRaw.map((r) =>
      paceHidden(r.id) ? { ...r, paceSecPerKm: null, durationSec: null, paceHidden: true } : r,
    );
    const paceActs = anyPaceHidden ? acts.filter((a) => !paceHidden(a.id)) : acts;
    const weeksOut = anyPaceHidden
      ? (() => {
          const visible = buildKmTable(paceActs, { limit: weeks, currentWeekStart, startDay });
          return weekTable.map((w, i) => ({ ...w, paceSecPerKm: visible[i]?.paceSecPerKm ?? null }));
        })()
      : weekTable;
    const planWeekOut = anyPaceHidden
      ? (() => {
          const strip = (list: typeof planWeekRaw.dayRuns) =>
            list.map((day) => day.map((r) => (paceHidden(r.id) ? { ...r, seconds: null, paceHidden: true } : r)));
          const dayRuns = strip(planWeekRaw.dayRuns);
          const seconds = dayRuns.flat().reduce((t, r) => t + (r.seconds ?? 0), 0);
          return { ...planWeekRaw, dayRuns, lastDayRuns: strip(planWeekRaw.lastDayRuns), seconds };
        })()
      : planWeekRaw;
    const caloriesHidden = masked && acts.some((a) => isHidden(a.id, 'calories'));
    const reportActs = caloriesHidden
      ? acts.map((a) => (isHidden(a.id, 'calories') ? { ...a, calories: null } : a))
      : acts;
    let last7Base = caloriesHidden || anyPaceHidden ? buildLast7Report(reportActs, israelToday()) : last7Raw;
    if (anyPaceHidden) {
      // Time and pace from the visible runs only; km, runs and the rest from all of them.
      const visible = buildLast7Report(reportActs.filter((a) => !paceHidden(a.id)), israelToday());
      last7Base = {
        ...last7Base,
        seconds: visible.seconds,
        paceSeconds: visible.paceSeconds,
        days: last7Base.days.map((d, i) => {
          const hid = d.activities.some((a) => paceHidden(a.id));
          return hid ? { ...d, seconds: visible.days[i].seconds, paceHidden: true } : d;
        }),
      };
    }
    const last7Out = {
      ...last7Base,
      ...(caloriesHidden ? { caloriesHidden: true } : {}),
      ...(anyPaceHidden ? { paceHidden: true } : {}),
    };
    const history = computeRecordHistory(prRuns, prExclusions);
    const prHistory = Object.fromEntries(
      prs.map((p) => [p.key, p.seconds == null ? [] : history[p.key] || []]),
    );
    // A runner who hides pace (default_hidden_fields ∋ 'pace') hides their record times
    // from teammates and from their own `?as=member` preview: a record is pace at a
    // coarser grain (2026-11-23). Fails closed — lib/records/pace-privacy.ts.
    const recordsHidden = masked && await athleteHidesPace(supabase, id);
    const prYearBests = yearBests(prRuns, prYear, prExclusions);

    return NextResponse.json({
      ...(rollups?.allTime ?? buildAllTimeTotals(acts)),
      // Israel's calendar year, from the same anchor the weekly cut uses, so the
      // count row turns over at local midnight on 1 January, not UTC's.
      ...(rollups?.year ?? buildYearTotals(acts, Number(israelToday().slice(0, 4)))),
      // This calendar month so far — the second tile beside the ten-week chart (#103).
      ...(rollups?.month ?? buildMonthTotals(acts, israelToday())),
      currentWeekStart,
      // Echoed so the screen can SAY which week it drew. A total the reader can't
      // reconcile is the original complaint; two legal windows with no label on
      // either would just move it.
      weekStartDay: startDay,
      thisWeek: pickWeek(weeksOut, currentWeekStart),
      // This week so far against the same slice of last week — not against last
      // week's total, which reads as a collapse every Monday.
      weekTrendPct: computeLikeForLikeTrend(acts, anchor, startDay),
      weeks: weeksOut,
      // "השבוע שלי": the plan week (Sunday) by day, last week to this same minute, and
      // ten such weeks — one window for the whole card (lib/athletes/plan-week.ts).
      planWeek: planWeekOut,
      planKm: planTarget ? planTarget.min : null,
      planKmMax: planTarget ? planTarget.max : null,
      planKmWeek: { planWeekStart, activityWeekStart: activityWeekOfPlanWeek(planWeekStart) },
      // Last night's sleep and resting HR, for the home's strip — the athlete's own only
      // (health data, #69), and only a night the watch actually reported (today's date).
      lastNight: (() => {
        if (caller.athleteId !== id) return null;
        const n = (wellness ?? []).find((w) => w.date === israelToday() && (w.sleep_seconds || w.resting_hr));
        return n ? { sleepSeconds: n.sleep_seconds ?? null, restingHr: n.resting_hr ?? null } : null;
      })(),
      // The rolling seven days behind the profile card and the Saturday 18:00
      // push. Folded from the SAME `acts` this payload is already built from, so
      // it needs no request of its own and cannot disagree with the week table
      // beside it about a run. See lib/reports/last-7-days.ts for why the window
      // rolls instead of following the Mon–Sun activity week.
      // Sleep and resting HR are health data: folded in for the athlete's own
      // profile only, never for a teammate or a coach browsing it (#69).
      last7: self
        ? withWellness(last7Out, wellness ?? [])
        : last7Out,
      recentRuns,
      // Same bucket math as /api/athletes/prs and the badge award engine, so a
      // PR shown here is the one a "first 10K" badge fired on.
      prs: recordsHidden ? prs.map(maskRecordTime) : prs,
      prHistory: recordsHidden ? Object.fromEntries(prs.map((p) => [p.key, []])) : prHistory,
      ...(recordsHidden ? { prsPaceHidden: true } : {}),
      // "This year: 37:55" beside an older record, cut on Israel's calendar year.
      prYear,
      prYearBests: recordsHidden ? Object.fromEntries(Object.keys(prYearBests).map((k) => [k, null])) : prYearBests,
      // The runs taken out, per distance, so the record screen can put them back.
      prExcluded: recordsHidden ? {} : excludedRunsByBucket(acts, prExclusions),
    });
  } catch (error) {
    console.error('Failed to fetch athlete profile stats:', error);
    return NextResponse.json({ error: 'Failed to fetch athlete profile stats' }, { status: 500 });
  }
}

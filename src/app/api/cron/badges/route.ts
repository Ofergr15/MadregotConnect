import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { reconcileClubFollows } from '@/lib/follows/club-sync';
import { cronPaused } from '@/lib/cron-pause';
import { inBatches } from '@/lib/badges/batches';
import { deadlineFrom, readCursor, rotateAfter, saveCursor } from '@/lib/cron/budget';
import { withCronRun } from '@/lib/cron/runs';

export const dynamic = 'force-dynamic';
// Was 60, and the serial roster pass hit it two days running (QA 24.11 Q24-4).
export const maxDuration = 300;

/** Night queue #60: athletes evaluated at once. The serial loop ran past 60 s on the full roster. */
const SWEEP_CONCURRENCY = 6;
const BADGES_CURSOR_KEY = 'badges_sweep_cursor';

// Daily badge sweep — the ONLY rule_type this cron evaluates is
// attendance_perfect_month (059_badges.sql): unlike pr_bucket/
// cumulative_distance/streak_weeks/race_count (all checked inline right
// after the event that could complete them — see sync-activities and
// races/route.ts), a "perfect calendar month" can only be judged once that
// month has fully ended, so there's no single triggering event to hang it
// off. Scopes the SAME shared engine to one rule_type rather than
// duplicating any evaluation logic here — see lib/badges/award-engine.ts.
//
// Secured with CRON_SECRET like the other crons.
async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const outOfTime = deadlineFrom();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createServerClient();
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id')
    .eq('coach_id', COACH_ID)
    .eq('status', 'active');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Piggybacks on this sweep because it needs the same thing the sweep does —
  // one daily pass over the active roster. Athletes can go active through paths
  // that never call syncClubFollows (an admin status flip, direct SQL), and a
  // missing follow row silently means their runs notify nobody.
  let follows: { athletes: number; rows: number } | null = null;
  try {
    follows = await reconcileClubFollows(supabase);
  } catch { /* follow graph is an enhancement; never fail the badge sweep */ }

  // Resumes after the last run's cursor and stops at ~270 s with the cursor saved, so a
  // cut-short pass is finished by the next one instead of re-doing the same head of the list.
  const roster = rotateAfter((athletes || []) as Array<{ id: string }>, await readCursor(supabase, BADGES_CURSOR_KEY));
  let checked = 0;
  let partial = false;
  let cursor: string | null = null;
  const awarded: Array<{ athleteId: string; badges: string[] }> = [];
  // Batches of SWEEP_CONCURRENCY (night queue #60), checking the clock between batches; the cursor is
  // the last athlete of the last finished batch, so a cut-short pass resumes right after it.
  const ids = roster.map((a) => a.id);
  for (let i = 0; i < ids.length; i += SWEEP_CONCURRENCY) {
    if (outOfTime()) { partial = true; break; }
    const batch = ids.slice(i, i + SWEEP_CONCURRENCY);
    await inBatches(batch, SWEEP_CONCURRENCY, async (athleteId) => {
      checked++;
      try {
        const { awarded: newBadges } = await checkAndAwardBadges(athleteId, {
          ruleTypes: ['attendance_perfect_month'],
        });
        if (newBadges.length > 0) {
          awarded.push({ athleteId, badges: newBadges.map((b) => b.code) });
        }
      } catch {
        // One athlete's evaluation failing must not stop the sweep.
      }
    });
    cursor = batch[batch.length - 1];
  }

  await saveCursor(supabase, BADGES_CURSOR_KEY, partial ? cursor : null);
  return NextResponse.json({ ok: true, checked, total: roster.length, partial, awarded, follows });
}

export const GET = withCronRun('badges', (request: Request) => run(request));
export const POST = withCronRun('badges', (request: Request) => run(request));

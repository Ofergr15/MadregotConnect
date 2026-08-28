import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { checkAndAwardBadges } from '@/lib/badges/award-engine';
import { reconcileClubFollows } from '@/lib/follows/club-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  let checked = 0;
  const awarded: Array<{ athleteId: string; badges: string[] }> = [];
  for (const athlete of athletes || []) {
    checked++;
    try {
      const { awarded: newBadges } = await checkAndAwardBadges(athlete.id, {
        ruleTypes: ['attendance_perfect_month'],
      });
      if (newBadges.length > 0) {
        awarded.push({ athleteId: athlete.id, badges: newBadges.map((b) => b.code) });
      }
    } catch {
      // One athlete's evaluation failing must not stop the sweep.
    }
  }

  return NextResponse.json({ ok: true, checked, awarded, follows });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

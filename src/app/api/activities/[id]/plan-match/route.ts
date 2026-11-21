import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { planTargetForDate } from '@/lib/post-workout';
import { mayActFor, resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

// GET /api/activities/[id]/plan-match — how this one activity's distance compares
// to that day's planned target, for the ActivitySyncEditor's "plan match" card.
//
// Self-or-staff (hardening proposal, 2026-11-21). It was unauthenticated on the theory that
// it "only reads the club's plan" — but planTargetForDate(date, athlete_id) reads that
// athlete's OWN rows too (an academy trainee's personal plan), and the answer is a completion
// percentage on a named person's run: the class CLAUDE.md keeps self-or-staff. A caller who
// may not read it gets { matched: false } — the state the card already renders as "nothing
// to show" — never a 403, so nothing else on that sheet breaks. Unsigned callers get 401.
// Per-person answer: never cached by a browser, a CDN or the service worker — every
// response, the refusals included.
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown) => NextResponse.json(body, { headers: NO_STORE });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { denied, caller } = await resolveVerifiedCaller(request);
    if (denied) { denied.headers.set('Cache-Control', NO_STORE['Cache-Control']); return denied; }
    const { id } = await params;
    const supabase = createServerClient();
    const { data: activity, error } = await supabase
      .from('athlete_activities')
      .select('start_time, distance, athlete_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!activity || !activity.start_time) return reply({ matched: false });
    if (!activity.athlete_id || !mayActFor(caller, activity.athlete_id)) return reply({ matched: false });

    const dateStr = activity.start_time.split('T')[0];
    const target = await planTargetForDate(dateStr, activity.athlete_id);
    if (!target) return reply({ matched: false });

    const targetMidKm = (target.min + target.max) / 2;
    if (targetMidKm <= 0) return reply({ matched: false });

    const actualKm = (activity.distance || 0) / 1000;
    const pct = Math.round((actualKm / targetMidKm) * 100);

    return reply({
      matched: true,
      pct,
      actualKm: Math.round(actualKm * 10) / 10,
      targetKm: Math.round(targetMidKm * 10) / 10,
      type: target.type,
    });
  } catch {
    return reply({ matched: false });
  }
}

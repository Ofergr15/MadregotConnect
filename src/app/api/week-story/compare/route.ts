import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelNow, israelToday } from '@/lib/utils';
import { lastClosedWindow } from '@/lib/week-story/summary';
import { loadWeekCompare } from '@/lib/week-story/compare-server';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/week-story/compare[?weekStart=YYYY-MM-DD (a Monday)&athleteId=]  → { compare } | { compare: null }
 *
 * The weekly summary's comparisons (task 184), on the activity week (Monday–Sunday): the
 * caller's km against their group (average, median, place among those who ran), every group's
 * average, and the caller's own trend against their last four weeks. Default week = the last
 * closed activity week (the one the summary card shows). Self only; staff may read anyone's.
 * Other members appear only as aggregates, and a group under three runners is left out.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const staff = caller.isStaff || caller.isSuperUser || hasRole(caller, 'admin');
  const athleteId = (staff && q.get('athleteId')) || caller.athleteId;
  if (!athleteId) return NextResponse.json({ compare: null }, { headers: PRIVATE });

  const raw = q.get('weekStart');
  let weekStart: string;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || new Date(`${raw}T12:00:00Z`).getUTCDay() !== 1) {
      return NextResponse.json({ error: 'weekStart must be a Monday (YYYY-MM-DD)' }, { status: 400, headers: PRIVATE });
    }
    weekStart = raw;
  } else {
    weekStart = lastClosedWindow(israelToday(), israelNow().hour).weekStart;
  }
  if (weekStart > israelToday()) return NextResponse.json({ error: 'future week' }, { status: 400, headers: PRIVATE });

  try {
    return NextResponse.json({ compare: await loadWeekCompare(createServerClient(), athleteId, weekStart) }, { headers: PRIVATE });
  } catch (err) {
    console.error('week-story compare failed:', err);
    return NextResponse.json({ error: 'Failed to read the week' }, { status: 500, headers: PRIVATE });
  }
}

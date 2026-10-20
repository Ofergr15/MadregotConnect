import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { hasRole } from '@/lib/auth/roles';
import { israelToday } from '@/lib/utils';
import { loadAnnualStory } from '@/lib/birthday-year/server';
import { defaultAccessDeps, storyAccess } from '@/lib/stories/access';
import { annualPeriod } from '@/lib/stories/schedule';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stories/annual — the caller's own annual story ("השנה שלך"), Dec 31 at its
 * time until Jan 31, through the stories gate + their overrides. 404 `{allowed:false}`
 * otherwise. Content reuses the birthday generator over the calendar year; the annual's
 * own slides are phase 3.
 */
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ allowed: false }, { status: 404 });
  const db = createServerClient();
  const isAdmin = caller.isSuperUser || hasRole(caller, 'admin');
  const now = new Date();
  const today = israelToday(now);
  const period = annualPeriod(today);
  const access = await storyAccess('annual', { viewerId: caller.athleteId, ownerId: caller.athleteId, isAdmin, period, now }, defaultAccessDeps(db));
  if (!access.allowed) return NextResponse.json({ allowed: false }, { status: 404 });
  const year = Number((period || `${Number(today.slice(0, 4)) - 1}-12-31`).slice(0, 4));
  const story = await loadAnnualStory(db, caller.athleteId, year, today).catch(() => null);
  const min = access.settings?.min_runs ?? 10;
  if (!story || (!access.preview && story.stats.runs < min && access.instance?.enabled !== true)) {
    return NextResponse.json({ allowed: false }, { status: 404 });
  }
  return NextResponse.json({ allowed: true, preview: access.preview, tester: access.tester, viewingAs: !!caller.viewingAsBy, period, story });
}

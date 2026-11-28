import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { computeRoster } from '@/lib/coach/roster-server';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/coach/roster?week=<plan Sunday>
//
// One call for the coach's סקירה and רצים: per runner the Sunday plan strip,
// targets, Monday-week km, the attention flags (lib/coach/attention.ts) and the
// club totals. Staff-only (requireStaff, from the verified session). The payload
// is the whole club and the same for every staff member, so it is cached for two
// minutes per week, like /api/coach/pulse.
const cached = unstable_cache(
  (week: string) => computeRoster(createServerClient(), { week: week || null }),
  ['coach-roster-v1'],
  { revalidate: 120 },
);

async function roster(week: string) {
  try {
    return await cached(week);
  } catch (err) {
    if (err instanceof Error && /incrementalCache missing/.test(err.message)) {
      return computeRoster(createServerClient(), { week: week || null });
    }
    throw err;
  }
}

export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const week = new URL(request.url).searchParams.get('week') || '';
    if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
      return NextResponse.json({ error: 'week must be YYYY-MM-DD' }, { status: 400 });
    }
    return NextResponse.json(await roster(week));
  } catch (error: any) {
    console.error('[coach/roster] failed:', error);
    return NextResponse.json(internalErrorBody('Failed to load roster'), { status: 500 });
  }
}

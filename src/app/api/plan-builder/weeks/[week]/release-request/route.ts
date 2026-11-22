import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requestRelease } from '@/lib/plan-builder/server';
import { badWeek, fail, staff } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';

/** POST → pings the current editor ("ask them to finish"). { sent } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { denied, me, caller } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try { return NextResponse.json({ sent: await requestRelease(createServerClient(), week, me, caller.email.split('@')[0]) }); }
  catch (e) { return fail(e, 'release request failed'); }
}

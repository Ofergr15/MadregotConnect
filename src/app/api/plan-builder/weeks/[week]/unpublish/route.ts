import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { unpublish } from '@/lib/plan-builder/server';
import { badWeek, fail, staff } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';

/** POST → { ok }. Same staff gate as publish. Workouts already on watches stay there. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { denied } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try { return NextResponse.json({ ok: await unpublish(createServerClient(), week) }); }
  catch (e) { return fail(e, 'unpublish failed'); }
}

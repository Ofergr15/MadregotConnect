import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { copyLastWeek } from '@/lib/plan-builder/server';
import { badWeek, fail, gate } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';

/** POST → { draft } copied from last week's published plan (paces per COPY_LAST_WEEK_PACE_SHIFT_SEC). 404 if none. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { denied, me, who } = await gate(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const draft = await copyLastWeek(createServerClient(), week, me, who);
    if (!draft) return NextResponse.json({ error: 'no published plan last week' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (e) { return fail(e, 'copy last week failed'); }
}

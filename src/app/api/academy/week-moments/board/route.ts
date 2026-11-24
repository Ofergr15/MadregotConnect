import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { planWeekStartOf } from '@/lib/utils';
import { managerBoard, MomentsNotMigrated } from '@/lib/academy/week-moments-server';

export const dynamic = 'force-dynamic';

/** GET ?weekStart → on time per coach × moment: { coaches[{ id, name, cells[4] }], onTime, total }.
 *  WHO: the academy manager. Carries coach names, states and counts — never a message's text or a trainee. */
export async function GET(request: Request) {
  const { denied } = await requireAcademyManager(request);
  if (denied) return denied;
  try {
    const weekStart = planWeekStartOf(new URL(request.url).searchParams.get('weekStart'));
    return NextResponse.json(await managerBoard(createServerClient(), weekStart, new Date().toISOString()));
  } catch (e) {
    if (e instanceof MomentsNotMigrated) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    console.error('GET /api/academy/week-moments/board', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

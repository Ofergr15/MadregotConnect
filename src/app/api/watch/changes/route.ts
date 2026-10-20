import { NextResponse } from 'next/server';
import { requireContentStaff } from '@/lib/auth/require-content-staff';
import { dayWatchChanges, planWatchChanges } from '@/lib/watch/changes';

export const dynamic = 'force-dynamic';

// GET ?planId= | ?date=YYYY-MM-DD -> { days: [{ key, dayOfWeek, date, stale }], staleAthletes }
//   What on the watches is now the previous version, and whose (lib/watch/changes.ts).
export async function GET(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  try {
    const planId = q.get('planId');
    const date = q.get('date');
    if (planId) return NextResponse.json(await planWatchChanges(planId));
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json(await dayWatchChanges(date));
    return NextResponse.json({ error: 'planId or date required' }, { status: 400 });
  } catch (err) {
    console.error('[watch/changes] failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

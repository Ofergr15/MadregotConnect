import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { saveDraft, weekState, readLock } from '@/lib/plan-builder/server';
import { lockView } from '@/lib/plan-builder/lock';
import { badWeek, fail, staff } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ week: string }> };

/** GET → { week, published, draft, diff:{changes,groups,message}, lock, push, lastWeek } */
export async function GET(req: NextRequest, { params }: P) {
  const { denied, me } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try { return NextResponse.json(await weekState(createServerClient(), week, me)); }
  catch (e) { return fail(e, 'week read failed'); }
}

/** PUT { body: { workouts } } → saves the draft (new version after a publish). 409 if locked by someone else. */
export async function PUT(req: NextRequest, { params }: P) {
  const { denied, me } = await staff(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const { body } = await req.json();
    if (!Array.isArray(body?.workouts)) return NextResponse.json({ error: 'body.workouts required' }, { status: 400 });
    const db = createServerClient();
    const lock = lockView(await readLock(db, week), me);
    if (lock.state === 'other') return NextResponse.json({ error: 'locked', lock }, { status: 409 });
    const draft = await saveDraft(db, week, body, me);
    return NextResponse.json({ draft });
  } catch (e) { return fail(e, 'draft save failed'); }
}

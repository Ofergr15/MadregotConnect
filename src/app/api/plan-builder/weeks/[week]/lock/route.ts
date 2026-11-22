import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { releaseLock, takeLock } from '@/lib/plan-builder/server';
import { badWeek, fail, gate } from '@/lib/plan-builder/route-helpers';

export const dynamic = 'force-dynamic';
type P = { params: Promise<{ week: string }> };

/** POST → take or heartbeat (every ~30 s). 409 { lock } when someone else holds it. */
export async function POST(req: NextRequest, { params }: P) {
  const { denied, me, caller, who } = await gate(req);
  if (denied) return denied;
  const { week } = await params;
  const bad = badWeek(week);
  if (bad) return bad;
  try {
    const r = await takeLock(createServerClient(), week, me, (caller as any).name ?? caller.email.split('@')[0], who);
    return NextResponse.json({ lock: r.lock }, { status: r.ok ? 200 : 409 });
  } catch (e) { return fail(e, 'lock failed'); }
}

export async function DELETE(req: NextRequest, { params }: P) {
  const { denied, me, who } = await gate(req);
  if (denied) return denied;
  const { week } = await params;
  try { await releaseLock(createServerClient(), week, me, who); return NextResponse.json({ ok: true }); }
  catch (e) { return fail(e, 'unlock failed'); }
}

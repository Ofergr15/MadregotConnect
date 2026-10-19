import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';
import { sessionPhotosStatus, setSessionPhotosAuto } from '@/lib/quality-session/photos-server';

export const dynamic = 'force-dynamic';

// GET -> { status } The staff card at the top of the feed on a quality day (mockup
//   session-photos-control): the folder, the last check, what was found. Null when there
//   is no folder for today (or yesterday, until 15:00), or before 07:00.
// PATCH { date, auto } -> { ok } The day's "לפרסם לבד".
export async function GET(request: Request) {
  const { denied } = await requireApprover(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ status: await sessionPhotosStatus(createServerClient()) });
  } catch (err) {
    console.error('[session-photos/status] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { denied } = await requireApprover(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as { date?: string; auto?: boolean } | null;
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return NextResponse.json({ error: 'date required' }, { status: 400 });
  await setSessionPhotosAuto(createServerClient(), b.date, b.auto === true);
  return NextResponse.json({ ok: true });
}

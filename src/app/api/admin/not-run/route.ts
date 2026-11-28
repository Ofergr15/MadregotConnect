import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { readGroupFilter } from '@/lib/admin/not-run';
import { loadNotRun } from '@/lib/admin/not-run-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/not-run?group=<packId|none> — "מי עוד לא רץ": active members with no run this
 * activity week (Monday, the watch's week), per pack, with each one's last run day. Staff only.
 * Names only — no email, phone or km. Messaging them is POST /api/admin/not-run/message (dry run).
 */
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const filter = readGroupFilter(new URL(request.url).searchParams.get('group'));
  if (!filter) return NextResponse.json({ error: 'group must be a pack id, "none" or omitted' }, { status: 400 });
  try {
    return NextResponse.json(await loadNotRun(createServerClient(), filter));
  } catch (err) {
    console.error('[api/admin/not-run]', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

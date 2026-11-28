import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requirePackLeader } from '@/lib/auth/self-or-staff';
import { attendanceHistory, packMembers } from '@/lib/packs/server';
import { forLeader } from '@/lib/packs/leader-safe';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/** GET /api/packs/:id/attendance/history?last=8 — present/total for the last N marked sessions. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { denied } = await requirePackLeader(request, id);
    if (denied) return denied;
    const last = Math.min(52, Math.max(1, Number(new URL(request.url).searchParams.get('last')) || 8));
    const db = createServerClient();
    const members = await packMembers(db, id);
    return NextResponse.json(forLeader({ sessions: await attendanceHistory(db, id, last, members.length) }));
  } catch (err: any) {
    console.error('GET /api/packs/[id]/attendance/history error:', err);
    return NextResponse.json(internalErrorBody('failed'), { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { getClubRecords } from '@/lib/prs/club-records-store';

export const dynamic = 'force-dynamic';
// The cold path is the full-history walk in computeClubRecordsSnapshot — thirty
// paged reads plus a laps read. Every other request is a single row out of
// app_settings, so this ceiling is for the once-in-six-hours case.
export const maxDuration = 60;

// GET /api/club/records[?refresh=1]
// The club's records, one ranked table per distance bucket (a798197f, f6c7b8dc).
//
// ── WHY THIS WIDENS NOTHING ────────────────────────────────────────────────
// Gated `requireMember`, the SAME gate as /api/athletes/[id]/stats, which every
// member already uses to read any teammate's PRs from their profile. So this is
// not new exposure: it is the data the app already shows one athlete at a time,
// arranged as the table two reports asked for. It is still gated rather than
// public — it is the whole active roster by name with their race times, which is
// club-internal, and nothing here should be readable by anyone who knows the URL.
//
// Nothing on it is athlete-specific, so there is no per-caller filtering and no
// `athleteId` parameter: every member sees the same table, which is the point of
// a club record.
export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const { snapshot, recomputed } = await getClubRecords(supabase, { refresh });

    return NextResponse.json({ ...snapshot, recomputed });
  } catch (err: any) {
    console.error('Club records error:', err);
    return NextResponse.json({ error: err.message || 'Failed to compute club records' }, { status: 500 });
  }
}

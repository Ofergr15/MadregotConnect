import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { CRON_RUNS_TABLE, summarizeRuns, type CronRunRow } from '@/lib/cron/runs';
import { internalErrorBody } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/admin/cron-runs[?name=badges&limit=50] → { summary: [{ name, last, open, failedRecently }], runs }
 * Staff only (task 93). Newest first. 503 until migration 251 is applied.
 */
export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  try {
    const sp = new URL(request.url).searchParams;
    const name = sp.get('name');
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50));
    let q = createServerClient().from(CRON_RUNS_TABLE)
      .select('name, started_at, finished_at, ok, http_status, counts, error')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (name) q = q.eq('name', name);
    const { data, error } = await q;
    if (error && isMissingTable(error)) return NextResponse.json({ error: 'cron_runs not migrated yet (251)', migrated: false }, { status: 503, headers: NO_STORE });
    if (error) throw error;
    const runs = (data ?? []) as CronRunRow[];
    return NextResponse.json({ summary: summarizeRuns(runs), runs }, { headers: NO_STORE });
  } catch (err) {
    console.error('GET /api/admin/cron-runs failed:', err);
    return NextResponse.json(internalErrorBody(), { status: 500, headers: NO_STORE });
  }
}

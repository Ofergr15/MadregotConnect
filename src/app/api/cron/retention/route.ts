import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { cronPaused } from '@/lib/cron-pause';
import { runRetention, retentionModeFromEnv, type RetentionDb } from '@/lib/retention/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET|POST /api/cron/retention — daily data-retention pass (task 168, docs/data-retention.md).
// DRY RUN unless the env var RETENTION_PURGE is exactly "on": it counts what each rule would
// delete and logs one line, deleting nothing. Gated by CRON_SECRET, fail-closed like race-live.
async function run(request: NextRequest) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const report = await runRetention(createServerClient() as unknown as RetentionDb, { mode: retentionModeFromEnv(process.env) });
  console.log(`[retention] ${report.mode}: ${report.rules.map((r) => `${r.id}=${r.rows ?? `err(${r.error})`}`).join(' ')}`);
  return NextResponse.json(report);
}
export const POST = run;
export const GET = run;

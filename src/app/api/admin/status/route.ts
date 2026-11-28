import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { collectStatus, type StatusDb } from '@/lib/status/collect';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/status — staff-only status page data (task 165): last sync per provider,
 * cron runs, error counts and queue depth. Counts and timestamps only (lib/status/collect.ts).
 * The public, ages-only probe for an uptime checker stays GET /api/health.
 */
export async function GET(request: Request) {
  const denied = await requireStaff(request);
  if (denied) return denied;
  const report = await collectStatus(createServerClient() as unknown as StatusDb);
  return NextResponse.json(report, { headers: { 'Cache-Control': 'private, no-store' } });
}

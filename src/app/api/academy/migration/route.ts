import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { migrationSummary } from '@/lib/academy/migration';
import { loadMigrationBoard } from '@/lib/academy/migration-server';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/migration — the move-in board: every trainee whose funnel card says
 * 'existing' (moved in or invited through the migration path), where each one is, and the
 * counts. Manager only. The invite link is returned for those who have not opened it, so the
 * board can send it again on WhatsApp.
 */
export async function GET(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const today = israelToday();
    const rows = await loadMigrationBoard(createServerClient(), today);
    return NextResponse.json({ rows, summary: migrationSummary(rows), today });
  } catch (err) {
    console.error('GET /api/academy/migration error:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

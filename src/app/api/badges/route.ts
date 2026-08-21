import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/badges — the full badge catalog (seeded + admin-created), newest first.
 *
 * No auth required — same "public read" convention as /api/events: the badges
 * table only holds catalog metadata (name/description/icon/rule), never anything
 * athlete-specific, and both the admin Badge Manager and the athlete-facing
 * badges display need to read it. Reads via the service-role client since
 * `badges` RLS (migration 059) only grants the service role, not anon/authed.
 */
export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('badges')
      .select('id, code, name_he, name_en, description_he, description_en, icon, icon_url, rule_type, rule_params, created_by, active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ badges: data || [] });
  } catch (error) {
    console.error('Failed to fetch badges:', error);
    return NextResponse.json({ error: 'Failed to fetch badges' }, { status: 500 });
  }
}

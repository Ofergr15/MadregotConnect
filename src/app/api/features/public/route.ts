import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { PUBLIC_FEATURE_KEYS, resolveClubScope } from '@/lib/features/flags';
import { enablementRows } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

// GET /api/features/public → { features: { academy_register: boolean } }
// Unauthenticated, for the native app's SIGNED-OUT screens (the academy form lives on the
// gateway, before any account exists). Discloses only the CLUB-WIDE switch of the keys in
// PUBLIC_FEATURE_KEYS — never a per-athlete, squad or role row, and nothing about who set it.
// Fails closed: no table / any error = off.
export async function GET() {
  const db = createServerClient();
  const features: Record<string, boolean> = {};
  for (const f of PUBLIC_FEATURE_KEYS) {
    const rows = await enablementRows(f, db);
    features[f] = rows ? resolveClubScope(f, rows) : false;
  }
  return NextResponse.json({ features }, { headers: { 'Cache-Control': 'no-store' } });
}

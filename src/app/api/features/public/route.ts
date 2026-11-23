import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { PUBLIC_FEATURE_KEYS, resolveClubScope } from '@/lib/features/flags';
import { enablementRowsFor } from '@/lib/features/server';

export const dynamic = 'force-dynamic';

/**
 * The answer is the same for every caller (club-wide switches only), so the CDN may share it:
 * a flag flip reaches signed-out screens within a minute, and a stale copy is served while
 * the next one is fetched. Nothing per-person is in it, so caching changes no exposure.
 */
const PUBLIC_FEATURES_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

// GET /api/features/public → { features: { academy_register: boolean, … } }
// Unauthenticated, for the native app's SIGNED-OUT screens (the academy form lives on the
// gateway, before any account exists). Discloses only the CLUB-WIDE switch of the keys in
// PUBLIC_FEATURE_KEYS — never a per-athlete, squad or role row, and nothing about who set it.
// Fails closed: no table / any error = off. One query for all keys (was one per key, serial).
export async function GET() {
  const t0 = performance.now();
  const rows = await enablementRowsFor(PUBLIC_FEATURE_KEYS, createServerClient());
  const dbMs = performance.now() - t0;
  const features: Record<string, boolean> = {};
  for (const f of PUBLIC_FEATURE_KEYS) features[f] = rows ? resolveClubScope(f, rows) : false;
  return NextResponse.json({ features }, {
    headers: {
      'Cache-Control': PUBLIC_FEATURES_CACHE,
      'Server-Timing': `db;dur=${dbMs.toFixed(1)}, total;dur=${(performance.now() - t0).toFixed(1)}`,
    },
  });
}

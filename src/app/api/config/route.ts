import { NextResponse } from 'next/server';
import { buildPublicConfig } from '@/lib/public-config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/config — the PUBLIC Supabase coordinates of this deployment, for the native app
 * (b24, REMOTE_SUPABASE_CONFIG). A database move (supabase/ops/eu-move/RUNBOOK.md) then
 * needs a Vercel env change only, never an app build.
 *
 * Only NEXT_PUBLIC_* values: the same URL and anon key already ship in the web bundle.
 * The service-role key is never read, and buildPublicConfig() (lib/public-config.ts) refuses to emit any
 * key whose JWT role is not `anon` or that is an `sb_secret_` key — so a mis-set env
 * (service key pasted into the anon slot) produces a 503, not a leak.
 * Pinned by src/__tests__/configRoute.test.ts.
 */
const HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' };

export function GET() {
  const config = buildPublicConfig(process.env);
  if (!config) {
    return NextResponse.json({ error: 'config unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(config, { headers: HEADERS });
}

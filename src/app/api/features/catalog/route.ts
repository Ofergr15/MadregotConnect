import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { FEATURE_KEYS } from '@/lib/features/flags';
import { readEnablementRows } from '@/lib/features/server';
import { buildCatalog } from '@/lib/features/catalog';

export const dynamic = 'force-dynamic';

// GET /api/features/catalog → { features: CatalogEntry[], migrationPending, failed }
// Every flag in FEATURES with its Hebrew label, one-line description and enabled
// scopes, for the native rollout screen. Staff only: role/squad rows say who is in a
// rollout. Athlete rows are counts, never ids (see lib/features/catalog.ts).
export async function GET(request: Request) {
  const { denied } = await requireStaffCaller(request);
  if (denied) return denied;
  const { rows, failed } = await readEnablementRows(FEATURE_KEYS, createServerClient());
  return NextResponse.json(
    { features: buildCatalog(rows), migrationPending: rows === null, failed },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

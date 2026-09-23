import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { activeApproval, markShipped } from '@/lib/release-server';

export const dynamic = 'force-dynamic';

// GET, no auth: the commit the owner approved for the next release, or null.
// Read by .github/workflows/daily-release.yml at 05:00 — the workflow has no
// secrets, and a commit hash of a public repo is not one either.
export async function GET() {
  const supabase = createServerClient();
  await markShipped(supabase);
  const approval = await activeApproval(supabase);
  return NextResponse.json({ sha: approval?.sha ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}

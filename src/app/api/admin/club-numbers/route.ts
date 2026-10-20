import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { loadClubNumbers } from '@/lib/club-numbers/server';
import { cachedNumbers, clubManagers, isClubAdmin, keepNumbers, mayViewNumbers } from '@/lib/club-numbers/access';

export const dynamic = 'force-dynamic';

// GET /api/admin/club-numbers — "מדרגות במספרים" (lib/club-numbers), for the admin and the
// "מנהלי מדרגות" (lib/club-numbers/access). `?fresh=1` skips the cache.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  if (!(await mayViewNumbers(supabase, caller))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const admin = isClubAdmin(caller);
  const access = { admin, managers: admin ? await clubManagers(supabase) : [] };
  const hit = new URL(request.url).searchParams.get('fresh') === '1' ? null : cachedNumbers();
  if (hit) return NextResponse.json({ ...(hit as object), access });
  try {
    const body = await loadClubNumbers(supabase);
    keepNumbers(body);
    return NextResponse.json({ ...body, access });
  } catch (error) {
    console.error('[club-numbers] load failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

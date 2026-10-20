import { after, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { loadClubNumbers } from '@/lib/club-numbers/server';
import { FRESH_MS, clubManagers, isClubAdmin, mayViewNumbers, readSnapshot, writeSnapshot } from '@/lib/club-numbers/access';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/admin/club-numbers — "מדרגות במספרים" (lib/club-numbers), for the admin and the
// "מנהלי מדרגות". Answers from the kept snapshot at once; a stale one is refreshed after the
// reply (lib/club-numbers/access). `?fresh=1` recomputes before answering.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const supabase = createServerClient();
  const [allowed, snap] = await Promise.all([mayViewNumbers(supabase, caller), readSnapshot(supabase)]);
  if (!allowed) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const admin = isClubAdmin(caller);
  const access = { admin, managers: admin ? await clubManagers(supabase) : [] };
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  try {
    if (snap && !fresh) {
      if (Date.now() - snap.at > FRESH_MS) after(async () => { try { await writeSnapshot(supabase, await loadClubNumbers(supabase)); } catch (e) { console.error('[club-numbers] refresh failed:', e); } });
      return NextResponse.json({ ...(snap.body as object), access, asOf: new Date(snap.at).toISOString() });
    }
    const body = await loadClubNumbers(supabase);
    await writeSnapshot(supabase, body);
    return NextResponse.json({ ...body, access, asOf: new Date().toISOString() });
  } catch (error) {
    console.error('[club-numbers] load failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

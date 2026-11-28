import { after, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { loadClubMonthly, loadClubNumbers } from '@/lib/club-numbers/server';
import { parseWindow } from '@/lib/club-numbers/monthly';
import { isFeatureEnabled } from '@/lib/features/server';
import { FRESH_MS, clubManagers, isClubAdmin, mayViewNumbers, readSnapshot, snapshotKey, writeSnapshot } from '@/lib/club-numbers/access';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/admin/club-numbers — "מדרגות במספרים" (lib/club-numbers), for the admin and the
// "מנהלי מדרגות". Answers from the kept snapshot at once; a stale one is refreshed after the
// reply (lib/club-numbers/access). `?fresh=1` recomputes before answering.
// `?window=3m|12m|ytd|all` answers the monthly series instead (lib/club-numbers/monthly), same
// gate, its own snapshot per window.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const rawWindow = params.get('window');
  const window = parseWindow(rawWindow);
  if (rawWindow != null && !window) return NextResponse.json({ error: 'window must be one of 3m, 12m, ytd, all' }, { status: 400 });
  const supabase = createServerClient();
  // Task 81: the weekly figures follow the activity week (Mon–Sun) when the flag is on for the
  // caller (set it at club scope so every manager sees the same anchor). It is
  // read per caller; its own snapshot key, so flipping the flag never serves the other anchor's numbers.
  const monday = !window && (await isFeatureEnabled('club_numbers_activity_week', caller.athleteId).catch(() => false));
  const key = monday ? `${snapshotKey(window)}:monday` : snapshotKey(window);
  const load = (s: ReturnType<typeof createServerClient>) => (window ? loadClubMonthly(s, window) : loadClubNumbers(s, undefined, monday ? 'monday' : 'sunday'));
  const [allowed, snap] = await Promise.all([mayViewNumbers(supabase, caller), readSnapshot(supabase, key)]);
  if (!allowed) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const admin = isClubAdmin(caller);
  const access = { admin, managers: admin ? await clubManagers(supabase) : [] };
  const fresh = params.get('fresh') === '1';
  try {
    if (snap && !fresh) {
      if (Date.now() - snap.at > FRESH_MS) after(async () => { try { await writeSnapshot(supabase, await load(supabase), key); } catch (e) { console.error('[club-numbers] refresh failed:', e); } });
      return NextResponse.json({ ...(snap.body as object), access, asOf: new Date(snap.at).toISOString() });
    }
    const body = await load(supabase);
    await writeSnapshot(supabase, body, key);
    return NextResponse.json({ ...body, access, asOf: new Date().toISOString() });
  } catch (error) {
    console.error('[club-numbers] load failed:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

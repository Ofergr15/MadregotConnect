import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { CORE_KEY, parseCore } from '@/lib/club-numbers/server';
import { dropNumbers, isClubAdmin } from '@/lib/club-numbers/access';

export const dynamic = 'force-dynamic';

// PUT /api/admin/club-numbers/core { add: id[], remove: id[] } — the hand-picked changes to
// the core runners, on top of the rule (3+ runs in each of the last 8 weeks).
export async function PUT(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!isClubAdmin(caller)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const body = parseCore(await request.json().catch(() => null));
  const value = { add: [...new Set(body.add)].slice(0, 200), remove: [...new Set(body.remove)].slice(0, 200) };
  const { error } = await createServerClient().from('app_settings')
    .upsert({ key: CORE_KEY, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  dropNumbers();
  return NextResponse.json({ ok: true, ...value });
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { isClubAdmin, setClubManagers } from '@/lib/club-numbers/access';

export const dynamic = 'force-dynamic';

// PUT /api/admin/club-numbers/managers { ids } — who the admin made "מנהלי מדרגות". Admin only.
export async function PUT(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!isClubAdmin(caller)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)) : null;
  if (!ids) return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  try {
    await setClubManagers(createServerClient(), ids);
    return NextResponse.json({ ok: true, ids });
  } catch {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

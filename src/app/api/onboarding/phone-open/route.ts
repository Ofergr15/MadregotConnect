import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';

export const dynamic = 'force-dynamic';

// POST /api/onboarding/phone-open — "the app just ran on a phone" (PhoneOpenBeacon).
// Stamps athletes.phone_app_opened_at once (migration 136); a missing column is a
// no-op, never an error the phone would see.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.athleteId) return NextResponse.json({ ok: true });
  const { error } = await createServerClient().from('athletes')
    .update({ phone_app_opened_at: new Date().toISOString() })
    .eq('id', auth.user.athleteId)
    .is('phone_app_opened_at', null);
  return NextResponse.json({ ok: true, recorded: !error });
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { deviceFromUa, recordOnbEvent } from '@/lib/onboarding/events';

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
  await recordOnbEvent({ step: 'phone_app_opened', athleteId: auth.user.athleteId, device: deviceFromUa(request.headers.get('user-agent')) });
  return NextResponse.json({ ok: true, recorded: !error });
}

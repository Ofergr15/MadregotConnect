import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { painRecipientNames } from '@/lib/feedback/pain-server';

export const dynamic = 'force-dynamic';

// GET /api/pain-reports/recipients → { names } — who will see the caller's report,
// from the same resolver the alert uses, so the privacy line is never wrong.
export async function GET(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId) return NextResponse.json({ names: [] });
  try {
    return NextResponse.json({ names: await painRecipientNames(createServerClient(), caller.athleteId) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed' }, { status: 500 });
  }
}

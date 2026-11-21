import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { applySetupWrite, type SetupProgress } from '@/lib/onboarding/native-setup';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/setup — the caller's OWN first-run checklist (BUILD-BRIEF gap 5).
 *   { step: 'watch'|'notifications'|'group'|'photo', value }  or  { dismiss: true }
 *   → { ok, progress }
 *
 * Self only, from the verified JWT: there is no athlete id in the body to point at
 * someone else. Read back through GET /api/auth/me → `setup`.
 * Pre-189 (no setup_progress column) → 503 not-ready; the app keeps it on the device.
 */
export async function POST(request: Request) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.athleteId || caller.viewingAsBy) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('athletes').select('setup_progress').eq('id', caller.athleteId).maybeSingle();
    if (error) {
      if (error.code === '42703' || error.code === 'PGRST204') return NextResponse.json({ error: 'not-ready' }, { status: 503 });
      throw error;
    }
    const next = applySetupWrite((data?.setup_progress as SetupProgress | null) ?? {}, body);
    if (!next) return NextResponse.json({ error: 'bad-step' }, { status: 400 });
    const { error: writeError } = await supabase.from('athletes').update({ setup_progress: next }).eq('id', caller.athleteId);
    if (writeError) throw writeError;
    return NextResponse.json({ ok: true, progress: next });
  } catch (err) {
    console.error('[onboarding/setup] failed:', err);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

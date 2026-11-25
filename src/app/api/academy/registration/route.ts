import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireAcademyManager } from '@/lib/academy/pairing-server';
import { isRegistrationOpen, mayRegister, REGISTRATION_KEY } from '@/lib/academy/registration';

export const dynamic = 'force-dynamic';

/**
 * GET /api/academy/registration?invite=<token> — public, no auth: is the form
 * open to this visitor. `open` is the switch; `canRegister` adds the holder of a
 * funnel invitation, who gets through while it is closed (lib/academy/registration.ts).
 */
export async function GET(request: Request) {
  const supabase = createServerClient();
  const invite = new URL(request.url).searchParams.get('invite');
  const [open, canRegister] = await Promise.all([isRegistrationOpen(supabase), mayRegister(supabase, invite)]);
  return NextResponse.json({ open, canRegister }, { headers: { 'Cache-Control': 'no-store' } });
}

/** PUT { open: boolean } — the academy manager opens or closes the public doors. */
export async function PUT(request: Request) {
  try {
    const { denied } = await requireAcademyManager(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (typeof body?.open !== 'boolean') {
      return NextResponse.json({ error: 'open (boolean) is required' }, { status: 400 });
    }
    const supabase = createServerClient();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: REGISTRATION_KEY, value: body.open ? 'open' : 'closed', updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return NextResponse.json({ open: body.open });
  } catch (error) {
    console.error('Academy registration PUT error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function isOn(): Promise<boolean> {
  const supabase = createServerClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
  return data?.value === 'on';
}

// GET /api/maintenance?email=…  → { maintenance, allowed }
// maintenance = is the gate on; allowed = may THIS viewer bypass it.
export async function GET(request: Request) {
  try {
    const email = new URL(request.url).searchParams.get('email');
    const maintenance = await isOn();
    // Allowlist = the approver accounts (yairgb / grosfeldofer / madregot.club).
    const allowed = canApprove(email);
    return NextResponse.json({ maintenance, allowed });
  } catch {
    // Fail OPEN — never lock everyone out on an error.
    return NextResponse.json({ maintenance: false, allowed: true });
  }
}

// PUT /api/maintenance  { on: boolean, actorEmail }  → toggle (approver only)
export async function PUT(request: Request) {
  try {
    const { on, actorEmail } = await request.json();
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const supabase = createServerClient();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'maintenance_mode', value: on ? 'on' : 'off', updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return NextResponse.json({ maintenance: !!on });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

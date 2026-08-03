import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { canApprove } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const DEFAULT = { teamDays: [2, 5], dayBefore: { enabled: true, hour: 8 }, eveningBefore: { enabled: true, hour: 18 } };

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
    let cfg = DEFAULT;
    try { cfg = { ...DEFAULT, ...JSON.parse(data?.value || '') }; } catch { /* default */ }
    return NextResponse.json({ config: cfg });
  } catch {
    return NextResponse.json({ config: DEFAULT });
  }
}

export async function PUT(request: Request) {
  try {
    const { config, actorEmail } = await request.json();
    if (!canApprove(actorEmail)) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const supabase = createServerClient();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'reminder_config', value: JSON.stringify(config), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return NextResponse.json({ config });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

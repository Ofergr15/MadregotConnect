import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireApprover } from '@/lib/auth/require-approver';

export const dynamic = 'force-dynamic';

// workoutHour = the team workout's start time (Israel), admin-editable. Drives
// the pre-workout RSVP cutoff (RSVP hides once the workout has passed).
const DEFAULT = { teamDays: [2, 5], dayBefore: { enabled: true, hour: 8 }, eveningBefore: { enabled: true, hour: 18 }, workoutHour: 18 };

// Memoised for the same reason as the tab matrix: one `app_settings` row, edited
// by an admin a few times a year, and read on every dashboard load by four
// separate components (the dashboard itself, AttendanceConfirmCard, the control
// room, ProfileOverview) — measured at a flat ~310 ms per call, all of it
// Supabase round trip. Cleared by this file's own PUT, which is the only writer,
// so the admin editing the reminder times sees their change immediately.
// Module-private rather than an exported helper: Next rejects exports from a
// route file that aren't methods or known config fields.
const MEMO_TTL_MS = 30_000;
let memo: { config: typeof DEFAULT; expires: number } | null = null;

export async function GET() {
  try {
    if (memo && memo.expires > Date.now()) {
      return NextResponse.json({ config: memo.config });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'reminder_config').maybeSingle();
    let cfg = DEFAULT;
    try { cfg = { ...DEFAULT, ...JSON.parse(data?.value || '') }; } catch { /* default */ }
    // A read that failed and a club that never set a config both land on DEFAULT
    // here, and only the second one is an answer. Memoising the first would keep
    // serving the fallback times for 30 s after a blip — long enough for an admin
    // to see their own settings appear to have reverted.
    if (!error) memo = { config: cfg, expires: Date.now() + MEMO_TTL_MS };
    return NextResponse.json({ config: cfg });
  } catch {
    return NextResponse.json({ config: DEFAULT });
  }
}

export async function PUT(request: Request) {
  try {
    const { denied } = await requireApprover(request);
    if (denied) return denied;

    const { config } = await request.json();
    const supabase = createServerClient();
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'reminder_config', value: JSON.stringify(config), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;

    memo = null;

    return NextResponse.json({ config });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

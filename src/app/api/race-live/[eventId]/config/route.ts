import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';

export const dynamic = 'force-dynamic';

// Admin-only: this switch decides whether the whole club gets pushed on race morning.
// PUT { source?, feedUrl?, active?, pushEnabled?, pollFrom?, pollTo?, pollEverySec?, replay?: { speed, resetMilestones? } }
export async function PUT(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && caller.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const row: Record<string, unknown> = { event_id: eventId, updated_at: new Date().toISOString() };
  if (b.source) row.source = b.source;
  if ('feedUrl' in b) row.feed_url = b.feedUrl || null;
  if ('active' in b) row.active = !!b.active;
  if ('pushEnabled' in b) row.push_enabled = !!b.pushEnabled;
  if ('pollFrom' in b) row.poll_from = b.pollFrom;
  if ('pollTo' in b) row.poll_to = b.pollTo;
  if ('pollEverySec' in b) row.poll_every_sec = b.pollEverySec;
  if (b.replay) {
    row.source = 'replay';
    row.replay_started_at = new Date().toISOString();
    row.replay_speed = Number(b.replay.speed) || 10;
    row.fail_count = 0;
  }
  const db = createServerClient();
  const { error } = await db.from('race_live_config').upsert(row, { onConflict: 'event_id' });
  if (error) return NextResponse.json({ error: 'save failed', details: error.message }, { status: 500 });
  // Restarting a replay clears its own rehearsal rows (never feed/manual ones).
  if (b.replay) {
    await db.from('race_splits').delete().eq('event_id', eventId).eq('source', 'replay');
    if (b.replay.resetMilestones) await db.from('race_milestones').delete().eq('event_id', eventId);
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && !caller.isStaff) return NextResponse.json({ error: 'Staff only' }, { status: 403 });
  const { data } = await createServerClient().from('race_live_config').select('*').eq('event_id', eventId).maybeSingle();
  return NextResponse.json({ config: data ?? null });
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { resolveVerifiedCaller } from '@/lib/auth/self-or-staff';
import { clockIn, parseSettingsBody, validateRaceSettings, type RaceSettings } from '@/lib/race-live/settings';

export const dynamic = 'force-dynamic';

/**
 * Race settings (task 148) — the gun time and the race window, per event. Admin only (verified JWT).
 *   GET → { startAt, pollFrom, pollTo, local: { israel, spain } }
 *   PUT { startAt?, pollFrom?, pollTo? } — zoned ISO strings; the MERGED result must pass
 *       lib/race-live/settings.ts (pollTo ≥ start + 6:30, pollFrom ≤ start, …) or nothing is written.
 * Only these three columns are written; active / push / source stay on PUT …/config.
 */
const COLS = 'poll_from, poll_to, race_start_at';
const isMissingColumn = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';
const notApplied = () => NextResponse.json({ error: 'migration 320 not applied (race_live_config.race_start_at)' }, { status: 503 });

async function gate(request: NextRequest) {
  const { denied, caller } = await resolveVerifiedCaller(request);
  if (denied) return denied;
  if (!caller.isSuperUser && caller.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  return null;
}

const view = (s: RaceSettings) => ({
  ...s,
  local: {
    israel: { start: clockIn(s.startAt, 'Asia/Jerusalem'), pollFrom: clockIn(s.pollFrom, 'Asia/Jerusalem'), pollTo: clockIn(s.pollTo, 'Asia/Jerusalem') },
    spain: { start: clockIn(s.startAt, 'Europe/Madrid'), pollFrom: clockIn(s.pollFrom, 'Europe/Madrid'), pollTo: clockIn(s.pollTo, 'Europe/Madrid') },
  },
});

const toSettings = (row: { poll_from?: string | null; poll_to?: string | null; race_start_at?: string | null } | null): RaceSettings => ({
  startAt: row?.race_start_at ? new Date(row.race_start_at).toISOString() : null,
  pollFrom: row?.poll_from ? new Date(row.poll_from).toISOString() : null,
  pollTo: row?.poll_to ? new Date(row.poll_to).toISOString() : null,
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const no = await gate(request);
  if (no) return no;
  const { data, error } = await createServerClient().from('race_live_config').select(COLS).eq('event_id', eventId).maybeSingle();
  if (isMissingColumn(error)) return notApplied();
  if (error) return NextResponse.json({ error: 'read failed' }, { status: 500 });
  return NextResponse.json(view(toSettings(data)));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const no = await gate(request);
  if (no) return no;
  const parsed = parseSettingsBody(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });
  if (!Object.keys(parsed.patch).length) return NextResponse.json({ error: 'nothing to set' }, { status: 400 });

  const db = createServerClient();
  const [{ data: event }, { data: cur, error: curErr }] = await Promise.all([
    db.from('events').select('id, date').eq('id', eventId).maybeSingle(),
    db.from('race_live_config').select(COLS).eq('event_id', eventId).maybeSingle(),
  ]);
  if (isMissingColumn(curErr)) return notApplied();
  if (curErr) return NextResponse.json({ error: 'read failed' }, { status: 500 });
  if (!event) return NextResponse.json({ error: 'event not found' }, { status: 404 });

  const merged: RaceSettings = { ...toSettings(cur), ...parsed.patch };
  const invalid = validateRaceSettings(merged, (event as { date?: string | null }).date ?? null);
  if (invalid) return NextResponse.json(invalid, { status: 422 });

  const { error } = await db.from('race_live_config').upsert({
    event_id: eventId, race_start_at: merged.startAt, poll_from: merged.pollFrom, poll_to: merged.pollTo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (isMissingColumn(error)) return notApplied();
  if (error) return NextResponse.json({ error: 'save failed' }, { status: 500 });
  return NextResponse.json({ ok: true, ...view(merged) });
}

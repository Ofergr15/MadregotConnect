import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { isMissingTable } from '@/lib/supabase/schema-drift';
import { planWeekStartOf } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MARKS = 200;

type Mark = { athleteId: string; present: boolean | null; groupLabel?: unknown };
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

/**
 * PUT /api/attendance/presence — staff only (JWT-verified). The coach's own record of
 * who was at a practice, kept apart from the athlete's RSVP (POST /api/attendance).
 * Single `{athleteId, weekStart, day, present, groupLabel?}` or bulk
 * `{weekStart, day, groupLabel?, marks: [{athleteId, present, groupLabel?}]}` (≤200);
 * a mark's own groupLabel wins over the top-level default.
 * `present: null` is an UNMARK: the (athlete, weekStart, day) row is deleted, putting the
 * runner back to "no mark" (the native app's undo). Idempotent — clearing a row that
 * isn't there is still a success. Reply `{ok, saved, cleared}`: rows upserted, and
 * unmarks applied (counted per requested athlete, whether or not a row existed).
 * `marked_by` is always the verified caller — never read from the body.
 */
export async function PUT(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body || typeof body !== 'object') return bad('invalid body');

  const { weekStart, day } = body;
  if (typeof weekStart !== 'string' || !ISO.test(weekStart) || Number.isNaN(Date.parse(weekStart)) || planWeekStartOf(weekStart) !== weekStart) {
    return bad('weekStart must be a Sunday YYYY-MM-DD');
  }
  if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return bad('day must be 0..6');
  const label = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 64));
  const defaultLabel = label(body.groupLabel);

  let marks: Mark[];
  if (Array.isArray(body.marks)) {
    if (!body.marks.length) return bad('marks is empty');
    if (body.marks.length > MAX_MARKS) return bad(`at most ${MAX_MARKS} marks`);
    marks = body.marks as Mark[];
  } else {
    marks = [{ athleteId: body.athleteId as string, present: body.present as boolean, groupLabel: body.groupLabel }];
  }
  for (const m of marks) {
    if (!m || typeof m.athleteId !== 'string' || !UUID.test(m.athleteId)) return bad('athleteId must be a uuid');
    if (typeof m.present !== 'boolean' && m.present !== null) return bad('present must be boolean or null');
  }
  // Last mark wins for a repeated athlete, so one upsert never hits the same row twice.
  const byAthlete = new Map(marks.map((m) => [m.athleteId, m]));
  const markedAt = new Date().toISOString();
  const unmark = [...byAthlete.values()].filter((m) => m.present === null).map((m) => m.athleteId);
  const rows = [...byAthlete.values()].filter((m) => m.present !== null).map((m) => ({
    athlete_id: m.athleteId, week_start: weekStart, day, group_label: label(m.groupLabel) ?? defaultLabel, present: m.present,
    marked_by: caller.athleteId, marked_at: markedAt,
  }));

  try {
    const db = createServerClient();
    const missing = () => NextResponse.json({ error: 'presence table missing — migration 197 not applied' }, { status: 503 });
    if (unmark.length) {
      const { error } = await db.from('practice_presence').delete()
        .eq('week_start', weekStart).eq('day', day).in('athlete_id', unmark);
      if (error) {
        if (isMissingTable(error)) return missing();
        return NextResponse.json({ error: 'Failed to clear presence', details: error.message }, { status: 500 });
      }
    }
    const { error } = rows.length
      ? await db.from('practice_presence').upsert(rows, { onConflict: 'athlete_id,week_start,day' })
      : { error: null };
    if (error) {
      if (isMissingTable(error)) return missing();
      return NextResponse.json({ error: 'Failed to save presence', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, saved: rows.length, cleared: unmark.length });
  } catch (err: any) {
    console.error('attendance/presence failed:', err);
    return NextResponse.json({ error: err?.message || 'Failed to save presence' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { requireStaffCaller } from '@/lib/auth/self-or-staff';
import { readLateInput } from '@/lib/day-session/model';
import { lateRecipients, readDaySession, sendLatePush, setLate } from '@/lib/day-session/server';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * b23 "coach is late" on a day session (migration 213). Staff-only (requireStaff's gate,
 * with the caller so a view-as session cannot post).
 *
 * POST   { date, minutes (5–30), note? } -> { session, late, recipients, notified }
 *        Stores the notice on that date's session — a second POST REPLACES the first —
 *        and pushes `day_session_late` to that day's RSVPs ONLY (attending = true).
 * DELETE ?date=YYYY-MM-DD                -> { session, late: null }  clears it, no push.
 *
 * The notice is read back on GET /api/day-session?date= (`session.late`) and on the
 * week's merged day-session workouts (`daySession.late`).
 */
export async function POST(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });

  const input = readLateInput(await request.json().catch(() => null));
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });
  if (input.date < israelToday()) return NextResponse.json({ error: 'date is in the past' }, { status: 400 });

  try {
    const existing = await readDaySession(input.date);
    if (!existing.setup) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!existing.session) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });

    const late = { minutes: input.minutes, note: input.note, at: new Date().toISOString() };
    const saved = await setLate(input.date, late);
    if (saved === 'not_set_up') return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!saved) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });

    // Best-effort, as the publish push is: the notice is stored whatever the push does.
    let recipients = 0;
    let notified = 0;
    try {
      const ids = await lateRecipients(input.date);
      recipients = ids.length;
      notified = await sendLatePush(saved, late, ids);
    } catch (err) {
      console.error('[day-session/late] push failed:', err);
    }
    return NextResponse.json({ session: saved, late: saved.late, recipients, notified });
  } catch (err) {
    console.error('[day-session/late] POST failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { denied, caller } = await requireStaffCaller(request);
  if (denied) return denied;
  if (caller.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    const saved = await setLate(date, null);
    if (saved === 'not_set_up') return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!saved) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });
    return NextResponse.json({ session: saved, late: null });
  } catch (err) {
    console.error('[day-session/late] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to clear' }, { status: 500 });
  }
}

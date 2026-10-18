import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { israelNow, israelToday, addDaysToDateStr } from '@/lib/utils';
import { isOnFeed, mayEditDaySession, maySeeDaySession, notifyOnce, readInput, resolveWorkout } from '@/lib/day-session/model';
import {
  claimNotify, daySessionRecipients, deleteDaySession, readDaySession, readFromToday, readUpcoming, saveDaySession, sendDaySessionPush,
} from '@/lib/day-session/server';
import { watchHolders } from '@/lib/day-session/watch';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// "אימון ליום אחד" (mockup manual-day-workout, migration 150).
//
// GET ?date=YYYY-MM-DD   -> { setup, session }   the form: that date's row, published or not
// GET                    -> { setup, sessions }  the feed: published, on now (isOnFeed)
// GET ?list=1            -> { setup, sessions, watches }  the coach's list: today on, published
//                           or not, and how many runners each one is on the watch of
// PUT { date, startTime, place, quickText, steps?, title?, description?, nutrition, publish, notify }
//                        -> { session, notified } save the date's row; publish pushes once
// DELETE ?date=YYYY-MM-DD -> { deleted }  the date's row (the watches first, via ./remove)
//
// `steps` are the planner editor's WorkoutStep[] (validateWorkoutSteps): stored as sent, the sentence is NOT re-parsed —
// it stays in quick_text as the coach's own words. Without `steps` the sentence is parsed
// (the form before the editor). `title` empty = the structure's name.
//
// The gate is lib/day-session/model.ts on the VERIFIED session: while DAY_SESSION_FOR_ALL is
// off the super user alone edits and sees; anybody else gets 403 on the form and an empty
// feed answer (the feed must stay quiet, not error). `setup: false` = migration 150 has not
// been pasted, which the form says in words.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  const params = new URL(request.url).searchParams;
  const date = params.get('date');
  try {
    if (params.get('list') === '1') {
      if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const { setup, sessions } = await readFromToday();
      const counts = await Promise.all(sessions.map((s) => watchHolders(s.date).then((h) => h.length).catch(() => 0)));
      return NextResponse.json({ setup, sessions, watches: Object.fromEntries(sessions.map((s, i) => [s.date, counts[i]])) });
    }
    if (date !== null) {
      if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
      return NextResponse.json(await readDaySession(date));
    }
    if (!maySeeDaySession(auth.user)) return NextResponse.json({ setup: true, sessions: [] });
    const { setup, sessions } = await readUpcoming();
    const today = israelToday();
    const { hour, minute } = israelNow();
    return NextResponse.json({
      setup,
      sessions: sessions.filter((s) => isOnFeed(s, today, addDaysToDateStr(today, 1), hour * 60 + minute)),
    });
  } catch (err) {
    console.error('[day-session] GET failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (auth.user.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });

  const input = readInput(await request.json().catch(() => null));
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });
  const { steps, title } = resolveWorkout(input);
  if (!steps.length) return NextResponse.json({ error: 'workout not understood' }, { status: 400 });

  try {
    const existing = await readDaySession(input.date);
    if (!existing.setup) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    const me = auth.user.athleteId;
    const saved = await saveDaySession({
      session_date: input.date,
      start_time: input.startTime,
      place: input.place,
      title,
      quick_text: input.quickText,
      steps,
      description: input.description,
      quality: input.quality,
      // Each step carries its own pace per pack now (lib/day-session/workout.ts).
      pack_paces: [null, null, null],
      nutrition: input.nutrition,
      // Keeps the first publish time across edits; unpublishing clears it.
      published_at: input.publish ? existing.session?.publishedAt ?? new Date().toISOString() : null,
      notify: input.notify,
      updated_by: me,
      ...(existing.session ? {} : { created_by: me }),
    });
    if (!saved) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });

    // Best-effort: the session is saved whatever the push does.
    let notified = false;
    try {
      const r = await notifyOnce(saved, {
        claim: () => claimNotify(saved.id),
        send: async () => sendDaySessionPush(saved, await daySessionRecipients(me), new Date(), { title: input.pushTitle, body: input.pushBody }),
      });
      notified = r.sent;
    } catch (err) {
      console.error('[day-session] push failed:', err);
    }
    return NextResponse.json({ session: saved, notified });
  } catch (err) {
    console.error('[day-session] PUT failed:', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (auth.user.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    // The watches come off first, from the screen (api/day-session/remove): one runner at a
    // time, each removal checked back with Garmin and shown. This only drops the row.
    const deleted = await deleteDaySession(date);
    if (deleted === null) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!deleted) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[day-session] DELETE failed:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

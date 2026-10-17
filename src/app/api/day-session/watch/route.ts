import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { mayEditDaySession } from '@/lib/day-session/model';
import { daySessionRecipients, readDaySession } from '@/lib/day-session/server';
import { sendDaySessionToWatches, whoHasIt } from '@/lib/day-session/watch';

export const dynamic = 'force-dynamic';
// Each watch is a few serial Garmin calls; the club's worth, three at a time.
export const maxDuration = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST { date, athleteIds? } -> { tracked, results: [{ athleteId, athleteName, status, error? }] }
//
// "לשלוח לשעונים" for the date's saved one-day session (lib/day-session/watch.ts). The
// same gate as the form. `athleteIds` are the coach's pick in "מי מקבל" (the planner's
// send sheet, components/day-session/WatchRecipients.tsx) — staff send to watches from
// the planner the same way. Without them, the push's recipients (daySessionRecipients).
// GET ?date=YYYY-MM-DD -> { holders: [{ athleteId, name, at }] }  who has it on the watch
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    return NextResponse.json({ holders: await whoHasIt(date) });
  } catch (err) {
    console.error('[day-session/watch] GET failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (auth.user.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { date?: unknown; athleteIds?: unknown } | null;
  const date = typeof body?.date === 'string' ? body.date : '';
  const picked = Array.isArray(body?.athleteIds)
    ? [...new Set(body.athleteIds.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(0, 300)
    : null;
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    const { setup, session } = await readDaySession(date);
    if (!setup) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!session || !session.steps.length) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });
    if (picked && !picked.length) return NextResponse.json({ error: 'nobody picked' }, { status: 400 });
    const out = await sendDaySessionToWatches(session, picked ?? await daySessionRecipients(auth.user.athleteId));
    return NextResponse.json(out);
  } catch (err) {
    console.error('[day-session/watch] failed:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}

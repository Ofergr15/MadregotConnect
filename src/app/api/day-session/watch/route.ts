import { NextResponse, after } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { mayEditDaySession } from '@/lib/day-session/model';
import { readDaySession } from '@/lib/day-session/server';
import { startDaySessionSend, watchStatus } from '@/lib/day-session/watch';

export const dynamic = 'force-dynamic';
// The delivery runs on after the answer: each watch is a few serial Garmin calls, three at a time.
export const maxDuration = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// "לשלוח לשעונים" for a one-day session (mockup watch-send-v3, lib/day-session/watch.ts).
//
// GET  ?date=YYYY-MM-DD        -> { sentAt, runners, counts, noWatch }  the tracking screen
// POST { date, athleteIds }    -> { queued, skipped }                   start a send
//
// The POST queues every runner it can write to and answers at once; the delivery itself runs
// in the background and the tracking screen polls GET. Staff send to watches from the planner
// the same way, so the gate is the form's.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    return NextResponse.json(await watchStatus(date));
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
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const ids = Array.isArray(body?.athleteIds)
    ? [...new Set(body.athleteIds.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(0, 300)
    : [];
  if (!ids.length) return NextResponse.json({ error: 'nobody picked' }, { status: 400 });
  try {
    const { setup, session } = await readDaySession(date);
    if (!setup) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!session || !session.steps.length) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });
    const { queued, skipped, work } = await startDaySessionSend(session, ids, auth.user.athleteId);
    after(work.catch((err) => console.error('[day-session/watch] delivery failed:', err)));
    return NextResponse.json({ queued, skipped });
  } catch (err) {
    console.error('[day-session/watch] failed:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}

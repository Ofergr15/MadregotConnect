import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { mayEditDaySession } from '@/lib/day-session/model';
import { daySessionRecipients, readDaySession } from '@/lib/day-session/server';
import { sendDaySessionToWatches } from '@/lib/day-session/watch';

export const dynamic = 'force-dynamic';
// Each watch is a few serial Garmin calls; the club's worth, three at a time.
export const maxDuration = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// POST { date } -> { tracked, results: [{ athleteId, athleteName, status, error? }] }
//
// "לשלוח לשעונים" for the date's saved one-day session (lib/day-session/watch.ts). The
// same gate as the form; the recipients are the push's (daySessionRecipients): while
// DAY_SESSION_FOR_ALL is off, the sender's own watch and nobody else's.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (auth.user.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { date?: unknown } | null;
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    const { setup, session } = await readDaySession(date);
    if (!setup) return NextResponse.json({ error: 'not_set_up' }, { status: 503 });
    if (!session || !session.steps.length) return NextResponse.json({ error: 'no session for that date' }, { status: 404 });
    const out = await sendDaySessionToWatches(session, await daySessionRecipients(auth.user.athleteId));
    return NextResponse.json(out);
  } catch (err) {
    console.error('[day-session/watch] failed:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}

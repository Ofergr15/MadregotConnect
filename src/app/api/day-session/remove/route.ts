import { NextResponse } from 'next/server';
import { authError, requireSession } from '@/lib/auth-session';
import { mayEditDaySession } from '@/lib/day-session/model';
import { removeFromOneWatch, watchHolders } from '@/lib/day-session/watch';

export const dynamic = 'force-dynamic';
// One runner per call: a Garmin login, the delete and the check back.
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Taking a one-day session off the watches before it is deleted (lib/day-session/watch.ts).
//
// GET  ?date=YYYY-MM-DD       -> { holders: [{ athleteId, name, apple }] }  who has it now
// POST { date, athleteId }    -> { athleteId, status: 'removed' | 'failed', error? }
//
// The screen walks the holders a few at a time and shows each answer, so the coach sees the
// removal happen and who it did not reach. Same gate as editing the session.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  try {
    const holders = await watchHolders(date);
    return NextResponse.json({ holders: holders.map(({ athleteId, name, apple }) => ({ athleteId, name, apple })) });
  } catch (err) {
    console.error('[day-session/remove] GET failed:', err);
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!mayEditDaySession(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (auth.user.viewingAsBy) return NextResponse.json({ error: 'Not while viewing as somebody' }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { date?: unknown; athleteId?: unknown } | null;
  const date = typeof body?.date === 'string' ? body.date : '';
  const athleteId = typeof body?.athleteId === 'string' ? body.athleteId.slice(0, 64) : '';
  if (!DATE.test(date) || !athleteId) return NextResponse.json({ error: 'date and athleteId are required' }, { status: 400 });
  try {
    return NextResponse.json(await removeFromOneWatch(date, athleteId));
  } catch (err) {
    console.error('[day-session/remove] POST failed:', err);
    return NextResponse.json({ athleteId, status: 'failed', error: 'השרת נכשל, נסו שוב' });
  }
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { authError, requireSession } from '@/lib/auth-session';
import { loadQualitySession, qualityPush } from '@/lib/quality-session/server';
import { parseAt } from '@/lib/quality-session/model';
import { notifyAthlete } from '@/lib/push';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/quality-session?date=YYYY-MM-DD
//   -> { date, label, workout, runs } — is it a quality day (workout null when
//      not), and every run of that day with its pack and its reps.
//
// Super user only, decided on the VERIFIED session, like /api/pack-stories: it
// lists every runner's name and laps for the day, and is still being tried out.
export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const date = new URL(request.url).searchParams.get('date') || '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });

  try {
    return NextResponse.json(await loadQualitySession(createServerClient(), date));
  } catch (err) {
    console.error('[quality-session] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load the session' }, { status: 500 });
  }
}

// POST /api/quality-session { date, at? } -> { ok }
//   The 7:30 push for that date, now, to the CALLER's own devices only, sent
//   with the server's keys so it is the real thing to try the flow from. `at`
//   (?at= time travel) rides along in the link, so the screen opens at that
//   moment. Super user only, as GET.
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return authError(auth);
  if (!auth.user.isSuperUser || !auth.user.athleteId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const date = typeof body?.date === 'string' ? body.date : '';
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  const at = typeof body?.at === 'string' && parseAt(body.at)?.date === date ? body.at : null;

  try {
    const push = await qualityPush(createServerClient(), date);
    if (!push) return NextResponse.json({ error: 'Not a quality day' }, { status: 404 });
    await notifyAthlete({
      athleteId: auth.user.athleteId,
      kind: 'quality_session',
      url: `/dashboard/quality-session?date=${date}${at ? `&at=${at}` : ''}`,
      // A fresh tag per try, so a second one is not folded into the first.
      tag: `qualitySession:try:${Date.now()}`,
      ...push,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[quality-session] POST failed:', err);
    return NextResponse.json({ error: 'Failed to send' }, { status: 500 });
  }
}

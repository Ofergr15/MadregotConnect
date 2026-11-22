import { NextResponse } from 'next/server';
import { authError, requireAthlete } from '@/lib/auth-session';
import { isFeatureEnabled } from '@/lib/features/server';
import { createRateLimiter } from '@/lib/academy/intake';
import { resendOwnDay } from '@/lib/watch/resend-day';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/me/watch/resend  { date?: 'YYYY-MM-DD' }  (default: today in Israel)
 *
 * Re-sends the CALLER's own planned workout(s) for that date to their own Garmin watch.
 * The athlete comes from the JWT (requireAthlete) and nowhere else: any id in the body is
 * ignored. Gated by `native_resend_workout` (404 while off). 5 sends/hour per athlete.
 *
 *   200 { ok: true, sent, date } · 400 bad date · 404 flag off / no workout that day
 *   409 { error: 'garmin-not-connected' } · 429 rate limited · 502 Garmin failed
 * Never returns Garmin tokens.
 */
const allow = createRateLimiter(5, 60 * 60 * 1000);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const auth = await requireAthlete(request);
    if (!auth.ok) return authError(auth);
    const athleteId = auth.user.athleteId;
    if (!(await isFeatureEnabled('native_resend_workout', athleteId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as { date?: unknown };
    const date = body?.date === undefined || body?.date === null ? israelToday() : body.date;
    if (typeof date !== 'string' || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    if (!allow(`resend:${athleteId}`)) return NextResponse.json({ error: 'rate-limited' }, { status: 429 });

    const r = await resendOwnDay(athleteId, date);
    if (r.status === 'garmin-not-connected') return NextResponse.json({ error: r.status }, { status: 409 });
    if (r.status === 'no-workout') return NextResponse.json({ error: 'no-workout' }, { status: 404 });
    if (r.status === 'failed') return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, sent: r.sent, date });
  } catch (error) {
    console.error('me/watch/resend error:', error);
    return NextResponse.json({ error: 'Failed to resend workout' }, { status: 500 });
  }
}

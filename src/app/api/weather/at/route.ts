import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth/self-or-staff';
import { israelToday } from '@/lib/utils';
import { inRange, parseQuery, weatherAt } from '@/lib/weather/at';

/**
 * GET /api/weather/at?lat&lon&time=YYYY-MM-DDTHH:MM — weather at a session's start.
 * Member-only (verified JWT): it is a proxy to a public forecast and carries nothing
 * personal, but an open proxy is an open proxy. `weather: null` = not answerable
 * (out of the forecast range, or upstream failed) — the card simply shows no weather.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const denied = await requireMember(request);
    if (denied) return denied;
    const q = parseQuery(new URL(request.url).searchParams);
    if (typeof q === 'string') return NextResponse.json({ error: `invalid ${q}` }, { status: 400 });
    if (!inRange(q.date, israelToday())) return NextResponse.json({ weather: null });
    return NextResponse.json({ weather: await weatherAt(q.lat, q.lon, q.date, q.hour) });
  } catch (error: any) {
    console.error('weather/at error:', error);
    return NextResponse.json({ error: error.message || 'Failed to read weather' }, { status: 500 });
  }
}

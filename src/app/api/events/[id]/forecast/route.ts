import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { buildDTO, buildForecastUrl, eventDateRange, parseOpenMeteo, usableForecast, validCoords, type UnavailableReason } from '@/lib/events/forecast';
import { FRESH_MS, coalesce, freshForecast, rememberForecast, staleForecast, venueKey } from '@/lib/events/forecast-cache';

export const dynamic = 'force-dynamic';

/** Downstream may keep an answer only for what is left of its freshness here, so nothing is ever older than FRESH_MS. */
const freshHeaders = (fetchedAt: number) => {
  const left = Math.floor((FRESH_MS - (Date.now() - fetchedAt)) / 1000);
  return { 'Cache-Control': left > 0 ? `public, max-age=${left}` : 'no-store' };
};
const NO_LOCATION_HEADERS = { 'Cache-Control': 'public, max-age=1800' };
const NO_STORE = { 'Cache-Control': 'no-store' };
const TIMEOUT_MS = 5000;

class ProviderError extends Error {
  constructor(readonly reason: Exclude<UnavailableReason, 'no_location' | null>) { super(reason); }
}

/**
 * GET /api/events/[id]/forecast — the venue's weather now, the next days, and the race day(s) when the
 * provider's window reaches them (docs/contracts/event-forecast.md). Public read, like GET /api/events/[id].
 * 404 only for an unknown event; every other outcome is a 200 DTO saying what is and isn't known.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data, error } = await createServerClient()
      .from('events').select('id, date, end_date, lat, lng').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const raceDates = eventDateRange(data.date, data.end_date);
    const lat = data.lat == null ? NaN : Number(data.lat);
    const lng = data.lng == null ? NaN : Number(data.lng);
    if (!validCoords(lat, lng)) {
      return NextResponse.json(buildDTO({ eventId: id, lat: null, lng: null, raceDates, forecast: null, fetchedAt: null,
        stale: false, unavailableReason: 'no_location' }), { headers: NO_LOCATION_HEADERS });
    }

    const key = venueKey(lat, lng);
    const fresh = freshForecast(key);
    if (fresh) {
      return NextResponse.json(buildDTO({ eventId: id, lat, lng, raceDates, forecast: fresh.forecast, fetchedAt: fresh.at,
        stale: false, unavailableReason: null }), { headers: freshHeaders(fresh.at) });
    }

    try {
      const entry = await coalesce(key, async () => {
        let res: Response;
        try {
          res = await fetch(buildForecastUrl(lat, lng), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch (e) {
          throw new ProviderError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'provider_error');
        }
        if (res.status === 429) throw new ProviderError('rate_limited');
        if (!res.ok) throw new ProviderError('provider_error');
        const parsed = parseOpenMeteo(await res.json().catch(() => null));
        // A 200 with nothing usable is a failure: it must not overwrite the last good answer.
        if (!usableForecast(parsed)) throw new ProviderError('invalid_payload');
        return rememberForecast(key, parsed);
      });
      return NextResponse.json(buildDTO({ eventId: id, lat, lng, raceDates, forecast: entry.forecast, fetchedAt: entry.at,
        stale: false, unavailableReason: null }), { headers: freshHeaders(entry.at) });
    } catch (e) {
      const reason = e instanceof ProviderError ? e.reason : 'provider_error';
      console.error('Event forecast fetch failed:', reason);
      const prev = staleForecast(key);
      // A fallback, or an honest "unavailable", must never be cached downstream as fresh.
      return NextResponse.json(buildDTO({ eventId: id, lat, lng, raceDates, forecast: prev?.forecast ?? null,
        fetchedAt: prev?.at ?? null, stale: !!prev, unavailableReason: prev ? null : reason }), { headers: NO_STORE });
    }
  } catch (error) {
    console.error('Failed to build event forecast:', error);
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 500 });
  }
}

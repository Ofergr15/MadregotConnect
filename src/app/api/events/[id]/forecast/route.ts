import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  buildForecastUrl,
  classifyDate,
  eventDateRange,
  mapOpenMeteoDaily,
  todayUtc,
  type ForecastDay,
} from '@/lib/events/forecast';

export const dynamic = 'force-dynamic';

const CACHE = { 'Cache-Control': 'public, max-age=1800' };

// GET /api/events/[id]/forecast — daily Open-Meteo forecast for the event's
// dates. Public read, same convention as GET /api/events/[id].
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('events')
      .select('id, date, end_date, lat, lng')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    const lat = data.lat == null ? NaN : Number(data.lat);
    const lng = data.lng == null ? NaN : Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ status: 'no_location', eventId: id, days: [] }, { headers: CACHE });
    }

    const today = todayUtc();
    const dates = eventDateRange(data.date, data.end_date);
    const inRange = dates.filter((d) => classifyDate(d, today) === 'in_range');

    let fetched: ForecastDay[] = [];
    if (inRange.length > 0) {
      try {
        const res = await fetch(buildForecastUrl(lat, lng, inRange[0], inRange[inRange.length - 1]), {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`open-meteo ${res.status}`);
        fetched = mapOpenMeteoDaily(await res.json(), inRange);
      } catch (e) {
        console.error('Event forecast fetch failed:', e);
        return NextResponse.json({ error: 'Forecast unavailable' }, { status: 502 });
      }
    }

    const byDate = new Map(fetched.map((d) => [d.date, d]));
    const days: ForecastDay[] = dates.map((date): ForecastDay => {
      const cls = classifyDate(date, today);
      if (cls === 'in_range') return byDate.get(date) ?? { date, status: 'error' };
      return { date, status: cls };
    });

    return NextResponse.json({ status: 'ok', eventId: id, days }, { headers: CACHE });
  } catch (error) {
    console.error('Failed to build event forecast:', error);
    return NextResponse.json({ error: 'Failed to fetch forecast' }, { status: 500 });
  }
}

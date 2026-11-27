import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { featureResolutions } from '@/lib/features/server';
import { israelDateAnchor } from '@/lib/utils';
import { internalErrorBody } from '@/lib/api-error';
import { cronPaused } from '@/lib/cron-pause';
import { isSunday, shouldSend, yourWeekCopy, yourWeekNumbers, yourWeekWindows, YOUR_WEEK_URL } from '@/lib/weekly-summary/your-week';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/your-week[?sunday=YYYY-MM-DD] — the opt-in Sunday "your week" push, DRY RUN ONLY.
 *
 * Night task 54. This route never sends anything: it computes who WOULD get the push and
 * what it would say, and returns that. It is not in vercel.json's crons (nothing schedules
 * it), it needs CRON_SECRET set and presented (fails closed, unlike the legacy crons), and
 * the audience is only athletes with the default-off `your_week_push` flag enabled (opt-in).
 * Turning it into a real send is a separate, reviewed change.
 */
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (await cronPaused()) return NextResponse.json({ paused: true });
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(request.url);
    const sunday = url.searchParams.get('sunday') ?? israelDateAnchor(new Date()).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sunday) || !isSunday(sunday)) {
      return NextResponse.json({ error: 'sunday must be a Sunday (YYYY-MM-DD)' }, { status: 400 });
    }
    const w = yourWeekWindows(sunday);
    const db = createServerClient();

    const { data: athletes, error: aErr } = await db.from('athletes').select('id').eq('status', 'active');
    if (aErr) return NextResponse.json(internalErrorBody(), { status: 500 });
    const ids = (athletes ?? []).map((a: { id: string }) => a.id);

    const optedIn: string[] = [];
    for (const id of ids) {
      const r = await featureResolutions(['your_week_push'], id, db).catch(() => null);
      if (r?.your_week_push?.enabled) optedIn.push(id);
    }

    const wouldSend: Array<{ athleteId: string; numbers: ReturnType<typeof yourWeekNumbers>; he: { title: string; body: string }; url: string }> = [];
    if (optedIn.length) {
      // One read covering both windows: the plan week starts a day before the activity week.
      const { data: acts, error } = await db.from('athlete_activities')
        .select('athlete_id, start_time, distance, duration, activity_type')
        .in('athlete_id', optedIn)
        .gte('start_time', w.planWeekStart)
        .lt('start_time', w.activityWeekEnd)
        .limit(5000);
      if (error) return NextResponse.json(internalErrorBody(), { status: 500 });
      const byAthlete = new Map<string, Array<{ start_time: string; distance: number | null; activity_type: string | null }>>();
      for (const r of (acts ?? []) as Array<{ athlete_id: string; start_time: string; distance: number | null; activity_type: string | null }>) {
        const arr = byAthlete.get(r.athlete_id) ?? [];
        arr.push(r);
        byAthlete.set(r.athlete_id, arr);
      }
      for (const id of optedIn) {
        const numbers = yourWeekNumbers(sunday, byAthlete.get(id) ?? []);
        if (shouldSend(numbers)) wouldSend.push({ athleteId: id, numbers, he: yourWeekCopy('he', numbers), url: YOUR_WEEK_URL });
      }
    }

    return NextResponse.json({ dryRun: true, sunday, windows: w, active: ids.length, optedIn: optedIn.length, wouldSend });
  } catch (err: unknown) {
    console.error('GET /api/cron/your-week error:', err);
    return NextResponse.json(internalErrorBody(), { status: 500 });
  }
}
